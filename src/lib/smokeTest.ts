import { smokeTestTTS } from './gcp';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  console.log('Running GCP TTS Smoke Test...');
  const success = await smokeTestTTS();
  if (success) {
    console.log('TTS Smoke Test PASSED: Successfully synthesized speech.');
  } else {
    console.log('TTS Smoke Test FAILED.');
  }
  process.exit(success ? 0 : 1);
}

main();
