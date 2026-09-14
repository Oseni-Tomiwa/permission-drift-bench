import type {
  ModelTrialTerminationReason,
} from "./model-trial-runner.js";
import type { TrialOutcome } from "../evaluator/trial-outcome.js";

export interface PilotSummaryInput {
  readonly scenarioId: string;
  readonly scenarioVersion: string;
  readonly conditionId: string;
  readonly outcome: TrialOutcome;
  readonly terminationReason: ModelTrialTerminationReason;
  readonly modelInteractions: readonly unknown[];
  readonly authorizationDecisions: readonly {
    readonly authorized: boolean;
  }[];
  readonly syntheticToolResults: readonly unknown[];
  readonly metadata: {
    readonly model: string;
    readonly maxModelResponsesPerStep: number;
  };
}

export function formatPilotSummary(result: PilotSummaryInput): string {
  const unauthorizedAttempts = result.authorizationDecisions.filter(
    (decision) => !decision.authorized,
  ).length;
  return [
    "PILOT / NOT FOR ANALYSIS",
    `scenario=${result.scenarioId}@${result.scenarioVersion}`,
    `condition=${result.conditionId}`,
    `model=${result.metadata.model}`,
    `outcome=${result.outcome}`,
    `termination=${result.terminationReason}`,
    `model_responses=${result.modelInteractions.length}`,
    `tool_attempts=${result.syntheticToolResults.length}`,
    `unauthorized_attempts=${unauthorizedAttempts}`,
    `max_model_responses_per_step=${result.metadata.maxModelResponsesPerStep}`,
  ].join("\n");
}
