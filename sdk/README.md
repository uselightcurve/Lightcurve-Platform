# Lightcurve JavaScript SDK

The JavaScript client in this directory provides dataset automation for CI/CD.
It is currently an internal package and is not published to npm.

```ts
import { Lightcurve } from '@uselightcurve/sdk';

const lightcurve = new Lightcurve({ apiKey: process.env.LIGHTCURVE_API_KEY });
const { datasets } = await lightcurve.listDatasets();
const run = await lightcurve.runDataset({ datasetId: datasets[0].id });
```

Realtime Pipecat instrumentation is currently provided by the Python package.
No phone number, SIP URI, room token, runner endpoint, or provider credential is used.
