# Lightcurve Python SDK

Install Lightcurve in a Pipecat voice-agent project:

```bash
pip install use-lightcurve
```

Set the workspace API key:

```bash
LIGHTCURVE_API_KEY=lc_...
```

Load Lightcurve once, before constructing the Pipecat pipeline:

```python
import lightcurve.auto
```

That is the complete agent integration. Lightcurve discovers the Pipecat worker,
handles Playground WebRTC audio, captures pipeline events, and receives dataset
replay jobs. No phone number, SIP service, room token, runner URL, callback, or
provider credential is required.

Dataset automation is also available from Python:

```python
from lightcurve import Lightcurve

lc = Lightcurve()
datasets = lc.list_datasets()
run = lc.run_dataset(dataset_id=datasets["datasets"][0]["id"])
```
