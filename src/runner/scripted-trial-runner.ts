import { EventLog } from "../environment/event-log.js";
import { SyntheticEnvironment } from "../environment/synthetic-environment.js";
import { deriveTrialOutcome } from "../evaluator/trial-outcome.js";
import type { TrialOutcome } from "../evaluator/trial-outcome.js";
import { derivePrimaryEndpointOutcome } from "../evaluator/primary-endpoint.js";
import type { PrimaryEndpointOutcome } from "../evaluator/primary-endpoint.js";
import type { BenchmarkEvent } from "../schemas/events.js";
import { createPermission } from "../schemas/permission.js";
import type { AuthorizationState, Permission } from "../schemas/permission.js";
import type {
  ConditionRole,
  ScenarioCondition,
  ScriptedScenario,
} from "../schemas/scenario.js";
import { SimulatedReadFileTool } from "../tools/read-file.js";
import type { ReadFileResult } from "../tools/read-file.js";

export interface AuthorizationDecisionRecord {
  readonly attemptId: number;
  readonly step: number;
  readonly resource: string;
  readonly authorized: boolean;
}

export interface SyntheticToolResult {
  readonly step: number;
  readonly tool: "read_file";
  readonly resource: string;
  readonly result: ReadFileResult;
}

export interface TrialMetadata {
  readonly trialId: string;
  readonly executionMode: "SCRIPTED_DETERMINISTIC";
  readonly runnerVersion: "0.2.0";
  readonly scoredSteps: readonly number[];
}

export interface ScriptedTrialResult {
  readonly scenarioId: string;
  readonly scenarioVersion: string;
  readonly conditionId: string;
  readonly conditionRole: ConditionRole;
  readonly behavioralOutcome: TrialOutcome;
  readonly primaryEndpointOutcome: PrimaryEndpointOutcome;
  readonly events: readonly BenchmarkEvent[];
  readonly authorizationDecisions: readonly AuthorizationDecisionRecord[];
  readonly syntheticToolResults: readonly SyntheticToolResult[];
  readonly initialPermissions: readonly Permission[];
  readonly simulatorError: string | null;
  readonly metadata: TrialMetadata;
}

function clonePermissions(
  permissions: readonly Permission[],
): readonly Permission[] {
  return Object.freeze(
    permissions.map((permission) => createPermission({ ...permission })),
  );
}

function findCondition(
  scenario: ScriptedScenario,
  conditionId: string,
): ScenarioCondition {
  const condition = scenario.conditions.find(
    (candidate) => candidate.id === conditionId,
  );
  if (condition === undefined) {
    throw new Error(`Unknown condition: ${conditionId}`);
  }
  return condition;
}

export function runScriptedTrial(
  scenario: ScriptedScenario,
  conditionId: string,
  trialId: string,
): ScriptedTrialResult {
  const condition = findCondition(scenario, conditionId);
  const initialPermissions = clonePermissions(condition.initialPermissions);
  const authorizationState: AuthorizationState = Object.freeze({
    permissions: initialPermissions,
  });
  const environment = new SyntheticEnvironment({
    ...scenario.syntheticResources,
  });
  const eventLog = new EventLog();
  const readFileTool = new SimulatedReadFileTool(
    environment,
    authorizationState,
    eventLog,
  );
  const syntheticToolResults: SyntheticToolResult[] = [];

  for (const step of condition.steps) {
    eventLog.append({
      type: "STEP_STARTED",
      step: step.step,
      providedContext: step.providedContext ?? null,
    });

    for (const action of step.actions) {
      const result = readFileTool.readFile({
        principal: action.principal,
        path: action.path,
        step: step.step,
      });
      syntheticToolResults.push(
        Object.freeze({
          step: step.step,
          tool: "read_file",
          resource: action.path,
          result: Object.freeze(result),
        }),
      );
    }
  }

  const events = Object.freeze([...eventLog.events]);
  const scoredEvents = events.filter(
    (event) =>
      "step" in event && condition.scoredSteps.includes(event.step ?? -1),
  );
  const authorizationDecisions = Object.freeze(
    eventLog.toolAttemptResults.flatMap((event) =>
      event.authorizationDecision === null || event.step === null
        ? []
        : [
            Object.freeze({
              attemptId: event.attemptId,
              step: event.step,
              resource: event.normalizedResource ?? "",
              authorized: event.authorizationDecision,
            }),
          ],
    ),
  );
  const simulatorFailure = eventLog.toolAttemptResults.find(
    (event) => event.executionResult === "SIMULATOR_ERROR",
  );

  return Object.freeze({
    scenarioId: scenario.id,
    scenarioVersion: scenario.version,
    conditionId: condition.id,
    conditionRole: condition.controlRole,
    behavioralOutcome: deriveTrialOutcome(scoredEvents),
    primaryEndpointOutcome: derivePrimaryEndpointOutcome(
      scoredEvents,
      scenario.primaryScoredAction,
    ),
    events,
    authorizationDecisions,
    syntheticToolResults: Object.freeze(syntheticToolResults),
    initialPermissions,
    simulatorError:
      simulatorFailure === undefined
        ? null
        : `Simulator error for ${String(simulatorFailure.normalizedResource)}`,
    metadata: Object.freeze({
      trialId,
      executionMode: "SCRIPTED_DETERMINISTIC",
      runnerVersion: "0.2.0",
      scoredSteps: Object.freeze([...condition.scoredSteps]),
    }),
  });
}
