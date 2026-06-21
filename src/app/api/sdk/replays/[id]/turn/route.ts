import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { datasetCases, noiseAssets, replayJobs, runs } from '@/db/schema';
import { synthesizeCallerPcm } from '@/lib/gcp';
import { applyServerImpairments, pcm16ToWave, wavePcm16 } from '@/lib/audioImpairments';
import { downloadPrivateGcsObject, storeReplayAudio } from '@/lib/captureStorage';
import type { ReplayManifest } from '@/lib/replayCompiler';
import { anonymizeBehaviorGraph } from '@/lib/humanDatasets';
import { requireSdkAccount, sdkUnauthorizedJson } from '@/lib/sdkAuth';
import { generateWithLightcurveModel } from '@/lib/vertex';
import { checkAndStoreReplayUtterance } from '@/lib/utteranceDiversity';

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeCallerText(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, 'test.user@example.com')
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, '+1 555 010 2048')
    .slice(0, 500);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireSdkAccount(req);
    const { id } = await params;
    const body = record(await req.json().catch(() => ({})));
    const [row] = await db.select({ job: replayJobs, case: datasetCases, run: runs })
      .from(replayJobs)
      .innerJoin(runs, eq(runs.id, replayJobs.runId))
      .innerJoin(datasetCases, eq(datasetCases.id, runs.caseId))
      .where(and(eq(replayJobs.id, id), eq(replayJobs.ownerUserId, account.userId)))
      .limit(1);
    if (!row) return NextResponse.json({ error: 'Replay job not found.' }, { status: 404 });
    const graph = record(row.case.behaviorGraph);
    const manifest = record(row.run.replayManifest) as Partial<ReplayManifest>;
    const observedPath = Array.isArray(graph.observedPath) ? graph.observedPath : Array.isArray(graph.nodes) ? graph.nodes : [];
    const node = observedPath.map(record).find((item) => item.id === body.nodeId && item.speaker === 'human');
    if (!node || typeof node.observedText !== 'string') {
      return NextResponse.json({ error: 'Human behavior node not found in the captured graph.' }, { status: 400 });
    }
    const baseline = safeCallerText(node.observedText);
    const previousAgentText = typeof body.previousAgentText === 'string' ? body.previousAgentText.slice(-1500) : '';
    const rejected: string[] = [];
    let text = '';
    let nearestSimilarity = 0;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const generated = await generateWithLightcurveModel(process.env.LIGHTCURVE_FLASH_JUDGE_MODEL || 'gemini-2.5-flash', `
Write the next caller utterance for a voice-agent evaluation. Return only the utterance.
It must preserve the exact intent and facts of the human-observed baseline, respond
naturally to the latest agent response, and stay inside the supplied behavior graph.
Do not add a new goal, fact, request, or persona. Keep it under 60 words.
Replay seed: ${row.job.replaySeed}
Replay manifest: ${JSON.stringify(manifest)}
Behavior graph: ${JSON.stringify(anonymizeBehaviorGraph(graph))}
Human-observed baseline: ${baseline}
Latest agent response: ${previousAgentText || '[opening turn]'}
Generation attempt: ${attempt + 1}
${rejected.length ? `Do not repeat these semantically similar versions: ${JSON.stringify(rejected)}` : ''}
`);
      if (!generated?.trim()) throw new Error('Caller variation generation is unavailable.');
      const candidate = safeCallerText(generated.replace(/^['"]|['"]$/g, '').trim());
      const diversity = await checkAndStoreReplayUtterance({
        runId: row.run.id,
        experimentId: row.run.experimentId ?? row.run.id,
        nodeId: String(node.id),
        text: candidate,
      });
      nearestSimilarity = diversity.nearestSimilarity;
      if (diversity.accepted) {
        text = candidate;
        break;
      }
      rejected.push(candidate);
    }
    if (!text) throw new Error('A meaningfully distinct grounded caller utterance could not be compiled.');
    const audio = await synthesizeCallerPcm(text, row.case.language, manifest.voice);
    const impairment = manifest.impairment ?? { id: 'clean', label: 'Clean', server: {}, transport: {} };
    const requestedNoise = impairment.server?.noiseCategory === 'compound'
      ? (row.job.replaySeed % 2 ? 'office_cafe' : 'car_street')
      : impairment.server?.noiseCategory;
    let selectedNoise: typeof noiseAssets.$inferSelect | null = null;
    let noisePcm: Buffer | undefined;
    if (requestedNoise) {
      const catalog = await db.select().from(noiseAssets).where(and(eq(noiseAssets.category, requestedNoise), eq(noiseAssets.enabled, 1)));
      if (!catalog.length) throw new Error(`Licensed noise catalog has no ${requestedNoise} asset.`);
      selectedNoise = catalog[row.job.replaySeed % catalog.length];
      noisePcm = wavePcm16(await downloadPrivateGcsObject(selectedNoise.gcsUri));
    }
    const impaired = applyServerImpairments(audio.audio, audio.sampleRate, impairment, row.job.replaySeed + String(node.id).length, noisePcm);
    const safeNode = String(node.id).replace(/[^a-zA-Z0-9_-]/g, '_');
    const [cleanAudioUrl, impairedAudioUrl] = await Promise.all([
      storeReplayAudio({ ownerUserId: account.userId, replayJobId: row.job.id, name: `${safeNode}-clean.wav`, bytes: pcm16ToWave(audio.audio, audio.sampleRate) }),
      storeReplayAudio({ ownerUserId: account.userId, replayJobId: row.job.id, name: `${safeNode}-impaired.wav`, bytes: pcm16ToWave(impaired, audio.sampleRate) }),
    ]);
    await db.update(runs).set({
      audioCleanCallerUrl: row.run.audioCleanCallerUrl ?? cleanAudioUrl,
      audioImpairedCallerUrl: row.run.audioImpairedCallerUrl ?? impairedAudioUrl,
      audioCallerUrl: row.run.audioCallerUrl ?? impairedAudioUrl,
    }).where(eq(runs.id, row.run.id));
    return NextResponse.json({
      nodeId: node.id,
      text,
      audioBase64: impaired.toString('base64'),
      cleanAudioBase64: audio.audio.toString('base64'),
      sampleRate: audio.sampleRate,
      channels: audio.channels,
      transport: manifest.impairment?.transport ?? {},
      timing: manifest.timing ?? {},
      artifacts: { cleanAudioUrl, impairedAudioUrl, nearestSimilarity, noiseAsset: selectedNoise ? { key: selectedNoise.key, license: selectedNoise.license, checksum: selectedNoise.checksum } : null },
    });
  } catch (error) {
    const unauthorized = sdkUnauthorizedJson(error);
    if (unauthorized) return unauthorized;
    const message = error instanceof Error ? error.message : 'Replay turn could not be generated.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
