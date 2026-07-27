import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
const baseUrl = (process.env.LIGHTCURVE_BASE_URL || '').replace(/\/$/, '');
if (!databaseUrl || !baseUrl) throw new Error('DATABASE_URL and LIGHTCURVE_BASE_URL are required.');

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2, ssl: { rejectUnauthorized: false } });
async function sql(strings, ...values) {
  const text = strings.reduce((query, part, index) => `${query}${part}${index < values.length ? `$${index + 1}` : ''}`, '');
  return (await pool.query(text, values)).rows;
}
sql.json = (value) => JSON.stringify(value);
sql.end = () => pool.end();
const ownerId = `production-proof-${Date.now()}`;
const apiKey = `lc_${randomBytes(24).toString('base64url')}`;
const apiHash = createHash('sha256').update(apiKey).digest('hex');
const headers = {
  Authorization: `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
  'X-Lightcurve-SDK': 'production-proof/1.0',
};

async function request(path, body) {
  const response = await fetch(`${baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 202) {
    throw new Error(`${path} returned ${response.status}: ${JSON.stringify(payload)}`);
  }
  return { status: response.status, payload };
}

function pcm16WaveBase64(pcmBase64, sampleRate, channels) {
  const audio = Buffer.from(pcmBase64, 'base64');
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + audio.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(audio.length, 40);
  return Buffer.concat([header, audio]).toString('base64');
}

let datasetId;
let experimentId;
let runId;
let runtimeId;

