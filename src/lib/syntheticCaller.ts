import { GoogleGenerativeAI } from '@google/generative-ai';
import { db } from '../db';
import { traces, runs } from '../db/schema';
import { eq } from 'drizzle-orm';
import { ttsClient, tasksClient } from './gcp';
import { VOICE_MAP } from './constants';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'dummy_key');

// In a real MVP, Node WebRTC or a headless browser (e.g. Puppeteer) would be used
// to connect to Daily.co and pipe audio bytes. We encapsulate the logic here.
export async function runSyntheticCallerLoop(runId: string, dailyRoomUrl: string, scenario: any) {
  console.log(`[Run ${runId}] Joining Daily room: ${dailyRoomUrl}`);
  
  // STEP 1 — Join Daily room as synthetic caller participant
  // daily.join({ url: dailyRoomUrl })
  
  let history = '';
  let turnCount = 0;
  const maxTurns = 15;
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  // STEP 2 & 3 — Receive agent audio track and stream to STT Chirp
  // (Stubbed for Next.js environment without native WebRTC capabilities)
  // const transcript = await streamToGoogleSTT(audioStream);
  
  // Example conversational turn loop (Simulated)
  let isCallActive = true;
  while (isCallActive && turnCount < maxTurns) {
    const transcript = "Hello, how can I help you today?"; // Stubbed STT result
    history += `\nAgent: ${transcript}`;

    // STEP 4 — Send transcript + history to Gemini 1.5 Flash with persona prompt
    const prompt = `
      You are ${scenario.persona.name}, ${scenario.persona.age} years old, accent: ${scenario.persona.accent}.
      Emotional state: ${scenario.persona.emotional_state}.
      Your goal: ${scenario.persona.goal}.
      Speak in language: ${scenario.language}.
      ${scenario.persona.code_switching ? "You naturally mix English into your speech (code-switching is normal for your demographic)." : ""}

      Rules:
      - Stay in character. Never break persona.
      - Be persistent. Do not accept vague non-answers.
      - If your goal is fully resolved, reply with exactly: [GOAL_MET]
      - If turn count exceeds ${maxTurns}, reply with exactly: [TIMEOUT]
      - Emotional escalation: if agent gives 2 unhelpful responses in a row, increase frustration.

      Conversation so far:
      ${history}
    `;

    // STEP 5 — Get reply text from Gemini
    const result = await model.generateContent(prompt);
    const replyText = result.response.text();
    history += `\nCaller: ${replyText}`;

    // STEP 6 — Send reply text to Google TTS Neural2
    const voiceName = VOICE_MAP[scenario.language] || 'en-US-Neural2-F';
    const ttsRequest = {
      input: { text: replyText.replace(/\[GOAL_MET\]|\[TIMEOUT\]/g, '').trim() },
      voice: { languageCode: scenario.language, name: voiceName },
      audioConfig: { audioEncoding: 'LINEAR16' as const, sampleRateHertz: 48000 },
    };
    
    // const [ttsResponse] = await ttsClient.synthesizeSpeech(ttsRequest);
    // const audioBytes = ttsResponse.audioContent;

    // STEP 7 — Apply noise via ffmpeg if persona.noise_db > 0
    // if (scenario.persona.noise_db > 0) { ... }

    // STEP 8 — Stream audio bytes back into Daily room
    // daily.playAudio(audioBytes)

    // STEP 9 — Write trace row
    await db.insert(traces).values({
      runId,
      turnIndex: turnCount,
      speaker: 'caller',
      text: replyText,
      sttConfidence: 0.95,
      totalLatencyMs: 1200, // example
    });

    // STEP 10 — Check reply for [GOAL_MET] or [TIMEOUT]
    if (replyText.includes('[GOAL_MET]') || replyText.includes('[TIMEOUT]')) {
      isCallActive = false;
    }
    
    turnCount++;
    isCallActive = false; // Breaking loop early for the stub
  }

  // STEP 11 — Upload both audio legs to GCS (Stubbed)
  const callerAudioUrl = `https://storage.googleapis.com/${process.env.GCS_BUCKET}/caller-${runId}.wav`;
  const agentAudioUrl = `https://storage.googleapis.com/${process.env.GCS_BUCKET}/agent-${runId}.wav`;

  await db.update(runs).set({
    status: 'evaluating',
    turnCount,
    audioCallerUrl: callerAudioUrl,
    audioAgentUrl: agentAudioUrl,
    endedAt: new Date(),
  }).where(eq(runs.id, runId));

  // STEP 12 — Enqueue eval job in Cloud Tasks
  await enqueueEvalJob(runId);
}

async function enqueueEvalJob(runId: string) {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const queue = process.env.CLOUD_TASKS_QUEUE;
  const location = process.env.CLOUD_TASKS_LOCATION;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  if (!project || !queue || !location) return; // Skip if no config

  const parent = tasksClient.queuePath(project, location, queue);
  const task = {
    httpRequest: {
      httpMethod: 'POST' as const,
      url: `${appUrl}/api/eval/${runId}`,
      headers: { 'Content-Type': 'application/json' },
    },
  };

  await tasksClient.createTask({ parent, task });
}
