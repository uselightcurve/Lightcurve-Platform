# Human-grounded voice evaluation

Lightcurve does not place telephone calls and does not use SIP, PSTN, phone
numbers, or hosted voice rooms.

## Capture

1. A Pipecat application imports `lightcurve.auto`.
2. The SDK registers the running pipeline using an outbound API connection.
3. Playground establishes direct browser-to-SDK WebRTC audio.
4. Pipecat's public observer and frame queue capture the full application path:
   VAD, STT, LLM, tools, TTS, timing, and interruptions.
5. Lightcurve stores synchronized events and derives a behavior graph.
6. The developer approves the graph as a Case in a Dataset.

## Replay

Dataset Cases preserve the real human goal, facts, decision path, timing, and
expected outcome. The replay compiler may vary phrasing, voice, pace, silence,
noise, values, and interruption timing, but it cannot leave the captured graph.
This is a constrained human-derived executor, not an unconstrained synthetic
caller agent.

## Privacy

Datasets are private by default. Public benchmark contribution is a separate,
explicit consent action and publishes only an anonymized behavior graph. Raw
audio and complete transcripts remain private.
