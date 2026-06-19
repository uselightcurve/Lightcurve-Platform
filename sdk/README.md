# Lightcurve SDK

Use `@uselightcurve/sdk` to create voice-agent sandbox tests, start experiment suites, and generate short-lived Lightcurve room credentials for one-off agent checks.

## Install

```bash
npm install @uselightcurve/sdk
```

## Create a Lightcurve room test

This is the low-friction path for agents that can join a realtime room. It does not require a provider API key.

```ts
import { Lightcurve } from '@uselightcurve/sdk';

const lightcurve = new Lightcurve({
  baseUrl: 'https://app.uselightcurve.com',
  includeCredentials: true,
});

const test = await lightcurve.createLightcurveRoomTest({
  name: 'email capture smoke',
  scenarioIds: ['scenario-id-from-lightcurve'],
});

console.log(test.room.liveKitUrl);
console.log(test.room.roomName);
console.log(test.room.agentToken);
```

## Run a suite

```ts
import { Lightcurve, providers } from '@uselightcurve/sdk';

const lightcurve = new Lightcurve({
  baseUrl: 'https://app.uselightcurve.com',
  includeCredentials: true,
});

const result = await lightcurve.runSuite({
  name: 'refund regression',
  ...providers.agentReplica({
    instructions: 'Follow policy, verify the customer, and confirm the next step.',
  }),
  scenarioIds: ['scenario-a', 'scenario-b'],
});

console.log(result.mos, result.taskCompletion);
```

## Auth note

For browser or dashboard-embedded usage, pass `includeCredentials: true` so Clerk session cookies authenticate requests. Server-to-server API keys require a workspace API-key model and should not be treated as production-ready until that table and ownership flow are added.
