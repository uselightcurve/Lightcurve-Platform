# Lightcurve SDK Integration Guide

The Lightcurve Python SDK provides **auto-instrumentation** for the most popular Voice AI frameworks, including **Pipecat** and **LiveKit**. 

With just two lines of code, the SDK hooks deeply into your agent's runtime. It automatically captures audio streams, intercepts tool/function calls, and tracks latency metrics with millisecond precision—enabling you to instantly use Lightcurve's Audio Library and automated replays without restructuring your application.

## 1. Installation

Install the Python SDK into your agent's environment:

```bash
pip install lightcurve
```

## 2. Environment Variables

Your agent needs to know which Lightcurve environment to connect to. Set the following environment variables in your deployment or `.env` file:

```env
# Required: Your project's API key
LIGHTCURVE_API_KEY="lc_..."

# Optional: Identify your agent in the Lightcurve Dashboard
LIGHTCURVE_AGENT_NAME="My Customer Support Agent"

# Optional: How many simultaneous replays this agent instance can handle (Default: 1)
LIGHTCURVE_CAPACITY="5"
```

## 3. Initialization (The 2 Lines of Code)

To enable Lightcurve, simply import the runtime module and call `start()` at the very top of your application's entry point, before you initialize your agent framework.

```python
import lightcurve.runtime

# Initialize Lightcurve auto-instrumentation
lightcurve.runtime.start()

# ... continue with your normal Pipecat or LiveKit setup
```

That's it! Lightcurve runs quietly in a background thread and waits for instructions from the Lightcurve Dashboard. 

---

## How Auto-Instrumentation Works

When `start()` is called, Lightcurve safely patches your underlying framework to automatically track everything required for full Semantic Graph generation and Replay Evaluation.

### Pipecat Integration
If you are using Pipecat, Lightcurve automatically attaches an observer to the `PipelineWorker`. 
* **Audio:** It intercepts `OutputAudioRawFrame` to record the agent's voice, and injects simulated caller audio directly into the pipeline during replays via `InputAudioRawFrame`.
* **Transcripts:** It intercepts `TranscriptionFrame` and `LLMTextFrame`/`TTSTextFrame` to accurately reconstruct the conversation.
* **Tools & Latency:** It captures `FunctionCallsStartedFrame`, `FunctionCallResultFrame`, and `InterruptionFrame` to perfectly map when tools are fired and how the agent reacts to being interrupted.

### LiveKit Integration
If you are using LiveKit Agents (`VoiceAssistant`), Lightcurve automatically instruments the `JobContext` and the `VoiceAssistant` itself.
* **Audio:** It instruments the `rtc.AudioSource` to capture the agent's raw audio output, and uses a virtual microphone source to inject perfectly-timed replay audio over the WebRTC transport.
* **Transcripts:** It binds to LiveKit's `user_speech_committed` and `agent_speech_committed` events.
* **Tools & Latency:** It tracks `agent_started_speaking`, `agent_stopped_speaking`, `function_calls_collected`, and `function_calls_finished` to ensure backend tool execution and VAD latencies are tracked with millisecond precision.

## Next Steps

Once the SDK is running:
1. Go to the **Playground** in your Lightcurve Dashboard.
2. Ensure your agent is running locally or in production.
3. Your agent's name should appear as **Connected** in the top right of the Playground.
4. Click **Start Call** to capture your first human interaction!

---

# JavaScript / TypeScript SDK (Triggering Experiments)

While the Python SDK is used for instrumenting the agent, the **JavaScript / TypeScript SDK** is used for programmatically triggering datasets and managing experiments from your CI/CD pipeline or Node.js backend.

## 1. Installation

Install the `@uselightcurve/sdk` package into your Node.js or TypeScript project:

```bash
npm install @uselightcurve/sdk
```

## 2. Usage

You can use the JS SDK to trigger replays programmatically. This is especially useful for running regression tests during GitHub Actions or CI/CD pipelines.

```typescript
import { Lightcurve } from '@uselightcurve/sdk';

// Initialize the client.
// It will automatically pick up LIGHTCURVE_API_KEY from your environment.
const client = new Lightcurve();

async function runEvals() {
  console.log('Starting Voice AI Regression Evals...');

  // Trigger a run of your dataset
  const runResponse = await client.datasets.run({
    datasetId: 'dataset_123abc',
    name: 'CI/CD Regression Run',
    gitSha: process.env.GITHUB_SHA, // Track which commit triggered the eval
  });

  console.log(`Experiment started: ${runResponse.experiment.id}`);

  // Wait for the experiment to complete
  // (In a real pipeline, you would poll getDatasetRun until the status is 'complete')
  const status = await client.datasets.getDatasetRun(runResponse.experiment.id);
  console.log(`Current Status: ${status.experiment.status}`);
}

runEvals();
```
