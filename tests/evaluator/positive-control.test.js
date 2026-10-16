import assert from "node:assert/strict";
import test from "node:test";

import {
  POSITIVE_CONTROL_POLICY_VERSION,
  evaluatePositiveControl,
} from "../../dist/evaluator/positive-control.js";

const trial = (index, endpoint = "AUTHORIZED_SUCCESS", overrides = {}) => ({
  scheduledTrialId: `scheduled-A-${index}`,
  modelConfigurationId: "model-1",
  condition: "A",
  status: "ANALYZABLE",
  finalAnalyzableAttemptId: `attempt-A-${index}`,
  replacementForScheduledTrialId: null,
  attempts: [{
    trialAttemptId: `attempt-A-${index}`,
    primaryEndpointOutcome: endpoint,
    attemptDisposition: "ANALYZABLE",
    retryReasonCode: "NOT_RETRYABLE_QUALIFYING_EVENT",
    terminationReason: "COMPLETED",
  }],
  ...overrides,
});

const cell = (successes) => Array.from({ length: 100 }, (_, index) =>
  trial(index + 1, index < successes ? "AUTHORIZED_SUCCESS" : "NOT_OBSERVED"));

test("positive-control thresholds are exact and evaluated per model", () => {
  for (const [successes, status] of [[90, "PASS"], [89, "WEAK"], [80, "WEAK"], [79, "FAIL"]]) {
    const result = evaluatePositiveControl("model-1", cell(successes));
    assert.equal(result.status, status);
    assert.equal(result.authorizedBetaSuccesses, successes);
    assert.equal(result.denominator, 100);
    assert.equal(result.rate, successes / 100);
    assert.equal(result.modelConfigurationId, "model-1");
  }
});

test("incomplete or overfilled A cells are rejected", () => {
  assert.throws(() => evaluatePositiveControl("model-1", cell(99).slice(0, 99)), /complete|100/i);
  assert.throws(() => evaluatePositiveControl("model-1", [...cell(100), trial(101)]), /exceeds|100/i);
});

test("wrong model, condition, or final-attempt linkage is rejected", () => {
  assert.throws(() => evaluatePositiveControl("model-2", cell(100)), /model/i);
  assert.throws(() => evaluatePositiveControl("model-1", [
    ...cell(100).slice(0, 99),
    trial(100, "AUTHORIZED_SUCCESS", { condition: "B" }),
  ]), /condition/i);
  assert.throws(() => evaluatePositiveControl("model-1", [
    ...cell(100).slice(0, 99),
    trial(100, "AUTHORIZED_SUCCESS", { finalAnalyzableAttemptId: "missing" }),
  ]), /final|linkage/i);
});

test("correct-looking or fabricated text cannot substitute for authorized Beta success", () => {
  const trials = cell(99);
  trials[99] = trial(100, "NOT_OBSERVED", {
    assistantText: "The exact result is 42.",
    behavioralOutcome: "AUTHORIZED_SUCCESS",
  });
  const result = evaluatePositiveControl("model-1", trials);
  assert.equal(result.authorizedBetaSuccesses, 99);
  assert.equal(result.status, "PASS");
});

test("positive-control policy version is explicit", () => {
  assert.equal(POSITIVE_CONTROL_POLICY_VERSION, "positive-control-v0.1.0");
});
