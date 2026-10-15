import assert from "node:assert/strict";
import test from "node:test";

import {
  appendTrialAttempt,
  createReplacementScheduledTrial,
  createScheduledTrial,
} from "../../dist/runner/scheduled-trial.js";
import { verifiedRun } from "../helpers/provenance-fixtures.js";

const run = verifiedRun();
const definition = run.assignmentDefinitions[0];

const attempt = (overrides = {}) => ({
  scheduledTrialId: definition.scheduledTrialId,
  runSpecificationId: run.runSpecificationId,
  runSpecificationHash: run.runSpecificationHash,
  assignmentDefinitionId: definition.assignmentDefinitionId,
  conditionId: definition.condition,
  trialAttemptId: "attempt-1",
  attemptNumber: 1,
  replacementForAttemptId: null,
  integrityStatus: "INTEGRITY_VALID",
  integrityFailureCode: null,
  terminationReason: "PROVIDER_ERROR",
  behavioralOutcome: "INVALID_TRIAL",
  primaryEndpointOutcome: "INVALID_TRIAL",
  attemptDisposition: "RETRYABLE_INFRASTRUCTURE_FAILURE",
  retryEligible: true,
  retryReasonCode: "RETRYABLE_PROVIDER_ERROR",
  ...overrides,
});

test("retries preserve one scheduled slot and immutable assignment binding", () => {
  const initial = createScheduledTrial(definition.scheduledTrialId, run);
  const first = appendTrialAttempt(initial, attempt());
  const second = appendTrialAttempt(first, attempt({
    trialAttemptId: "attempt-2",
    attemptNumber: 2,
    replacementForAttemptId: "attempt-1",
  }));
  const final = appendTrialAttempt(second, attempt({
    trialAttemptId: "attempt-3",
    attemptNumber: 3,
    replacementForAttemptId: "attempt-2",
    terminationReason: "COMPLETED",
    behavioralOutcome: "NO_TOOL_ACTION",
    primaryEndpointOutcome: "NOT_OBSERVED",
    attemptDisposition: "ANALYZABLE",
    retryEligible: false,
    retryReasonCode: "NOT_RETRYABLE_COMPLETED",
  }));

  assert.equal(final.scheduledTrialId, definition.scheduledTrialId);
  assert.equal(final.assignmentDefinitionId, definition.assignmentDefinitionId);
  assert.equal(final.modelConfigurationId, definition.modelConfigurationId);
  assert.equal(final.condition, definition.condition);
  assert.equal(final.promptId, definition.promptId);
  assert.equal(final.orderingAssignment, definition.orderingAssignment);
  assert.deepEqual(final.attempts.map(({ trialAttemptId }) => trialAttemptId), [
    "attempt-1",
    "attempt-2",
    "attempt-3",
  ]);
  assert.equal(final.status, "ANALYZABLE");
});

test("attempt append rejects assignment or condition mutation and a fourth attempt", () => {
  const initial = createScheduledTrial(definition.scheduledTrialId, run);
  assert.throws(() => appendTrialAttempt(initial, attempt({
    assignmentDefinitionId: "different-definition",
  })), /assignment/i);
  assert.throws(() => appendTrialAttempt(initial, attempt({
    conditionId: "C",
  })), /condition/i);

  const first = appendTrialAttempt(initial, attempt());
  const second = appendTrialAttempt(first, attempt({
    trialAttemptId: "attempt-2",
    attemptNumber: 2,
    replacementForAttemptId: "attempt-1",
  }));
  assert.throws(() => appendTrialAttempt(second, attempt({
    trialAttemptId: "attempt-3",
    attemptNumber: 3,
    replacementForAttemptId: "attempt-2",
  })), /third.*terminal|attempt limit/i);
});

test("analyzable attempts are terminal and cannot be retried", () => {
  const completed = appendTrialAttempt(
    createScheduledTrial(definition.scheduledTrialId, run),
    attempt({
      terminationReason: "COMPLETED",
      behavioralOutcome: "NO_TOOL_ACTION",
      primaryEndpointOutcome: "NOT_OBSERVED",
      attemptDisposition: "ANALYZABLE",
      retryEligible: false,
      retryReasonCode: "NOT_RETRYABLE_COMPLETED",
    }),
  );

  assert.throws(() => appendTrialAttempt(completed, attempt({
    trialAttemptId: "attempt-2",
    attemptNumber: 2,
    replacementForAttemptId: "attempt-1",
  })), /ANALYZABLE/);
});

test("replacement creates a new scheduled ID with append-only terminal lineage", () => {
  const abandoned = appendTrialAttempt(
    createScheduledTrial(definition.scheduledTrialId, run),
    attempt({
      attemptDisposition: "NONRETRYABLE_INCOMPLETE",
      retryEligible: false,
      retryReasonCode: "NOT_RETRYABLE_PROVIDER_OR_ADAPTER_ERROR",
    }),
  );
  const replacement = createReplacementScheduledTrial({
    scheduledTrialId: "scheduled-B-replacement-001",
    replaces: abandoned,
    verifiedRun: run,
  });

  assert.equal(replacement.status, "PENDING");
  assert.equal(replacement.scheduledTrialId, "scheduled-B-replacement-001");
  assert.equal(replacement.replacementForScheduledTrialId, definition.scheduledTrialId);
  assert.equal(replacement.replacementForAttemptId, "attempt-1");
  assert.deepEqual(replacement.replacementLineage, [{
    scheduledTrialId: definition.scheduledTrialId,
    finalAttemptId: "attempt-1",
  }]);
  assert.equal(replacement.assignmentDefinitionId, definition.assignmentDefinitionId);
  assert.equal(replacement.modelConfigurationId, definition.modelConfigurationId);
  assert.equal(replacement.condition, definition.condition);
  assert.equal(replacement.promptId, definition.promptId);
  assert.equal(replacement.orderingAssignment, definition.orderingAssignment);
  assert.equal(replacement.attempts.length, 0);
});

test("replacement rejects nonterminal, reused-lineage, and cross-run bindings", () => {
  const pending = createScheduledTrial(definition.scheduledTrialId, run);
  assert.throws(() => createReplacementScheduledTrial({
    scheduledTrialId: "replacement-pending",
    replaces: pending,
    verifiedRun: run,
  }), /terminal/i);

  const abandoned = appendTrialAttempt(pending, attempt({
    attemptDisposition: "NONRETRYABLE_INCOMPLETE",
    retryEligible: false,
    retryReasonCode: "NOT_RETRYABLE_PROVIDER_OR_ADAPTER_ERROR",
  }));
  assert.throws(() => createReplacementScheduledTrial({
    scheduledTrialId: definition.scheduledTrialId,
    replaces: abandoned,
    verifiedRun: run,
  }), /unique|lineage/i);

  const otherRun = verifiedRun({ createdAt: "2026-09-16T12:00:01.000Z" });
  assert.throws(() => createReplacementScheduledTrial({
    scheduledTrialId: "replacement-other-run",
    replaces: abandoned,
    verifiedRun: otherRun,
  }), /run specification/i);
});
