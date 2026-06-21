# Lightcurve

Human-grounded end-to-end evaluation for voice agents.

Every evaluation begins with a real human call in the Playground. Lightcurve
captures the interaction, converts it into a versioned behavior graph, and
stores it as a Case in a Dataset. The case can then be replayed across prompts,
models, infrastructure, and agent versions without using the telephone network.

## Agent setup

Python and Pipecat are supported first:

```bash
pip install --upgrade use-lightcurve
```

```python
import lightcurve.auto
```

Set `LIGHTCURVE_API_KEY` in the agent environment. The SDK registers the
running pipeline, receives browser WebRTC audio, captures Pipecat frames, and
reports evaluation events. Developers do not configure rooms, phone numbers,
SIP, callbacks, runner URLs, or provider credentials.

## Platform setup

1. Copy `.env.example` to `.env` and configure the database, Clerk, Google
   Cloud, billing, and Lightcurve-operated STUN/TURN values.
2. Install dependencies with `npm install`.
3. Apply the schema with `npm run db:push`.
4. Start the application with `npm run dev`.

## Dataset CI/CD

```ts
import { Lightcurve } from '@uselightcurve/sdk';

const lightcurve = new Lightcurve({ apiKey: process.env.LIGHTCURVE_API_KEY });
const { datasets } = await lightcurve.listDatasets();
const run = await lightcurve.runDataset({
  datasetId: datasets[0].id,
  gitSha: process.env.GITHUB_SHA,
});

console.log(run.experiment.id);
```

See [the architecture guide](docs/human-grounded-architecture.md) for the
capture, graph derivation, privacy, and replay boundaries.
