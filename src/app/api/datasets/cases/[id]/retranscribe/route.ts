import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { datasetCases, datasetCaseVersions, datasets } from '@/db/schema';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { isPrivateAudioUri } from '@/lib/captureStorage';
import { transcribeAudio } from '@/lib/speech';

export const maxDuration = 3_600;

type TranscriptTurn = {
  speaker: 'human';
  text: string;
};

function transcriptTurns(text: string, segments?: Array<{ text: string }>): TranscriptTurn[] {
  const values = segments?.map((segment) => segment.text.trim()).filter(Boolean) ?? [];
  return (values.length ? values : [text]).map((value) => ({ speaker: 'human', text: value }));
}

function caseLanguage(language: string | undefined, fallback: string) {
  if (!language) return fallback;
  const normalized = language.toLowerCase();
  if (normalized === 'hi') return 'hi-IN';
  if (normalized === 'cs') return 'cs-CZ';
  if (normalized === 'en') return 'en-US';
  return language;
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireAccount();
    const { id } = await params;
    const [owned] = await db
      .select({ datasetCase: datasetCases, dataset: datasets })
      .from(datasetCases)
      .innerJoin(datasets, eq(datasetCases.datasetId, datasets.id))
      .where(and(eq(datasetCases.id, id), eq(datasets.ownerUserId, account.userId)))
      .limit(1);
    if (!owned) return NextResponse.json({ error: 'Recording not found.' }, { status: 404 });

    const provenance = owned.datasetCase.provenance as Record<string, unknown>;
    const audioUri = typeof provenance.audioUri === 'string' ? provenance.audioUri : '';
    if (provenance.source !== 'imported_audio' || !isPrivateAudioUri(audioUri)) {
      return NextResponse.json({ error: 'This case does not have a private source recording.' }, { status: 400 });
    }

    const transcription = await transcribeAudio({
      uri: audioUri,
      filename: `${owned.datasetCase.name}.wav`,
      timeoutMs: 60 * 60 * 1_000,
    });
    const transcript = transcriptTurns(transcription.text, transcription.segments);
    const nodes = transcript.map((turn, index) => ({
      id: `turn_${index + 1}`,
      kind: 'human_behavior',
      speaker: turn.speaker,
      state: 'caller_observed',
      observedText: turn.text,
    }));
    const behaviorGraph = {
      schema: 'lightcurve.human_behavior_graph.v3',
      source: 'imported_audio_transcript',
      nodes,
      edges: nodes.slice(1).map((node, index) => ({
        from: nodes[index].id,
        to: node.id,
        condition: 'observed_transition',
      })),
      semanticStates: nodes.map((node) => ({ id: node.id, speaker: node.speaker, state: node.state })),
      allowedPaths: nodes.length ? [nodes.map((node) => node.id)] : [],
      terminalOutcome: 'transcript_imported',
    };
    const successCriteria = [{
      type: 'behavioral_path',
      description: 'Replay should preserve the observed caller turns and handle the imported transcript path.',
      weight: 1,
    }];
    const language = caseLanguage(transcription.language, owned.datasetCase.language);
    const nextDatasetVersion = owned.dataset.currentVersion + 1;

    const updated = await db.transaction(async (tx) => {
      const [datasetCase] = await tx.update(datasetCases).set({
        language,
        behaviorGraph,
        successCriteria,
        provenance: {
          ...provenance,
          transcript,
          transcriptionLanguage: language,
          transcriptionProvider: transcription.provider,
          transcriptionModel: transcription.model,
          retranscribedAt: new Date().toISOString(),
        },
        status: 'approved',
        updatedAt: new Date(),
      }).where(eq(datasetCases.id, id)).returning();

      await tx.insert(datasetCaseVersions).values({
        caseId: id,
        datasetVersion: nextDatasetVersion,
        graphVersion: 1,
        behaviorGraph,
        successCriteria,
      });
      await tx.update(datasets).set({
        currentVersion: nextDatasetVersion,
        updatedAt: new Date(),
      }).where(eq(datasets.id, owned.dataset.id));
      return datasetCase;
    });

    return NextResponse.json({ case: updated });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    console.error('Recording retranscription failed', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Recording could not be retranscribed.',
    }, { status: 500 });
  }
}
