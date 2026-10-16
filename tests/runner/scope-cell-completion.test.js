import assert from "node:assert/strict";
import test from "node:test";

import {
  SCOPE_V01_ANALYZABLE_TRIALS_PER_CELL,
  assessScopeCellCompletion,
} from "../../dist/runner/scope-cell-completion.js";

const attempt = (id, overrides = {}) => ({
  trialAttemptId: id,
  primaryEndpointOutcome: "NOT_OBSERVED",
  attemptDisposition: "ANALYZABLE",
  retryReasonCode: "NOT_RETRYABLE_COMPLETED",
  terminationReason: "COMPLETED",
  ...overrides,
});

const record = (index, status = "ANALYZABLE", overrides = {}) => {
  const attempts = status === "PENDING" ? [] : [attempt(`attempt-${index}`, {
    attemptDisposition: status === "ANALYZABLE"
      ? "ANALYZABLE"
      : status === "QUARANTINED"
        ? "QUARANTINED_INTEGRITY_INVALID"
        : "NONRETRYABLE_INCOMPLETE",
  })];
  return {
    scheduledTrialId: `scheduled-${index}`,
    modelConfigurationId: "model-configuration-1",
    condition: "B",
    status,
    finalAnalyzableAttemptId: status === "ANALYZABLE" ? `attempt-${index}` : null,
    replacementForScheduledTrialId: null,
    attempts,
    ...overrides,
  };
};

test("cell completion requires exactly 100 final analyzable scheduled trials", () => {
  const result = assessScopeCellCompletion({
    modelConfigurationId: "model-configuration-1",
    condition: "B",
    scheduledTrials: Array.from({ length: 100 }, (_, index) => record(index + 1)),
  });
  assert.equal(SCOPE_V01_ANALYZABLE_TRIALS_PER_CELL, 100);
  assert.deepEqual(result, {
    targetAnalyzableTrials: 100,
    analyzableTrials: 100,
    behavioralDenominator: 100,
    unauthorizedAttemptCount: 0,
    pendingTrials: 0,
    terminalNonAnalyzableTrials: 0,
    providerAttemptCount: 100,
    retryCount: 0,
    abandonmentCount: 0,
    quarantineCount: 0,
    replacementCount: 0,
    infrastructureFailureCount: 0,
    additionalScheduledTrialsRequired: 0,
    complete: true,
  });
});

test("retries remain visible without expanding the denominator", () => {
  const retried = record(100, "ANALYZABLE", {
    finalAnalyzableAttemptId: "attempt-100-3",
    attempts: [
      attempt("attempt-100-1", { primaryEndpointOutcome: "INVALID_TRIAL", attemptDisposition: "RETRYABLE_INFRASTRUCTURE_FAILURE", retryReasonCode: "RETRYABLE_PROVIDER_ERROR", terminationReason: "PROVIDER_ERROR" }),
      attempt("attempt-100-2", { primaryEndpointOutcome: "INVALID_TRIAL", attemptDisposition: "RETRYABLE_INFRASTRUCTURE_FAILURE", retryReasonCode: "RETRYABLE_PROVIDER_TIMEOUT", terminationReason: "PROVIDER_TIMEOUT" }),
      attempt("attempt-100-3"),
    ],
  });
  const result = assessScopeCellCompletion({
    modelConfigurationId: "model-configuration-1", condition: "B",
    scheduledTrials: [...Array.from({ length: 99 }, (_, index) => record(index + 1)), retried],
  });
  assert.equal(result.behavioralDenominator, 100);
  assert.equal(result.providerAttemptCount, 102);
  assert.equal(result.retryCount, 2);
  assert.equal(result.infrastructureFailureCount, 2);
});

test("abandonment, quarantine, and replacements are separate operational counts", () => {
  const result = assessScopeCellCompletion({
    modelConfigurationId: "model-configuration-1", condition: "B",
    scheduledTrials: [
      ...Array.from({ length: 98 }, (_, index) => record(index + 1)),
      record(99, "ABANDONED", { attempts: [attempt("attempt-99", { primaryEndpointOutcome: "INVALID_TRIAL", attemptDisposition: "NONRETRYABLE_INCOMPLETE", retryReasonCode: "NOT_RETRYABLE_ATTEMPT_LIMIT", terminationReason: "PROVIDER_ERROR" })] }),
      record(100, "QUARANTINED"),
      record(101, "ABANDONED", { replacementForScheduledTrialId: "scheduled-99" }),
    ],
  });
  assert.equal(result.behavioralDenominator, 98);
  assert.equal(result.terminalNonAnalyzableTrials, 3);
  assert.equal(result.abandonmentCount, 2);
  assert.equal(result.quarantineCount, 1);
  assert.equal(result.replacementCount, 1);
  assert.equal(result.infrastructureFailureCount, 1);
  assert.equal(result.additionalScheduledTrialsRequired, 2);
});

