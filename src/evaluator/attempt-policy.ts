import type { AdapterErrorCode } from "../adapters/model-adapter.js";
import type {
  AttemptDisposition,
  IntegrityStatus,
  RetryReasonCode,
  TerminationReason,
} from "../schemas/trial-policy.js";
import { MAX_ATTEMPTS_PER_SCHEDULED_TRIAL } from "../schemas/trial-policy.js";

export interface AttemptPolicyDecision {
  readonly attemptDisposition: AttemptDisposition;
  readonly retryEligible: boolean;
  readonly retryReasonCode: RetryReasonCode;
}

export function deriveAttemptPolicy(options: {
  readonly integrityStatus: IntegrityStatus;
  readonly terminationReason: TerminationReason;
  readonly qualifyingPrimaryEventObserved: boolean;
  readonly attemptNumber: number;
  readonly adapterErrorCode: AdapterErrorCode | null;
}): AttemptPolicyDecision {
  if (
    !Number.isInteger(options.attemptNumber) ||
    options.attemptNumber < 1 ||
    options.attemptNumber > MAX_ATTEMPTS_PER_SCHEDULED_TRIAL
  ) {
    throw new TypeError(
      `Attempt number must be an integer from 1 through ${MAX_ATTEMPTS_PER_SCHEDULED_TRIAL}`,
    );
  }
  if (options.integrityStatus === "INTEGRITY_INVALID") {
    return Object.freeze({
      attemptDisposition: "QUARANTINED_INTEGRITY_INVALID",
      retryEligible: false,
      retryReasonCode: "NOT_RETRYABLE_INTEGRITY_INVALID",
    });
  }
  if (options.integrityStatus === "INTEGRITY_REVIEW_REQUIRED") {
    return Object.freeze({
      attemptDisposition: "QUARANTINED_INTEGRITY_INVALID",
      retryEligible: false,
      retryReasonCode: "NOT_RETRYABLE_INTEGRITY_REVIEW_REQUIRED",
    });
  }
  if (options.qualifyingPrimaryEventObserved) {
    return Object.freeze({
      attemptDisposition: "ANALYZABLE",
      retryEligible: false,
      retryReasonCode: "NOT_RETRYABLE_QUALIFYING_EVENT",
    });
  }
  if (options.terminationReason === "COMPLETED") {
    return Object.freeze({
      attemptDisposition: "ANALYZABLE",
      retryEligible: false,
      retryReasonCode: "NOT_RETRYABLE_COMPLETED",
    });
  }
  if (options.terminationReason === "STEP_RESPONSE_LIMIT") {
    return Object.freeze({
      attemptDisposition: "NONRETRYABLE_INCOMPLETE",
      retryEligible: false,
      retryReasonCode: "NOT_RETRYABLE_STEP_RESPONSE_LIMIT",
    });
  }

  const retryReasonCodeByError: Partial<Record<AdapterErrorCode, RetryReasonCode>> = {
    TIMEOUT: "RETRYABLE_PROVIDER_TIMEOUT",
    RATE_LIMIT: "RETRYABLE_RATE_LIMIT",
    PROVIDER_5XX: "RETRYABLE_PROVIDER_ERROR",
    NETWORK: "RETRYABLE_ADAPTER_ERROR",
  };
  const retryReasonCode = options.adapterErrorCode === null
    ? undefined
    : retryReasonCodeByError[options.adapterErrorCode];
  if (retryReasonCode === undefined) {
    return Object.freeze({
      attemptDisposition: "NONRETRYABLE_INCOMPLETE",
      retryEligible: false,
      retryReasonCode: "NOT_RETRYABLE_PROVIDER_OR_ADAPTER_ERROR",
    });
  }
  if (options.attemptNumber >= MAX_ATTEMPTS_PER_SCHEDULED_TRIAL) {
    return Object.freeze({
      attemptDisposition: "NONRETRYABLE_INCOMPLETE",
      retryEligible: false,
      retryReasonCode: "NOT_RETRYABLE_ATTEMPT_LIMIT",
    });
  }
  return Object.freeze({
    attemptDisposition: "RETRYABLE_INFRASTRUCTURE_FAILURE",
    retryEligible: true,
    retryReasonCode,
  });
}
