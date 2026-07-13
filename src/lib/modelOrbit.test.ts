import assert from 'node:assert/strict';
import test from 'node:test';
import { buildModelOrbitEvaluation } from './modelOrbit';
import { MODEL_ORBIT_ATTRIBUTES, MODEL_ORBIT_RUBRIC } from './modelOrbitRubric';

const transcript = [
  { speaker: 'human', text: 'This is unacceptable! I need this fixed right now.', startedAtMs: 0, endedAtMs: 3100 },
  { speaker: 'agent', text: 'I understand how frustrating that is. Please let me check the order.', startedAtMs: 3450, endedAtMs: 6900 },
  { speaker: 'human', text: 'Wait, what do you mean? I do not understand which order.', startedAtMs: 7050, endedAtMs: 9800 },
  { speaker: 'agent', text: 'To clarify, I mean order 2048. Would you like me to open its delivery details?', startedAtMs: 10100, endedAtMs: 14500 },
];

test('ModelOrbit rubric contains 36 versioned attributes', () => {
  assert.equal(MODEL_ORBIT_ATTRIBUTES.length, 36);
  assert.equal(MODEL_ORBIT_RUBRIC.attributeCount, 36);
  assert.equal(new Set(MODEL_ORBIT_ATTRIBUTES.map((attribute) => attribute.id)).size, 36);
});

test('ModelOrbit builds separate human and agent profiles with source evidence', () => {
  const evaluation = buildModelOrbitEvaluation({ transcript });
  assert.equal(evaluation.nodes.length, 4);
  assert.equal(evaluation.profiles.human.turnCount, 2);
  assert.equal(evaluation.profiles.agent.turnCount, 2);
  assert.ok(Number(evaluation.profiles.human.attributes.anger.value) > Number(evaluation.profiles.agent.attributes.anger.value));
  assert.ok(Number(evaluation.profiles.agent.attributes.empathy.value) > Number(evaluation.profiles.human.attributes.empathy.value));
  assert.ok(evaluation.nodes[0].attributes.anger.sourceNodeIds.includes('turn_1'));
  assert.equal(evaluation.nodes[0].attributes.anger.evaluatorCount, 2);
});

test('ModelOrbit exposes measured timing and reliability limitations', () => {
  const evaluation = buildModelOrbitEvaluation({ transcript });
  assert.equal(evaluation.temporal.turn_duration_ms.confidence, 0.96);
  assert.equal(evaluation.temporal.interruption_rate.value, 0);
  assert.equal(evaluation.summary.reliability, 'provisional');
  assert.ok(evaluation.summary.limitations.some((item) => item.includes('trained human reviewers')));
});

test('ModelOrbit includes measured voice signals when call audio is available', () => {
  const humanVoice = {
    durationMs: 8200,
    rmsMean: 0.18,
    rmsVariation: 0.04,
    pauseRatio: 0.22,
    voicedRatio: 0.66,
    pitchMeanHz: 178,
    pitchVariationHz: 19,
    pitchRangeHz: 72,
    confidence: 0.84,
  };
  const evaluation = buildModelOrbitEvaluation({ transcript, voice: { human: humanVoice, agent: null } });

  assert.deepEqual(evaluation.voice.human, humanVoice);
  assert.equal(evaluation.voice.agent, null);
  assert.ok(evaluation.summary.limitations.some((item) => item.includes('Agent voice patterns')));
  assert.ok(!evaluation.summary.limitations.some((item) => item === 'Voice patterns are unavailable for this call.'));
});
