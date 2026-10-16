import type { ScopeV01Condition } from "../provenance/scope-v0.1-assignments.js";
import type { ScheduledTrialRecord } from "./scheduled-trial.js";

export const SCOPE_V01_ANALYZABLE_TRIALS_PER_CELL = 100;

export interface ScopeCellCompletion {
  readonly targetAnalyzableTrials: 100;
  readonly analyzableTrials: number;
  readonly behavioralDenominator: number;
  readonly unauthorizedAttemptCount: number;
  readonly pendingTrials: number;
  readonly terminalNonAnalyzableTrials: number;
  readonly providerAttemptCount: number;
  readonly retryCount: number;
  readonly abandonmentCount: number;
  readonly quarantineCount: number;
  readonly replacementCount: number;
  readonly infrastructureFailureCount: number;
  readonly additionalScheduledTrialsRequired: number;
  readonly complete: boolean;
}

export function assessScopeCellCompletion(input: {
  readonly modelConfigurationId: string;
  readonly condition: ScopeV01Condition;
  readonly scheduledTrials: readonly ScheduledTrialRecord[];
}): ScopeCellCompletion {
  const scheduledIds = new Set<string>();
  let analyzableTrials = 0;
  let unauthorizedAttemptCount = 0;
  let pendingTrials = 0;
  let terminalNonAnalyzableTrials = 0;
  let providerAttemptCount = 0;
  let retryCount = 0;
  let abandonmentCount = 0;
  let quarantineCount = 0;
  let replacementCount = 0;
  let infrastructureFailureCount = 0;

  for (const scheduled of input.scheduledTrials) {
    if (scheduledIds.has(scheduled.scheduledTrialId)) {
      throw new Error("Duplicate scheduled trial ID in cell accounting");
    }
    scheduledIds.add(scheduled.scheduledTrialId);
    if (scheduled.modelConfigurationId !== input.modelConfigurationId) {
      throw new Error("Scheduled trial belongs to a different model configuration");
    }
    if (scheduled.condition !== input.condition) {
      throw new Error("Scheduled trial belongs to a different condition");
    }
    const attemptIds = new Set(scheduled.attempts.map((attempt) => attempt.trialAttemptId));
    if (attemptIds.size !== scheduled.attempts.length) {
      throw new Error("Trial attempt linkage IDs must be unique");
    }
    const lastAttempt = scheduled.attempts.at(-1);
    if (scheduled.attempts.slice(0, -1).some(
      (attempt) => attempt.attemptDisposition !== "RETRYABLE_INFRASTRUCTURE_FAILURE",
    )) {
      throw new Error("Non-final attempt disposition contradicts retry linkage");
    }
    const expectedFinalDisposition = scheduled.status === "ANALYZABLE"
      ? "ANALYZABLE"
      : scheduled.status === "ABANDONED"
        ? "NONRETRYABLE_INCOMPLETE"
        : scheduled.status === "QUARANTINED"
          ? "QUARANTINED_INTEGRITY_INVALID"
          : "RETRYABLE_INFRASTRUCTURE_FAILURE";
    if (scheduled.status === "PENDING" && lastAttempt === undefined) {
      if (scheduled.finalAnalyzableAttemptId !== null) {
        throw new Error("Pending scheduled trial cannot identify a final analyzable attempt");
      }
    } else if (
      lastAttempt === undefined ||
      lastAttempt.attemptDisposition !== expectedFinalDisposition ||
      (scheduled.status !== "ANALYZABLE" && scheduled.finalAnalyzableAttemptId !== null)
    ) {
      throw new Error("Scheduled status contradicts final attempt disposition");
    }
    providerAttemptCount += scheduled.attempts.length;
    retryCount += Math.max(0, scheduled.attempts.length - 1);
    infrastructureFailureCount += scheduled.attempts.filter((attempt) =>
      attempt.attemptDisposition === "RETRYABLE_INFRASTRUCTURE_FAILURE" ||
      (attempt.attemptDisposition === "NONRETRYABLE_INCOMPLETE" &&
        ["PROVIDER_TIMEOUT", "RATE_LIMIT", "PROVIDER_ERROR", "ADAPTER_ERROR"]
          .includes(attempt.terminationReason))).length;
    if (scheduled.replacementForScheduledTrialId !== null) replacementCount += 1;

    if (scheduled.status === "ANALYZABLE") {
      const matchingFinal = scheduled.attempts.filter(
        (attempt) => attempt.trialAttemptId === scheduled.finalAnalyzableAttemptId,
      );
      const finalAttempt = lastAttempt;
      if (
        scheduled.finalAnalyzableAttemptId === null ||
        matchingFinal.length !== 1 ||
        finalAttempt?.trialAttemptId !== scheduled.finalAnalyzableAttemptId ||
        finalAttempt.attemptDisposition !== "ANALYZABLE"
      ) {
        throw new Error("Analyzable trial final-attempt linkage is invalid");
      }
      analyzableTrials += 1;
      if (finalAttempt.primaryEndpointOutcome === "UNAUTHORIZED_ATTEMPT") {
        unauthorizedAttemptCount += 1;
      }
    } else if (scheduled.status === "PENDING") {
      pendingTrials += 1;
    } else {
      terminalNonAnalyzableTrials += 1;
      if (scheduled.status === "ABANDONED") abandonmentCount += 1;
      else if (scheduled.status === "QUARANTINED") quarantineCount += 1;
    }
  }

  if (analyzableTrials > SCOPE_V01_ANALYZABLE_TRIALS_PER_CELL) {
    throw new Error("Analyzable trial count exceeds the frozen cell target");
  }
  if (
    analyzableTrials + pendingTrials >
    SCOPE_V01_ANALYZABLE_TRIALS_PER_CELL
  ) {
    throw new Error("Analyzable and pending trials exceed the frozen cell capacity");
  }
  const additionalScheduledTrialsRequired = Math.max(
    0,
    SCOPE_V01_ANALYZABLE_TRIALS_PER_CELL - analyzableTrials - pendingTrials,
  );
  return Object.freeze({
    targetAnalyzableTrials: SCOPE_V01_ANALYZABLE_TRIALS_PER_CELL,
    analyzableTrials,
    behavioralDenominator: analyzableTrials,
    unauthorizedAttemptCount,
    pendingTrials,
    terminalNonAnalyzableTrials,
    providerAttemptCount,
    retryCount,
    abandonmentCount,
    quarantineCount,
    replacementCount,
    infrastructureFailureCount,
    additionalScheduledTrialsRequired,
    complete:
      analyzableTrials === SCOPE_V01_ANALYZABLE_TRIALS_PER_CELL &&
      pendingTrials === 0,
  });
}
