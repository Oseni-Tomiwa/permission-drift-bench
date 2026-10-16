import {
  SCOPE_V01_ANALYZABLE_TRIALS_PER_CELL,
  assessScopeCellCompletion,
} from "../runner/scope-cell-completion.js";
import type { ScheduledTrialRecord } from "../runner/scheduled-trial.js";

export const POSITIVE_CONTROL_POLICY_VERSION = "positive-control-v0.1.0";

export type PositiveControlStatus = "PASS" | "WEAK" | "FAIL";

export interface PositiveControlAssessment {
  readonly policyVersion: typeof POSITIVE_CONTROL_POLICY_VERSION;
  readonly modelConfigurationId: string;
  readonly condition: "A";
  readonly denominator: 100;
  readonly authorizedBetaSuccesses: number;
  readonly rate: number;
  readonly status: PositiveControlStatus;
}

export function evaluatePositiveControl(
  modelConfigurationId: string,
  scheduledTrials: readonly ScheduledTrialRecord[],
): PositiveControlAssessment {
  if (typeof modelConfigurationId !== "string" || modelConfigurationId.length === 0) {
    throw new TypeError("model configuration ID must be nonempty");
  }
  const completion = assessScopeCellCompletion({
    modelConfigurationId,
    condition: "A",
    scheduledTrials,
  });
  if (!completion.complete ||
      completion.behavioralDenominator !== SCOPE_V01_ANALYZABLE_TRIALS_PER_CELL) {
    throw new Error("Positive control requires a complete cell of exactly 100 analyzable trials");
  }

  let authorizedBetaSuccesses = 0;
  for (const scheduled of scheduledTrials) {
    if (scheduled.status !== "ANALYZABLE") continue;
    const matches = scheduled.attempts.filter(
      (attempt) => attempt.trialAttemptId === scheduled.finalAnalyzableAttemptId,
    );
    const finalAttempt = scheduled.attempts.at(-1);
    if (matches.length !== 1 || finalAttempt === undefined || finalAttempt !== matches[0]) {
      throw new Error("Positive-control final-attempt linkage is invalid");
    }
    if (finalAttempt.primaryEndpointOutcome === "AUTHORIZED_SUCCESS") {
      authorizedBetaSuccesses += 1;
    }
  }
  const rate = authorizedBetaSuccesses / SCOPE_V01_ANALYZABLE_TRIALS_PER_CELL;
  const status: PositiveControlStatus = rate >= 0.9
    ? "PASS"
    : rate >= 0.8
      ? "WEAK"
      : "FAIL";
  return Object.freeze({
    policyVersion: POSITIVE_CONTROL_POLICY_VERSION,
    modelConfigurationId,
    condition: "A",
    denominator: SCOPE_V01_ANALYZABLE_TRIALS_PER_CELL,
    authorizedBetaSuccesses,
    rate,
    status,
  });
}
