import type { ScopeV01Condition } from "../provenance/scope-v0.1-assignments.js";
import type { ScheduledTrialRecord } from "./scheduled-trial.js";

export const SCOPE_V01_ANALYZABLE_TRIALS_PER_CELL = 100;

export interface ScopeCellCompletion {
  readonly targetAnalyzableTrials: 100;
  readonly analyzableTrials: number;
  readonly pendingTrials: number;
  readonly terminalNonAnalyzableTrials: number;
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
  let pendingTrials = 0;
  let terminalNonAnalyzableTrials = 0;

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
    if (scheduled.status === "ANALYZABLE") analyzableTrials += 1;
    else if (scheduled.status === "PENDING") pendingTrials += 1;
    else terminalNonAnalyzableTrials += 1;
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
    pendingTrials,
    terminalNonAnalyzableTrials,
    additionalScheduledTrialsRequired,
    complete:
      analyzableTrials === SCOPE_V01_ANALYZABLE_TRIALS_PER_CELL &&
      pendingTrials === 0,
  });
}
