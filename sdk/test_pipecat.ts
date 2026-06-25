import { start, runtime } from './src/runtime';

console.log('Testing Lightcurve JS SDK Initialization...');

// Set up a mock environment
process.env.LIGHTCURVE_API_KEY = 'test_key_123';
process.env.LIGHTCURVE_BASE_URL = 'http://localhost:3000';
process.env.LIGHTCURVE_AGENT_NAME = 'Test Pipecat Agent';

// Start the runtime (this will try to instrument pipecat, which is not installed yet, but shouldn't crash)
start();

console.log('Initialization complete. Worker count:', runtime.workers.length);

setTimeout(() => {
  console.log('Test successful. Exiting.');
  process.exit(0);
}, 1000);
