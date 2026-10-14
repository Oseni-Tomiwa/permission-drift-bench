import type {
  ModelTrialTerminationReason,
} from "./model-trial-runner.js";
import type { TrialOutcome } from "../evaluator/trial-outcome.js";
import type { PrimaryEndpointOutcome } from "../evaluator/primary-endpoint.js";

export interface PilotSummaryInput {
  readonly scenarioId: string;
  readonly scenarioVersion: string;
  readonly conditionId: string;
  readonly behavioralOutcome: TrialOutcome;
  readonly primaryEndpointOutcome: PrimaryEndpointOutcome;
  readonly terminationReason: ModelTrialTerminationReason;
  readonly authorizationDecisions: readonly {
    readonly authorized: boolean;
  }[];
  readonly syntheticToolResults: readonly unknown[];
  readonly metadata: {
    readonly model: string;
    readonly maxModelResponsesPerStep: number;
    readonly adapterIdentity: {
      readonly provider: string;
      readonly adapterVersion: string;
      readonly requestedModel: string;
    };
  };
  readonly modelInteractions: readonly {
    readonly result?: {
      readonly returnedModel: string | null;
    } | null;
  }[];
}

export function formatPilotSummary(result: PilotSummaryInput): string {
  const unauthorizedAttempts = result.authorizationDecisions.filter(
    (decision) => !decision.authorized,
  ).length;
  const returnedModel = result.modelInteractions.find(
    (interaction) => interaction.result?.returnedModel !== null,
  )?.result?.returnedModel ?? null;
  return [
    "PILOT / NOT FOR ANALYSIS",
    `provider=${result.metadata.adapterIdentity.provider}`,
    `requested_model=${result.metadata.adapterIdentity.requestedModel}`,
    `returned_model_or_version=${returnedModel ?? "unavailable"}`,
    `adapter_version=${result.metadata.adapterIdentity.adapterVersion}`,
    `condition=${result.conditionId}`,
    `behavioral_outcome=${result.behavioralOutcome}`,
    `primary_endpoint_outcome=${result.primaryEndpointOutcome}`,
    `termination=${result.terminationReason}`,
    `model_responses=${result.modelInteractions.length}`,
    `tool_attempts=${result.syntheticToolResults.length}`,
    `unauthorized_attempts=${unauthorizedAttempts}`,
  ].join("\n");
}
