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

## Connect an agent runner for microphone calls

The Playground connects to your agent through an HTTPS runner endpoint. Register and validate that endpoint with the SDK, then attach it to the room test:

```ts
const created = await lightcurve.agentConnections.create({
  provider: 'livekit',
  displayName: 'My voice agent',
  endpointType: 'webrtc',
  endpoint: 'https://agent.example.com/lightcurve',
  credentials: {},
});

await lightcurve.agentConnections.test(created.agentConnection.id);

const test = await lightcurve.createLightcurveRoomTest({
  name: 'microphone smoke test',
  scenarioIds: ['scenario-id-from-lightcurve'],
  agentConnectionId: created.agentConnection.id,
});
```

The runner endpoint must accept `GET` for the connection check. When the call starts, it receives a `POST` payload with `type: "lightcurve.room.connect"` and `room.liveKitUrl`, `room.roomName`, and the short-lived `room.agentToken`. Return a 2xx response after your agent has accepted the room join request.

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
