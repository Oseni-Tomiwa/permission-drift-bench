export type IntegrityStatus =
  | "INTEGRITY_VALID"
  | "INTEGRITY_INVALID"
  | "INTEGRITY_REVIEW_REQUIRED";

export type IntegrityFailureCode =
  | "WRONG_PROMPT_HASH"
  | "WRONG_CONDITION"
  | "WRONG_MODEL_CONFIGURATION"
  | "MISSING_REQUIRED_PROVENANCE"
  | "CONTAMINATED_STATE"
  | "SCENARIO_CONSTRUCTION_BUG"
  | "AUTHORIZATION_STATE_CORRUPTION"
  | "WRONG_CODE_REVISION"
  | "WRONG_RUN_SPECIFICATION"
  | "ADAPTER_SEMANTIC_CORRUPTION";

export type TerminationReason =
  | "COMPLETED"
  | "PROVIDER_TIMEOUT"
  | "RATE_LIMIT"
  | "PROVIDER_ERROR"
  | "ADAPTER_ERROR"
  | "STEP_RESPONSE_LIMIT";

export type AdapterFailureClassification =
  | "TRANSIENT_INFRASTRUCTURE"
  | "INTEGRITY_CORRUPTION";

export const RETRY_POLICY_VERSION = "retry-policy-v0.1.0";
export const MAX_ATTEMPTS_PER_SCHEDULED_TRIAL = 3;
export const MAX_MODEL_RESPONSES_PER_STEP = 4;
export const RESPONSE_CAP_RETRY_POLICY = "NONRETRYABLE" as const;

export type ResponseCapRetryPolicy = typeof RESPONSE_CAP_RETRY_POLICY;

export function retryBackoffSecondsAfterAttempt(
  attemptNumber: number,
): 5 | 15 | null {
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1 || attemptNumber > 3) {
    throw new TypeError("Attempt number must be an integer from 1 through 3");
  }
  if (attemptNumber === 1) return 5;
  if (attemptNumber === 2) return 15;
  return null;
}

export type AttemptDisposition =
  | "ANALYZABLE"
  | "RETRYABLE_INFRASTRUCTURE_FAILURE"
  | "NONRETRYABLE_INCOMPLETE"
  | "QUARANTINED_INTEGRITY_INVALID";

export type RetryReasonCode =
  | "NOT_RETRYABLE_COMPLETED"
  | "NOT_RETRYABLE_QUALIFYING_EVENT"
  | "NOT_RETRYABLE_STEP_RESPONSE_LIMIT"
  | "NOT_RETRYABLE_INTEGRITY_INVALID"
  | "NOT_RETRYABLE_INTEGRITY_REVIEW_REQUIRED"
  | "NOT_RETRYABLE_ATTEMPT_LIMIT"
  | "NOT_RETRYABLE_PROVIDER_OR_ADAPTER_ERROR"
  | "RETRYABLE_PROVIDER_TIMEOUT"
  | "RETRYABLE_RATE_LIMIT"
  | "RETRYABLE_PROVIDER_ERROR"
  | "RETRYABLE_ADAPTER_ERROR";

export type ScheduledTrialStatus =
  | "PENDING"
  | "ANALYZABLE"
  | "ABANDONED"
  | "QUARANTINED";
