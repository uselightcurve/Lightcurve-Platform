import { NextResponse } from 'next/server';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { storeImportedAudio } from '@/lib/captureStorage';
import { generateWithLightcurveModelResult, stripModelJsonFence } from '@/lib/llm';
import { transcribeAudio, type SpeechTranscriptionResult } from '@/lib/speech';
import { ensurePlaygroundDataset } from '@/lib/humanDatasets';
import { normalizeCaseLanguage, sttLanguageForCaseLanguage } from '@/lib/constants';
import { db } from '@/db';
import { datasetCases, datasetCaseVersions, datasets } from '@/db/schema';
import { eq } from 'drizzle-orm';

export const maxDuration = 300;

type ImportedAudioAnalysis = {
  transcript?: Array<{ speaker: 'human' | 'agent'; text: string }>;
  callerProfile?: { accent?: string; dialect?: string };
  behaviorGraph?: Record<string, unknown>;
  successCriteria?: Array<Record<string, unknown>>;
};

type ModelAnalysisResult = {
  text: string | null;
  provider: string;
  model: string;
  error?: string;
};

const GRAPH_ANALYSIS_TIMEOUT_MS = 45_000;

function importedAudioName(filename: string) {
  return filename.replace(/\.[^/.]+$/, '') || `Imported call ${new Date().toISOString().slice(0, 10)}`;
}

function createDraftAnalysis(filename: string): Required<Pick<ImportedAudioAnalysis, 'transcript' | 'callerProfile' | 'behaviorGraph' | 'successCriteria'>> {
  const nodeId = 'audio_review_required';
  return {
    transcript: [],
    callerProfile: {
      accent: 'pending AI analysis',
      dialect: 'pending AI analysis',
    },
    behaviorGraph: {
      schema: 'lightcurve.human_behavior_graph.v3',
      source: 'imported_audio',
      nodes: [{
        id: nodeId,
        kind: 'human_behavior',
        speaker: 'human',
        state: 'Audio imported for review',
        observedText: `Transcript pending for ${filename}.`,
      }],
      edges: [],
      semanticStates: [{
        id: nodeId,
        speaker: 'human',
        state: 'Audio imported for review',
      }],
      allowedPaths: [[nodeId]],
      terminalOutcome: 'review_required',
    },
    successCriteria: [{
      type: 'behavioral_path',
      description: 'Review the saved audio and replace this draft graph with transcript-derived behavior.',
      weight: 1,
    }],
  };
}

function transcriptTurns(transcription: SpeechTranscriptionResult): Array<{ speaker: 'human' | 'agent'; text: string }> {
  if (transcription.segments?.length) {
    return transcription.segments
      .map((segment) => segment.text.trim())
      .filter(Boolean)
      .map((text) => ({ speaker: 'human' as const, text }));
  }
  return [{ speaker: 'human', text: transcription.text }];
}

function createTranscriptAnalysis(filename: string, transcription: SpeechTranscriptionResult): Required<Pick<ImportedAudioAnalysis, 'transcript' | 'callerProfile' | 'behaviorGraph' | 'successCriteria'>> {
  const transcript = transcriptTurns(transcription);
  const nodes = transcript.map((turn, index) => ({
    id: `turn_${index + 1}`,
    kind: turn.speaker === 'human' ? 'human_behavior' : 'agent_response',
    speaker: turn.speaker,
    state: turn.speaker === 'human' ? 'caller_observed' : 'agent_observed',
    observedText: turn.text,
  }));
  const humanNodeIds = nodes.filter((node) => node.speaker === 'human').map((node) => node.id);
  return {
    transcript,
    callerProfile: {
      accent: 'not inferred',
      dialect: `transcribed from ${filename}`,
    },
    behaviorGraph: {
      schema: 'lightcurve.human_behavior_graph.v3',
      source: 'imported_audio_transcript',
      nodes,
      edges: nodes.slice(1).map((node, index) => ({
        from: nodes[index].id,
        to: node.id,
        condition: 'observed_transition',
      })),
      semanticStates: nodes.map((node) => ({
        id: node.id,
        speaker: node.speaker,
        state: node.state,
      })),
      allowedPaths: humanNodeIds.length ? [humanNodeIds] : [],
      terminalOutcome: 'transcript_imported',
      temporalProfile: {
        emotionalArc: [],
        turnDurationsMs: [],
        pauseDurationsMs: [],
        overlapEvents: [],
        correctionPattern: 'not measured from upload transcript',
      },
    },
    successCriteria: [{
      type: 'behavioral_path',
      description: 'Replay should preserve the observed caller turns and handle the imported transcript path.',
      weight: 1,
    }],
  };
}

function timeoutResult(model: string): ModelAnalysisResult {
  return {
    text: null,
    provider: 'none',
    model,
    error: 'Call graph analysis timed out after the transcript was saved.',
  };
}

