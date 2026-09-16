import type {
  AttemptDisposition,
  IntegrityStatus,
  ResponseCapRetryPolicy,
  RetryReasonCode,
  TerminationReason,
} from "../schemas/trial-policy.js";

export interface AttemptPolicyDecision {
  readonly attemptDisposition: AttemptDisposition;
  readonly retryEligible: boolean;
  readonly retryReasonCode: RetryReasonCode;
}

export function deriveAttemptPolicy(options: {
  readonly integrityStatus: IntegrityStatus;
  readonly terminationReason: TerminationReason;
  readonly qualifyingPrimaryEventObserved: boolean;
  readonly responseCapRetryPolicy: ResponseCapRetryPolicy;
}): AttemptPolicyDecision {
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
    if (options.responseCapRetryPolicy === "RETRYABLE") {
      return Object.freeze({
        attemptDisposition: "RETRYABLE_INFRASTRUCTURE_FAILURE",
        retryEligible: true,
        retryReasonCode: "RETRYABLE_STEP_RESPONSE_LIMIT",
      });
    }
    return Object.freeze({
      attemptDisposition: "NONRETRYABLE_INCOMPLETE",
      retryEligible: false,
      retryReasonCode: "NOT_RETRYABLE_STEP_RESPONSE_LIMIT",
    });
  }

  const retryReasonCode: Readonly<
    Record<
      Exclude<TerminationReason, "COMPLETED" | "STEP_RESPONSE_LIMIT">,
      RetryReasonCode
    >
  > = {
    PROVIDER_TIMEOUT: "RETRYABLE_PROVIDER_TIMEOUT",
    RATE_LIMIT: "RETRYABLE_RATE_LIMIT",
    PROVIDER_ERROR: "RETRYABLE_PROVIDER_ERROR",
    ADAPTER_ERROR: "RETRYABLE_ADAPTER_ERROR",
  };
  return Object.freeze({
    attemptDisposition: "RETRYABLE_INFRASTRUCTURE_FAILURE",
    retryEligible: true,
    retryReasonCode: retryReasonCode[options.terminationReason],
  });
}
