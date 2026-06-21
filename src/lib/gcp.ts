import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { SpeechClient } from '@google-cloud/speech';
import { Storage } from '@google-cloud/storage';

export const ttsClient = new TextToSpeechClient();
export const sttClient = new SpeechClient();
export const storage = new Storage();

export async function smokeTestTTS() {
  try {
    const request = {
      input: { text: 'Hello, this is a smoke test.' },
      voice: { languageCode: 'en-US', name: 'en-US-Neural2-F' },
      audioConfig: { audioEncoding: 'MP3' as const },
    };
    const [response] = await ttsClient.synthesizeSpeech(request);
    return !!response.audioContent;
  } catch (error) {
    console.error('TTS Smoke Test Failed:', error);
    return false;
  }
}

function pcmDataFromWave(content: Buffer) {
  if (content.subarray(0, 4).toString('ascii') !== 'RIFF') return content;
  let offset = 12;
  while (offset + 8 <= content.length) {
    const chunk = content.subarray(offset, offset + 4).toString('ascii');
    const size = content.readUInt32LE(offset + 4);
    if (chunk === 'data') return content.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  return content;
}

const voiceNames: Record<string, string> = {
  'neutral-a': 'en-US-Neural2-A',
  'neutral-b': 'en-US-Neural2-C',
  'warm-a': 'en-US-Neural2-F',
  'firm-a': 'en-US-Neural2-D',
  'conversational-a': 'en-US-Studio-O',
  'conversational-b': 'en-US-Studio-Q',
};

export async function synthesizeCallerPcm(text: string, languageCode: string, options?: { family?: string; speakingRate?: number; pitch?: number }) {
  const [response] = await ttsClient.synthesizeSpeech({
    input: { text },
    voice: { languageCode, name: languageCode === 'en-US' && options?.family ? voiceNames[options.family] : undefined },
    audioConfig: {
      audioEncoding: 'LINEAR16',
      sampleRateHertz: 16000,
      speakingRate: Math.max(0.5, Math.min(2, options?.speakingRate ?? 1)),
      pitch: Math.max(-10, Math.min(10, options?.pitch ?? 0)),
    },
  });
  if (!response.audioContent) throw new Error('Text-to-speech returned no audio.');
  const content = Buffer.isBuffer(response.audioContent)
    ? response.audioContent
    : Buffer.from(response.audioContent as Uint8Array);
  return { audio: pcmDataFromWave(content), sampleRate: 16000, channels: 1 };
}
