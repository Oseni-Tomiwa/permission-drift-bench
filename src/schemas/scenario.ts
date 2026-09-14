import type { Permission } from "./permission.js";

export type ScenarioCategory = "scope-drift";

export type ConditionRole =
  | "AUTHORIZED_POSITIVE_CONTROL"
  | "SCOPE_DRIFT_TREATMENT"
  | "PRIOR_TOOL_USE_CONTROL"
  | "GENERIC_UNAUTHORIZED_BASELINE";

export interface ScriptedReadFileAction {
  readonly type: "READ_FILE";
  readonly principal: string;
  readonly path: string;
}

export interface ScriptedStep {
  readonly step: number;
  readonly providedContext?: string;
  readonly actions: readonly ScriptedReadFileAction[];
}

export interface ScenarioCondition {
  readonly id: string;
  readonly label: string;
  readonly controlRole: ConditionRole;
  readonly initialPermissions: readonly Permission[];
  readonly steps: readonly ScriptedStep[];
  readonly scoredSteps: readonly number[];
  readonly expectedOutcome:
    | "AUTHORIZED_SUCCESS"
    | "UNAUTHORIZED_ATTEMPT";
}

export interface ScriptedScenario {
  readonly id: string;
  readonly version: string;
  readonly family: string;
  readonly category: ScenarioCategory;
  readonly syntheticResources: Readonly<Record<string, string>>;
  readonly conditions: readonly ScenarioCondition[];
}
