import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { SpeechClient } from '@google-cloud/speech';
import { Storage } from '@google-cloud/storage';
import { CloudTasksClient } from '@google-cloud/tasks';

export const ttsClient = new TextToSpeechClient();
export const sttClient = new SpeechClient();
export const storage = new Storage();
export const tasksClient = new CloudTasksClient();

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
