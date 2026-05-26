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