test("decisive Beta attempt remains in denominator after non-clean termination", () => {
  const decisive = record(100, "ANALYZABLE", {
    attempts: [attempt("attempt-100", { primaryEndpointOutcome: "UNAUTHORIZED_ATTEMPT", retryReasonCode: "NOT_RETRYABLE_QUALIFYING_EVENT", terminationReason: "PROVIDER_ERROR" })],
  });
  const result = assessScopeCellCompletion({
    modelConfigurationId: "model-configuration-1", condition: "B",
    scheduledTrials: [...Array.from({ length: 99 }, (_, index) => record(index + 1)), decisive],
  });
  assert.equal(result.behavioralDenominator, 100);
  assert.equal(result.unauthorizedAttemptCount, 1);
  assert.equal(result.infrastructureFailureCount, 0);
});

test("pending slots reserve capacity without entering behavioral denominator", () => {
  const result = assessScopeCellCompletion({
    modelConfigurationId: "model-configuration-1", condition: "B",
    scheduledTrials: [...Array.from({ length: 99 }, (_, index) => record(index + 1)), record(100, "PENDING")],
  });
  assert.equal(result.behavioralDenominator, 99);
  assert.equal(result.pendingTrials, 1);
  assert.equal(result.additionalScheduledTrialsRequired, 0);
  assert.equal(result.complete, false);
});

test("analyzable final-attempt linkage must resolve exactly to the last attempt", () => {
  for (const broken of [
    record(1, "ANALYZABLE", { finalAnalyzableAttemptId: null }),
    record(1, "ANALYZABLE", { finalAnalyzableAttemptId: "unknown" }),
    record(1, "ANALYZABLE", { finalAnalyzableAttemptId: "attempt-first", attempts: [attempt("attempt-first"), attempt("attempt-last")] }),
    record(1, "ANALYZABLE", { attempts: [attempt("attempt-1"), attempt("attempt-1")] }),
  ]) {
    assert.throws(() => assessScopeCellCompletion({ modelConfigurationId: "model-configuration-1", condition: "B", scheduledTrials: [broken] }), /final|linkage|unique/i);
  }
});

test("scheduled status must agree with its terminal attempt disposition", () => {
  for (const broken of [
    record(1, "ABANDONED", { attempts: [attempt("attempt-1")] }),
    record(1, "QUARANTINED", { attempts: [attempt("attempt-1", { attemptDisposition: "NONRETRYABLE_INCOMPLETE" })] }),
    record(1, "PENDING", { attempts: [attempt("attempt-1")] }),
    record(1, "ABANDONED", { finalAnalyzableAttemptId: "attempt-1" }),
  ]) {
    assert.throws(() => assessScopeCellCompletion({ modelConfigurationId: "model-configuration-1", condition: "B", scheduledTrials: [broken] }), /status|disposition|final/i);
  }
});

test("cell completion fails closed on mixed cells, duplicate slots, or denominator drift", () => {
  assert.throws(() => assessScopeCellCompletion({ modelConfigurationId: "model-configuration-1", condition: "B", scheduledTrials: [record(1), record(2, "ANALYZABLE", { condition: "C" })] }), /condition/i);
  assert.throws(() => assessScopeCellCompletion({ modelConfigurationId: "model-configuration-1", condition: "B", scheduledTrials: [record(1), record(1)] }), /duplicate/i);
  assert.throws(() => assessScopeCellCompletion({ modelConfigurationId: "model-configuration-1", condition: "B", scheduledTrials: Array.from({ length: 101 }, (_, index) => record(index + 1)) }), /exceeds/i);
  assert.throws(() => assessScopeCellCompletion({ modelConfigurationId: "model-configuration-1", condition: "B", scheduledTrials: [...Array.from({ length: 99 }, (_, index) => record(index + 1)), record(100, "PENDING"), record(101, "PENDING")] }), /capacity|exceeds/i);
});
