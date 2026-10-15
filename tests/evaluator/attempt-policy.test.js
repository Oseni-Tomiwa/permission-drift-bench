import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_ATTEMPTS_PER_SCHEDULED_TRIAL,
  MAX_MODEL_RESPONSES_PER_STEP,
  RETRY_POLICY_VERSION,
  retryBackoffSecondsAfterAttempt,
} from "../../dist/schemas/trial-policy.js";
import { deriveAttemptPolicy } from "../../dist/evaluator/attempt-policy.js";

const decision = (overrides = {}) => deriveAttemptPolicy({
  integrityStatus: "INTEGRITY_VALID",
  terminationReason: "PROVIDER_ERROR",
  qualifyingPrimaryEventObserved: false,
  attemptNumber: 1,
  adapterErrorCode: "PROVIDER_5XX",
  ...overrides,
});

test("only the four predeclared infrastructure error classes are retryable", () => {
  const expected = new Map([
    ["PROVIDER_5XX", "RETRYABLE_PROVIDER_ERROR"],
    ["NETWORK", "RETRYABLE_ADAPTER_ERROR"],
    ["TIMEOUT", "RETRYABLE_PROVIDER_TIMEOUT"],
    ["RATE_LIMIT", "RETRYABLE_RATE_LIMIT"],
  ]);
  for (const [adapterErrorCode, retryReasonCode] of expected) {
    const result = decision({ adapterErrorCode });
    assert.deepEqual(result, {
      attemptDisposition: "RETRYABLE_INFRASTRUCTURE_FAILURE",
      retryEligible: true,
      retryReasonCode,
    });
  }

  for (const adapterErrorCode of [
    "AUTHENTICATION",
    "INVALID_REQUEST",
    "RESPONSE_PARSE",
    "UNSUPPORTED_CONFIGURATION",
    "SEMANTIC_MAPPING_FAILURE",
    "UNKNOWN_PROVIDER_ERROR",
  ]) {
    const result = decision({ adapterErrorCode });
    assert.equal(result.attemptDisposition, "NONRETRYABLE_INCOMPLETE");
    assert.equal(result.retryEligible, false);
    assert.equal(result.retryReasonCode, "NOT_RETRYABLE_PROVIDER_OR_ADAPTER_ERROR");
  }
});

test("the third failed infrastructure attempt exhausts the retry allowance", () => {
  assert.equal(MAX_ATTEMPTS_PER_SCHEDULED_TRIAL, 3);
  assert.deepEqual(decision({ attemptNumber: 3 }), {
    attemptDisposition: "NONRETRYABLE_INCOMPLETE",
    retryEligible: false,
    retryReasonCode: "NOT_RETRYABLE_ATTEMPT_LIMIT",
  });
});

test("attempt policy fails closed outside the frozen attempt range", () => {
  assert.throws(() => decision({ attemptNumber: 0 }), /attempt number/i);
  assert.throws(() => decision({ attemptNumber: 4 }), /attempt number/i);
  assert.throws(() => decision({ attemptNumber: 1.5 }), /attempt number/i);
});

test("retry backoff is fixed at 5 then 15 seconds with no fourth attempt", () => {
  assert.equal(retryBackoffSecondsAfterAttempt(1), 5);
  assert.equal(retryBackoffSecondsAfterAttempt(2), 15);
  assert.equal(retryBackoffSecondsAfterAttempt(3), null);
  assert.throws(() => retryBackoffSecondsAfterAttempt(0), /attempt number/i);
  assert.throws(() => retryBackoffSecondsAfterAttempt(4), /attempt number/i);
});

test("response-cap exhaustion is always nonretryable", () => {
  assert.equal(MAX_MODEL_RESPONSES_PER_STEP, 4);
  assert.deepEqual(decision({
    terminationReason: "STEP_RESPONSE_LIMIT",
    adapterErrorCode: null,
  }), {
    attemptDisposition: "NONRETRYABLE_INCOMPLETE",
    retryEligible: false,
    retryReasonCode: "NOT_RETRYABLE_STEP_RESPONSE_LIMIT",
  });
});

test("decisive endpoint evidence and integrity invalidity retain precedence", () => {
  assert.deepEqual(decision({ qualifyingPrimaryEventObserved: true }), {
    attemptDisposition: "ANALYZABLE",
    retryEligible: false,
    retryReasonCode: "NOT_RETRYABLE_QUALIFYING_EVENT",
  });
  assert.deepEqual(decision({
    integrityStatus: "INTEGRITY_INVALID",
    qualifyingPrimaryEventObserved: true,
  }), {
    attemptDisposition: "QUARANTINED_INTEGRITY_INVALID",
    retryEligible: false,
    retryReasonCode: "NOT_RETRYABLE_INTEGRITY_INVALID",
  });
});

test("retry policy has an explicit version", () => {
  assert.equal(RETRY_POLICY_VERSION, "retry-policy-v0.1.0");
});
