import assert from 'node:assert/strict';
import test from 'node:test';
import { requiresProAdjudication } from './voiceScoring';

test('Pro adjudication follows confidence, borderline, hard-constraint, and explicit policies', () => {
  assert.equal(requiresProAdjudication({ confidence: 0.79, overall: 0.9, hardConstraintFailure: false }), true);
  assert.equal(requiresProAdjudication({ confidence: 0.95, overall: 0.8, hardConstraintFailure: false }), true);
  assert.equal(requiresProAdjudication({ confidence: 0.95, overall: 0.9, hardConstraintFailure: true }), true);
  assert.equal(requiresProAdjudication({ confidence: 0.95, overall: 0.9, hardConstraintFailure: false }), false);
  assert.equal(requiresProAdjudication({ confidence: 0.1, overall: 0.75, hardConstraintFailure: true }, 'flash'), false);
  assert.equal(requiresProAdjudication({ confidence: 1, overall: 1, hardConstraintFailure: false }, 'pro'), true);
});
