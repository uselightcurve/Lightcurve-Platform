# Lightcurve Bot-to-Bot Sandbox Architecture

Lightcurve bot-to-bot tests run voice-agent scenarios as queued worker jobs, not inside the Next.js request lifecycle.

## Current Production Slice

1. Experiment creates one run per selected scenario.
2. Run start enqueues a Cloud Tasks worker call to `/api/bot-to-bot/runs/:id/worker`.
3. The worker loads experiment, run, and scenario data.
4. The synthetic caller generates an opening turn from the scenario.
5. Lightcurve calls the customer's agent runner endpoint with conversation context.
6. The worker records caller/agent traces, latency, task score, MOS proxy, and recommendation.
7. Optional TTS writes caller/agent audio legs to GCS when `BOT_TO_BOT_TTS_ENABLED=1`.

## Vapi Phone Bot-to-Bot Slice

Vapi can run a real phone bot-to-bot test without asking a human tester to act out the scenario.

1. Lightcurve creates a Vapi outbound call from `VAPI_PHONE_NUMBER_ID`.
2. The destination is the customer agent phone number or SIP URI from the experiment config, or `VAPI_TARGET_AGENT_NUMBER`.
3. The Vapi assistant is the Lightcurve synthetic caller. Use `VAPI_CALLER_ASSISTANT_ID` for a prebuilt caller assistant, or let Lightcurve create a transient caller from the selected scenario.
4. Vapi records and transcribes the call.
5. Lightcurve polls Vapi, flips the transcript roles so the synthetic assistant is shown as `caller`, and saves traces, MOS, task score, latency, audio, and failure summary.

Required production secrets for this mode:

- `VAPI_API_KEY`
- `VAPI_PHONE_NUMBER_ID`
- one of `VAPI_TARGET_AGENT_NUMBER` or an experiment-level target number

Recommended:

- `VAPI_CALLER_ASSISTANT_ID` for a known-good low-cost caller voice/persona
- `VAPI_CALLER_MODEL_PROVIDER=openai`
- `VAPI_CALLER_MODEL=gpt-4o-mini`
- `VAPI_CALLER_VOICE_PROVIDER` and `VAPI_CALLER_VOICE_ID` when the Vapi account requires an explicit voice

## Customer Runner Contract

For Pipecat, LiveKit adapters, or custom WebRTC bridges, the customer can expose an HTTPS runner:

```json
{
  "experimentId": "uuid",
  "scenario": {
    "id": "uuid",
    "name": "refund escalation",
    "language": "en-US",
    "domain": "ecommerce",
    "persona": {},
    "successCriteria": []
  },
  "conversation": [
    { "speaker": "caller", "text": "I still do not have my refund." }
  ]
}
```

The endpoint should return:

```json
{ "text": "I can help with that. I will verify the order and explain the next step." }
```

## Scale Controls

- `BOT_TO_BOT_MAX_CONCURRENT_RUNS`: Cloud Tasks max concurrent dispatches.
- `BOT_TO_BOT_MAX_TURNS`: caller/agent turns per scenario.
- `BOT_TO_BOT_TASK_DEADLINE_SECONDS`: worker deadline.
- `BOT_TO_BOT_TTS_ENABLED`: enable GCP TTS audio artifacts.
- `BOT_TO_BOT_CALLER_MODEL`: low-cost caller LLM.
- `BOT_TO_BOT_JUDGE_MODEL`: LLM-as-judge model.

## 10k Call Plan

Run 10,000 total jobs through Cloud Tasks/Pub/Sub with provider-specific concurrency limits. Do not run 10,000 PSTN calls concurrently. Use WebRTC/runner mode for scale tests, then sample 5-50 real phone calls for final realism.
