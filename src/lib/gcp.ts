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

export async function synthesizeCallerPcm(text: string, languageCode: string) {
  const [response] = await ttsClient.synthesizeSpeech({
    input: { text },
    voice: { languageCode },
    audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 16000, speakingRate: 1 },
  });
  if (!response.audioContent) throw new Error('Text-to-speech returned no audio.');
  const content = Buffer.isBuffer(response.audioContent)
    ? response.audioContent
    : Buffer.from(response.audioContent as Uint8Array);
  return { audio: pcmDataFromWave(content), sampleRate: 16000, channels: 1 };
}
