import { NextResponse } from 'next/server';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { storeImportedAudio } from '@/lib/captureStorage';
import { generateMultimodalWithLightcurveModelResult } from '@/lib/vertex';
import { ensurePlaygroundDataset } from '@/lib/humanDatasets';
import { db } from '@/db';
import { datasetCases, datasetCaseVersions, datasets } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function POST(req: Request) {
  try {
    const account = await requireAccount();
    const formData = await req.formData();
    const file = formData.get('file') as File;
    
    if (!file || !file.type.startsWith('audio/')) {
      return NextResponse.json({ error: 'A valid audio file is required.' }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const gcsUri = await storeImportedAudio({
      ownerUserId: account.userId,
      filename: file.name,
      contentType: file.type,
      bytes,
    });

    const prompt = `
You are analyzing a recorded voice call between a human caller and an agent.
Listen carefully to the audio and extract the conversational transcript and behavior.

Return JSON ONLY matching this structure:
{
  "transcript": [
    { "speaker": "human" | "agent", "text": "..." }
  ],
  "callerProfile": {
    "accent": "description of the caller's accent (e.g. standard American, British, Indian English, etc)",
    "dialect": "any specific dialectal features or regional word choices observed"
  },
  "behaviorGraph": {
    "schema": "lightcurve.human_behavior_graph.v2",
    "source": "imported_audio",
    "nodes": [
      { "id": "...", "kind": "human_behavior" | "agent_response", "speaker": "human" | "agent", "state": "...", "observedText": "..." }
    ],
    "edges": [
      { "from": "...", "to": "...", "condition": "..." }
    ],
    "semanticStates": [
      { "id": "...", "speaker": "human" | "agent", "state": "..." }
    ],
    "allowedPaths": [["..."]],
    "terminalOutcome": "..."
  },
  "successCriteria": [
    { "type": "outcome_match" | "behavioral_path", "description": "...", "weight": 0.5 }
  ]
}

Convert the interaction into a constrained behavioral test graph in the "behaviorGraph" field.
Every node needs an id, kind, speaker, state, and observedText.
Every allowedPath must contain only human node IDs.
Keep PII redacted as [EMAIL], [PHONE], etc.
`;

    const modelResult = await generateMultimodalWithLightcurveModelResult(
      'gemini-1.5-pro-002',
      prompt,
      [{ uri: gcsUri, mimeType: file.type }]
    );

    if (!modelResult.text) {
      throw new Error(modelResult.error || 'Audio analysis failed to return a valid response.');
    }

    const rawJson = modelResult.text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    let analysis;
    try {
      analysis = JSON.parse(rawJson);
    } catch {
      console.error('Failed to parse Gemini output:', rawJson);
      throw new Error('Audio analysis returned invalid JSON.');
    }

    const targetDataset = await ensurePlaygroundDataset(account.userId);
    const nextDatasetVersion = targetDataset.currentVersion + 1;

    const result = await db.transaction(async (tx) => {
      const [created] = await tx.insert(datasetCases).values({
        datasetId: targetDataset.id,
        name: file.name.replace(/\.[^/.]+$/, "") || `Imported call ${new Date().toISOString().slice(0, 10)}`,
        language: 'en-US',
        domain: 'general',
        status: 'approved',
        visibility: 'private',
        behaviorGraph: analysis.behaviorGraph || {},
        successCriteria: analysis.successCriteria || [],
        provenance: {
          source: 'imported_audio',
          audioUri: gcsUri,
          humanDerived: true,
          derivedAt: new Date().toISOString(),
          callerProfile: analysis.callerProfile,
          transcript: analysis.transcript,
        },
        riskWeight: 1,
        variationPolicy: {
          preserveIntent: true,
          preserveFacts: true,
          allowBranchVariation: true,
          allowSlotSubstitution: true,
          allowEmotionVariation: true,
          allowPacingVariation: true,
          allowInterruptionVariation: true,
          allowVoiceVariation: true,
          environmentProfiles: ['clean', 'office_cafe', 'car_street', 'latency_jitter', 'packet_loss', 'codec_bandwidth', 'compound_stress'],
        },
      }).returning();

      await tx.insert(datasetCaseVersions).values({
        caseId: created.id,
        datasetVersion: nextDatasetVersion,
        graphVersion: 1,
        behaviorGraph: analysis.behaviorGraph || {},
        successCriteria: analysis.successCriteria || [],
      });

      await tx.update(datasets).set({
        currentVersion: nextDatasetVersion,
        updatedAt: new Date(),
      }).where(eq(datasets.id, targetDataset.id));

      return { dataset: { ...targetDataset, currentVersion: nextDatasetVersion }, case: created };
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Dataset upload error:', error);
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Upload failed.' }, { status: 500 });
  }
}