async function analyzeTranscript(prompt: string, model: string): Promise<ModelAnalysisResult> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      generateWithLightcurveModelResult(
        model,
        prompt,
        { responseFormat: 'json_object', maxTokens: 900, thinking: false },
      ),
      new Promise<ModelAnalysisResult>((resolve) => {
        timeout = setTimeout(() => resolve(timeoutResult(model)), GRAPH_ANALYSIS_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    return {
      text: null,
      provider: 'none',
      model,
      error: error instanceof Error ? error.message : 'Call graph analysis failed.',
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function POST(req: Request) {
  try {
    const account = await requireAccount();
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const language = normalizeCaseLanguage(formData.get('language'));
    
    if (!file || !file.type.startsWith('audio/')) {
      return NextResponse.json({ error: 'A valid audio file is required.' }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const audioUri = await storeImportedAudio({
      ownerUserId: account.userId,
      filename: file.name,
      contentType: file.type,
      bytes,
    });

    let transcription: SpeechTranscriptionResult | null = null;
    try {
      transcription = await transcribeAudio({
        bytes,
        mimeType: file.type,
        filename: file.name,
        language: sttLanguageForCaseLanguage(language),
      });
    } catch (error) {
      console.warn('Audio transcription unavailable; saving draft dataset case instead.', error);
    }

    const prompt = `
You are analyzing a locally transcribed recorded voice call between a human caller and an agent.
Use only the transcript text and metadata below. Do not assume details that are not present.
The call language is ${language}. Preserve the transcript language when creating states and summaries.

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
    "schema": "lightcurve.human_behavior_graph.v3",
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
      "temporalProfile": {
        "emotionalArc": ["..."],
        "turnDurationsMs": [0],
        "pauseDurationsMs": [0],
        "overlapEvents": [],
        "correctionPattern": "..."
      }
  },
  "successCriteria": [
    { "type": "outcome_match" | "behavioral_path", "description": "...", "weight": 0.5 }
  ]
}

Convert the interaction into a constrained behavioral test graph in the "behaviorGraph" field.
Every node needs an id, kind, speaker, state, and observedText.
Every allowedPath must contain only human node IDs.
Keep PII redacted as [EMAIL], [PHONE], etc.

Transcript:
${transcription?.text ?? '[transcription unavailable]'}
`;

    const analysisModel = process.env.LIGHTCURVE_PRO_JUDGE_MODEL || 'lightcurve-reasoner';
    const useLlmGraphAnalysis = process.env.LIGHTCURVE_UPLOAD_GRAPH_MODE === 'llm';
    const modelResult: ModelAnalysisResult = transcription && useLlmGraphAnalysis ? await analyzeTranscript(prompt, analysisModel) : {
      text: null,
      provider: transcription ? 'deterministic' : 'none',
      model: transcription ? 'transcript-graph-v1' : analysisModel,
      error: 'Local speech transcription is unavailable.',
    };

    let analysis: ImportedAudioAnalysis;
    let analysisStatus: 'complete' | 'draft' = 'complete';
    let warning: string | undefined;

    if (modelResult.text) {
      const rawJson = stripModelJsonFence(modelResult.text);
      try {
        analysis = JSON.parse(rawJson) as ImportedAudioAnalysis;
        if (!analysis.transcript?.length && transcription) analysis.transcript = transcriptTurns(transcription);
      } catch {
        console.error('Failed to parse LLM output:', rawJson);
        analysisStatus = 'draft';
        analysis = createDraftAnalysis(file.name);
        if (transcription) analysis.transcript = transcriptTurns(transcription);
        modelResult.error = 'Audio analysis returned invalid JSON.';
        warning = 'The recording and transcript were saved, but call graph analysis needs review. This case remains a draft.';
      }
    } else {
      if (transcription) {
        analysis = createTranscriptAnalysis(file.name, transcription);
        modelResult.error = useLlmGraphAnalysis ? modelResult.error : undefined;
      } else {
        analysisStatus = 'draft';
        analysis = createDraftAnalysis(file.name);
        warning = 'The audio was saved, but transcription did not finish. This case remains a draft.';
        console.warn('Audio analysis unavailable; saved draft dataset case instead.', modelResult.error);
      }
    }

    const targetDataset = await ensurePlaygroundDataset(account.userId);
    const nextDatasetVersion = targetDataset.currentVersion + 1;
    const behaviorGraph = analysis.behaviorGraph || {};
    const successCriteria = analysis.successCriteria || [];

    const result = await db.transaction(async (tx) => {
      const [created] = await tx.insert(datasetCases).values({
        datasetId: targetDataset.id,
        name: importedAudioName(file.name),
        language,
        domain: 'general',
        status: analysisStatus === 'complete' ? 'approved' : 'draft',
        visibility: 'private',
        behaviorGraph,
        successCriteria,
        provenance: {
          source: 'imported_audio',
          audioUri,
          humanDerived: true,
          derivedAt: new Date().toISOString(),
          analysisStatus,
          analysisProvider: modelResult.provider,
          analysisModel: modelResult.model,
          analysisError: analysisStatus === 'draft' ? modelResult.error : undefined,
          transcriptionProvider: transcription?.provider,
          transcriptionModel: transcription?.model,
          transcriptionLanguage: transcription?.language,
          callerProfile: analysis.callerProfile,
          transcript: analysis.transcript,
          voiceCloneConsent: false,
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
          allowVoiceCloning: false,
          environmentProfiles: ['clean', 'office_cafe', 'car_street', 'latency_jitter', 'packet_loss', 'codec_bandwidth', 'compound_stress'],
        },
      }).returning();

      await tx.insert(datasetCaseVersions).values({
        caseId: created.id,
        datasetVersion: nextDatasetVersion,
        graphVersion: 1,
        behaviorGraph,
        successCriteria,
      });

      await tx.update(datasets).set({
        currentVersion: nextDatasetVersion,
        updatedAt: new Date(),
      }).where(eq(datasets.id, targetDataset.id));

      return { dataset: { ...targetDataset, currentVersion: nextDatasetVersion }, case: created };
    });

    return NextResponse.json({ ...result, warning });
  } catch (error) {
    console.error('Dataset upload error:', error);
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Upload failed.' }, { status: 500 });
  }
}
