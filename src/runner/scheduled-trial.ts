import type { PrimaryEndpointOutcome } from "../evaluator/primary-endpoint.js";
import type { TrialOutcome } from "../evaluator/trial-outcome.js";
import type {
  AttemptDisposition,
  IntegrityFailureCode,
  IntegrityStatus,
  RetryReasonCode,
  ScheduledTrialStatus,
  TerminationReason,
} from "../schemas/trial-policy.js";

export interface AppendableTrialAttempt {
  readonly scheduledTrialId: string;
  readonly trialAttemptId: string;
  readonly attemptNumber: number;
  readonly replacementForAttemptId: string | null;
  readonly integrityStatus: IntegrityStatus;
  readonly integrityFailureCode: IntegrityFailureCode | null;
  readonly terminationReason: TerminationReason;
  readonly behavioralOutcome: TrialOutcome;
  readonly primaryEndpointOutcome: PrimaryEndpointOutcome;
  readonly attemptDisposition: AttemptDisposition;
  readonly retryEligible: boolean;
  readonly retryReasonCode: RetryReasonCode;
}

export type ScheduledTrialAttemptRecord = Readonly<AppendableTrialAttempt>;

export interface ScheduledTrialRecord {
  readonly scheduledTrialId: string;
  readonly status: ScheduledTrialStatus;
  readonly finalAnalyzableAttemptId: string | null;
  readonly attempts: readonly ScheduledTrialAttemptRecord[];
}

export function createScheduledTrial(
  scheduledTrialId: string,
): ScheduledTrialRecord {
  if (scheduledTrialId.length === 0) {
    throw new Error("scheduledTrialId must not be empty");
  }
  return Object.freeze({
    scheduledTrialId,
    status: "PENDING",
    finalAnalyzableAttemptId: null,
    attempts: Object.freeze([]),
  });
}

function statusAfterAttempt(
  disposition: AttemptDisposition,
): ScheduledTrialStatus {
  switch (disposition) {
    case "ANALYZABLE":
      return "ANALYZABLE";
    case "RETRYABLE_INFRASTRUCTURE_FAILURE":
      return "PENDING";
    case "NONRETRYABLE_INCOMPLETE":
      return "ABANDONED";
    case "QUARANTINED_INTEGRITY_INVALID":
      return "QUARANTINED";
  }
}

export function appendTrialAttempt(
  scheduled: ScheduledTrialRecord,
  attempt: AppendableTrialAttempt,
): ScheduledTrialRecord {
  if (scheduled.status !== "PENDING") {
    throw new Error(`Cannot append to scheduled trial in ${scheduled.status}`);
  }
  if (attempt.scheduledTrialId !== scheduled.scheduledTrialId) {
    throw new Error("Attempt belongs to a different scheduled trial");
  }
  const expectedAttemptNumber = scheduled.attempts.length + 1;
  const previousAttempt = scheduled.attempts.at(-1);
  const expectedReplacementId =
    previousAttempt === undefined ? null : previousAttempt.trialAttemptId;
  if (
    attempt.attemptNumber !== expectedAttemptNumber ||
    attempt.replacementForAttemptId !== expectedReplacementId ||
    scheduled.attempts.some(
      (candidate) => candidate.trialAttemptId === attempt.trialAttemptId,
    )
  ) {
    throw new Error("Attempt linkage is not the next append-only replacement");
  }

  const record = Object.freeze({
    scheduledTrialId: attempt.scheduledTrialId,
    trialAttemptId: attempt.trialAttemptId,
    attemptNumber: attempt.attemptNumber,
    replacementForAttemptId: attempt.replacementForAttemptId,
    integrityStatus: attempt.integrityStatus,
    integrityFailureCode: attempt.integrityFailureCode,
    terminationReason: attempt.terminationReason,
    behavioralOutcome: attempt.behavioralOutcome,
    primaryEndpointOutcome: attempt.primaryEndpointOutcome,
    attemptDisposition: attempt.attemptDisposition,
    retryEligible: attempt.retryEligible,
    retryReasonCode: attempt.retryReasonCode,
  });
  const status = statusAfterAttempt(attempt.attemptDisposition);
  return Object.freeze({
    scheduledTrialId: scheduled.scheduledTrialId,
    status,
    finalAnalyzableAttemptId:
      status === "ANALYZABLE" ? attempt.trialAttemptId : null,
    attempts: Object.freeze([...scheduled.attempts, record]),
  });
}
