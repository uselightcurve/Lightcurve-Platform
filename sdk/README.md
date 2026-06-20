# Lightcurve JavaScript SDK

The JavaScript package provides dataset automation for CI/CD:

```bash
npm install @uselightcurve/sdk
```

```ts
import { Lightcurve } from '@uselightcurve/sdk';

const lightcurve = new Lightcurve({ apiKey: process.env.LIGHTCURVE_API_KEY });
const { datasets } = await lightcurve.listDatasets();
const run = await lightcurve.runDataset({ datasetId: datasets[0].id });
```

Realtime Pipecat instrumentation is currently provided by the Python package.
No phone number, SIP URI, room token, runner endpoint, or provider credential is used.
