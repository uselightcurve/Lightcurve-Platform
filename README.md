# Lightcurve

Braintrust.dev for voice AI agents. Teams connect their agent, run real-world call simulations, get MOS scores + eval results, branch scenarios, plug into CI/CD. Simple. Fast. Cheap.

## Setup

1. Copy `.env.example` to `.env` and fill in the values:
   - `DATABASE_URL`: Neon Postgres connection string
   - `DAILY_API_KEY`: Daily.co API key
   - `GOOGLE_CLOUD_PROJECT`: GCP Project ID
   - `GOOGLE_APPLICATION_CREDENTIALS`: Path to GCP service account JSON
   - `GCS_BUCKET`: GCS bucket for audio logs
   - `CLOUD_TASKS_QUEUE` & `CLOUD_TASKS_LOCATION`: For eval pipeline
   - `MOS_SERVICE_URL`: URL to your deployed Cloud Run MOS microservice
   - `GEMINI_API_KEY`: Gemini API Key
   - `VAPI_API_KEY` & `VAPI_ASSISTANT_ID`: Vapi sandbox and import integration
   - `RETELL_API_KEY` & `RETELL_AGENT_ID`: Retell sandbox and import integration
   - `ELEVENLABS_API_KEY` & `ELEVENLABS_AGENT_ID`: ElevenLabs Conversational AI integration
   - `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`: LiveKit room/recording integration
   - `PIPECAT_AGENT_URL` & `PIPECAT_AUTH_TOKEN`: Pipecat agent endpoint integration
   - `CUSTOM_WEBRTC_WSS_URL`: Generic websocket media endpoint
   - `HUGGINGFACE_TOKEN`: Optional token for private or rate-limited dataset imports

2. Install dependencies:
   ```bash
   npm install
   ```

3. Setup Database (Neon):
   ```bash
   npx drizzle-kit push
   npx tsx src/db/seed.ts
   ```

4. Run the development server:
   ```bash
   npm run dev
   ```

## SDK Usage in CI/CD

Integrate VoiceSandbox into your CI/CD pipeline to block regressions on your Voice AI agents.

### Example GitHub Actions Workflow

Create `.github/workflows/voice-eval.yml`:

```yaml
name: Voice Agent Eval

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  evaluate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install SDK
        run: npm install @voicesandbox/sdk

      - name: Run Voice Eval Suite
        env:
          VS_API_KEY: \${{ secrets.VS_API_KEY }}
          GITHUB_SHA: \${{ github.sha }}
        run: |
          cat << 'EOF' > run_eval.js
          const { VoiceSandbox } = require('@voicesandbox/sdk');
          
          async function main() {
            const vs = new VoiceSandbox();
            
            const result = await vs.run({
              agentType: 'vapi',
              agentConfig: { assistantId: process.env.VAPI_ASSISTANT_ID },
              scenarios: ['preset:angry_refund_en_us', 'preset:fraud_dispute_en_gb'],
              parallel: 3,
              gitSha: process.env.GITHUB_SHA,
            });

            console.log(\`Avg MOS: \${result.mos}\`);
            console.log(\`Task Completion: \${result.taskCompletion}\`);
            
            // Block CI if performance degrades
            if (result.mos < 3.5 || result.taskCompletion < 0.8) {
              console.error('Regression detected! Failing CI.');
              process.exit(1);
            }
          }
          
          main().catch(console.error);
          EOF
          
          node run_eval.js
```