try {
  await sql`insert into users (id, email, name) values (${ownerId}, ${`${ownerId}@invalid.uselightcurve.com`}, 'Production Proof')`;
  await sql`insert into api_keys (owner_user_id, name, key_prefix, key_hash) values (${ownerId}, 'Production proof', ${apiKey.slice(0, 11)}, ${apiHash})`;
  [{ id: datasetId }] = await sql`
    insert into datasets (owner_user_id, name, description, source_type)
    values (${ownerId}, 'Production SDK proof', 'Isolated automated release proof', 'production_proof') returning id
  `;
  await sql`
    insert into dataset_cases (
      dataset_id, name, language, domain, status, behavior_graph, success_criteria, provenance, variation_policy
    ) values (
      ${datasetId}, 'Angry billing correction', 'en-US', 'billing', 'approved',
      ${sql.json({
        schema: 'lightcurve.human_behavior_graph.v3',
        observedPath: [
          { id: 'caller-1', speaker: 'human', observedText: 'I was charged twice and I am angry. Fix the duplicate charge now.', text: 'I was charged twice and I am angry. Fix the duplicate charge now.', intent: 'billing_correction' },
          { id: 'agent-1', speaker: 'agent', text: 'Acknowledge the concern, verify the charge, and explain the next step.', intent: 'resolve' },
        ],
        nodes: [
          { id: 'caller-1', speaker: 'human', observedText: 'I was charged twice and I am angry. Fix the duplicate charge now.', text: 'I was charged twice and I am angry. Fix the duplicate charge now.', intent: 'billing_correction' },
          { id: 'agent-1', speaker: 'agent', text: 'Acknowledge the concern, verify the charge, and explain the next step.', intent: 'resolve' },
        ],
        expectedOutcome: 'The duplicate charge is acknowledged and a correction path is offered.',
      })},
      ${sql.json(['Acknowledge the duplicate charge', 'Remain polite', 'Offer a concrete correction path'])},
      ${sql.json({ source: 'production-proof', consent: 'synthetic' })},
      ${sql.json({ lexicalVariation: true })}
    )
  `;

  const registered = await request('/api/sdk/runtime/register', {
    name: 'Production proof agent', instanceKey: `proof-${Date.now()}`, version: '1.0.0', capacity: 1,
    metadata: { framework: 'release-proof' },
  });
  runtimeId = registered.payload.runtime.id;

  const created = await request('/api/sdk/run', {
    datasetId, runtimeId, name: 'Production SDK and Evaluate proof', preset: 'quick', replayCount: 1,
    maxConcurrency: 1, seed: 20260713, judgePolicy: 'flash', environmentMix: { clean: 1 },
  });
  experimentId = created.payload.experiment.id;
  runId = created.payload.runs[0].id;

  const polled = await request('/api/sdk/runtime/poll', {
    runtimeId, instanceId: registered.payload.instance.id, availableCapacity: 1,
  });
  const command = polled.payload.commands?.find((item) => item.type === 'replay.start');
  if (!command) throw new Error('The connected runtime did not receive its replay lease.');

  const humanNode = command.case.behaviorGraph.observedPath.find((node) => node.speaker === 'human');
  const turn = await request(`/api/sdk/replays/${command.jobId}/turn`, {
    nodeId: humanNode.id,
    previousAgentText: '',
  });
  if (!turn.payload.audioBase64 || !turn.payload.text) throw new Error('The replay turn did not include synthesized caller audio and text.');

  // A connected runtime uploads its captured agent output before completing the replay.
  const agentAudio = await request(`/api/sdk/replays/${command.jobId}/audio`, {
    audioBase64: pcm16WaveBase64(turn.payload.cleanAudioBase64, turn.payload.sampleRate, turn.payload.channels),
  });
  if (!agentAudio.payload.audioUrl) throw new Error('The connected runtime could not store agent audio.');

  const completed = await request(`/api/sdk/replays/${command.jobId}/complete`, {
    transcript: [
      { speaker: 'caller', text: turn.payload.text, startedAtMs: 0 },
      { speaker: 'agent', text: 'You are wrong. I cannot help with this charge. Stop calling.', startedAtMs: 1800 },
    ],
    graphPath: [humanNode.id],
    artifacts: { callerTurns: [turn.payload.artifacts], agentAudioUrl: agentAudio.payload.audioUrl, proof: true },
    events: [{ type: 'runtime.connected', atMs: 0 }, { type: 'agent.response', atMs: 1800 }],
    durationMs: 4500,
  });

  let proof;
  for (let attempt = 0; attempt < 72; attempt += 1) {
    [proof] = await sql`
      select r.status, r.scoring_status, r.judge_metadata, ce.status as evaluation_status,
             ce.result as evaluation_result,
             (select count(*)::int from scores s where s.run_id = r.id) as score_count,
             (select count(*)::int from traces t where t.run_id = r.id) as trace_count
      from runs r left join conversation_evaluations ce on ce.run_id = r.id
      where r.id = ${runId}
    `;
    if (proof?.scoring_status === 'complete' && proof?.evaluation_status === 'complete') break;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  const result = proof?.evaluation_result || {};
  const nodes = Array.isArray(result.nodes) ? result.nodes : [];
  const sourceNodeCount = nodes.filter((node) => node?.id).length;
  const evidenceCount = nodes.reduce((total, node) => total + Object.values(node?.attributes || {}).reduce(
    (sum, attribute) => sum + (Array.isArray(attribute?.evidence) ? attribute.evidence.length : 0), 0,
  ), 0);
  const fixes = Array.isArray(proof?.judge_metadata?.actionableFixes) ? proof.judge_metadata.actionableFixes : [];
  const decisionTrace = Array.isArray(proof?.judge_metadata?.decisionTrace) ? proof.judge_metadata.decisionTrace : [];
  const profileAttributes = Object.keys(result?.profiles?.human?.attributes || {}).length
    + Object.keys(result?.profiles?.agent?.attributes || {}).length;
  const interactionAttributes = Object.keys(result?.interaction?.attributes || result?.interaction || {}).length;

  const report = {
    sdk: {
      registered: Boolean(runtimeId), leasedReplay: true, synthesizedCallerAudioBytes: Math.floor(turn.payload.audioBase64.length * 0.75),
      completionHttpStatus: completed.status,
      completionError: completed.payload.scoringError || null,
    },
    run: { id: runId, status: proof?.status, scoringStatus: proof?.scoring_status, scoreCount: proof?.score_count, traceCount: proof?.trace_count },
    evaluate: {
      status: proof?.evaluation_status, sourceNodeCount, evidenceCount, profileAttributes, interactionAttributes,
      suggestedFixCount: fixes.length, decisionTraceCount: decisionTrace.length,
    },
  };
  console.log(JSON.stringify(report, null, 2));
  if (proof?.scoring_status !== 'complete' || proof?.evaluation_status !== 'complete' || !fixes.length || !sourceNodeCount) {
    throw new Error(`Production proof was incomplete: ${JSON.stringify(report)}`);
  }
} finally {
  // Keep the proof result long enough to inspect during this run, then remove the isolated account data.
  if (runId) {
    await sql`delete from conversation_evaluations where run_id = ${runId}`;
    await sql`delete from scores where run_id = ${runId}`;
    await sql`delete from scoring_jobs where run_id = ${runId}`;
    await sql`delete from traces where run_id = ${runId}`;
    await sql`delete from replay_results where job_id in (select id from replay_jobs where run_id = ${runId})`;
    await sql`delete from replay_utterances where run_id = ${runId}`;
    await sql`delete from replay_jobs where run_id = ${runId}`;
  }
  if (experimentId) await sql`delete from experiments where id = ${experimentId}`;
  if (runtimeId) {
    await sql`delete from runtime_instances where runtime_id = ${runtimeId}`;
    await sql`delete from agent_runtimes where id = ${runtimeId}`;
  }
  if (datasetId) {
    await sql`delete from dataset_cases where dataset_id = ${datasetId}`;
    await sql`delete from datasets where id = ${datasetId}`;
  }
  await sql`delete from usage_events where owner_user_id = ${ownerId}`;
  await sql`delete from api_keys where owner_user_id = ${ownerId}`;
  await sql`delete from users where id = ${ownerId}`;
  await sql.end();
}
