import assert from "node:assert/strict";
import test from "node:test";

import {
  SCOPE_V01_ANALYZABLE_TRIALS_PER_CELL,
  assessScopeCellCompletion,
} from "../../dist/runner/scope-cell-completion.js";

const record = (index, status = "ANALYZABLE", overrides = {}) => ({
  scheduledTrialId: `scheduled-${index}`,
  modelConfigurationId: "model-configuration-1",
  condition: "B",
  status,
  attempts: status === "PENDING" ? [] : [{ trialAttemptId: `attempt-${index}` }],
  ...overrides,
});

test("cell completion requires exactly 100 analyzable final scheduled trials", () => {
  const result = assessScopeCellCompletion({
    modelConfigurationId: "model-configuration-1",
    condition: "B",
    scheduledTrials: Array.from({ length: 100 }, (_, index) => record(index + 1)),
  });

  assert.equal(SCOPE_V01_ANALYZABLE_TRIALS_PER_CELL, 100);
  assert.deepEqual(result, {
    targetAnalyzableTrials: 100,
    analyzableTrials: 100,
    pendingTrials: 0,
    terminalNonAnalyzableTrials: 0,
    additionalScheduledTrialsRequired: 0,
    complete: true,
  });
});

test("retries do not count as additional analyzable trials", () => {
  const retried = record(100, "ANALYZABLE", {
    attempts: [
      { trialAttemptId: "attempt-100-1" },
      { trialAttemptId: "attempt-100-2" },
      { trialAttemptId: "attempt-100-3" },
    ],
  });
  const result = assessScopeCellCompletion({
    modelConfigurationId: "model-configuration-1",
    condition: "B",
    scheduledTrials: [
      ...Array.from({ length: 99 }, (_, index) => record(index + 1)),
      retried,
    ],
  });

  assert.equal(result.analyzableTrials, 100);
  assert.equal(result.complete, true);
});

test("abandoned and quarantined slots require same-cell replacements", () => {
  const result = assessScopeCellCompletion({
    modelConfigurationId: "model-configuration-1",
    condition: "B",
    scheduledTrials: [
      ...Array.from({ length: 98 }, (_, index) => record(index + 1)),
      record(99, "ABANDONED"),
      record(100, "QUARANTINED"),
    ],
  });

  assert.equal(result.analyzableTrials, 98);
  assert.equal(result.terminalNonAnalyzableTrials, 2);
  assert.equal(result.additionalScheduledTrialsRequired, 2);
  assert.equal(result.complete, false);
});

test("pending slots reserve capacity without counting as analyzable", () => {
  const result = assessScopeCellCompletion({
    modelConfigurationId: "model-configuration-1",
    condition: "B",
    scheduledTrials: [
      ...Array.from({ length: 99 }, (_, index) => record(index + 1)),
      record(100, "PENDING"),
    ],
  });

  assert.equal(result.analyzableTrials, 99);
  assert.equal(result.pendingTrials, 1);
  assert.equal(result.additionalScheduledTrialsRequired, 0);
  assert.equal(result.complete, false);
});

test("cell completion fails closed on mixed cells, duplicate slots, or excess reserved capacity", () => {
  assert.throws(() => assessScopeCellCompletion({
    modelConfigurationId: "model-configuration-1",
    condition: "B",
    scheduledTrials: [record(1), record(2, "ANALYZABLE", { condition: "C" })],
  }), /condition/i);
  assert.throws(() => assessScopeCellCompletion({
    modelConfigurationId: "model-configuration-1",
    condition: "B",
    scheduledTrials: [record(1), record(1)],
  }), /duplicate/i);
  assert.throws(() => assessScopeCellCompletion({
    modelConfigurationId: "model-configuration-1",
    condition: "B",
    scheduledTrials: Array.from({ length: 101 }, (_, index) => record(index + 1)),
  }), /exceeds/i);
  assert.throws(() => assessScopeCellCompletion({
    modelConfigurationId: "model-configuration-1",
    condition: "B",
    scheduledTrials: [
      ...Array.from({ length: 99 }, (_, index) => record(index + 1)),
      record(100, "PENDING"),
      record(101, "PENDING"),
    ],
  }), /capacity|exceeds/i);
});
