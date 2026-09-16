import { ModelAdapterError } from "../adapters/model-adapter.js";
import type {
  ModelAdapter,
  ModelAdapterRequest,
  ModelAdapterResult,
  ModelInputItem,
} from "../adapters/model-adapter.js";
import { EventLog } from "../environment/event-log.js";
import { SyntheticEnvironment } from "../environment/synthetic-environment.js";
import { deriveTrialOutcome } from "../evaluator/trial-outcome.js";
import type { TrialOutcome } from "../evaluator/trial-outcome.js";
import type { BenchmarkEvent } from "../schemas/events.js";
import { createPermission } from "../schemas/permission.js";
import type { AuthorizationState, Permission } from "../schemas/permission.js";
import type {
  ConditionRole,
  ScenarioCondition,
  ScriptedScenario,
} from "../schemas/scenario.js";
import {
  PILOT_PROMPT_VERSION,
  getFileReadBoundaryPilot,
} from "../scenarios/file-read-boundary-pilot.js";
import {
  BENCHMARK_AGENT,
  fileReadBoundaryScenario,
} from "../scenarios/file-read-boundary.js";
import { SimulatedReadFileTool } from "../tools/read-file.js";
import type { ReadFileResult } from "../tools/read-file.js";

export const DEFAULT_MAX_MODEL_RESPONSES_PER_STEP = 4;

export type ModelTrialTerminationReason =
  | "COMPLETED"
  | "STEP_RESPONSE_LIMIT"
  | "PROVIDER_ERROR";

export interface ModelTrialOptions {
  readonly scenario: ScriptedScenario;
  readonly conditionId: string;
  readonly trialId: string;
  readonly adapter: ModelAdapter;
  readonly model: string;
  readonly modelConfiguration?: Readonly<Record<string, unknown>>;
  readonly maxModelResponsesPerStep?: number;
}

export interface ModelToolCallCorrelation {
  readonly providerToolCallIndex: number;
  readonly providerCallId: string | null;
  readonly attemptId: number;
}

export interface ModelInteractionRecord {
  readonly invocationId: string;
  readonly step: number;
  readonly responseIndexWithinStep: number;
  readonly request: ModelAdapterRequest;
  readonly result: ModelAdapterResult | null;
  readonly rawProviderResponse: unknown;
  readonly responseId: string | null;
  readonly toolCallCorrelations: readonly ModelToolCallCorrelation[];
  readonly error: string | null;
}

export interface ModelAssistantText {
  readonly invocationId: string;
  readonly step: number;
  readonly text: string;
}

export interface ModelAuthorizationDecisionRecord {
  readonly attemptId: number;
  readonly step: number;
  readonly resource: string;
  readonly authorized: boolean;
}

export interface ModelSyntheticToolResult {
  readonly attemptId: number;
  readonly step: number;
  readonly providerCallId: string | null;
  readonly tool: string;
  readonly result: ReadFileResult;
}

export interface ModelTrialMetadata {
  readonly trialId: string;
  readonly executionMode: "MODEL_PILOT";
  readonly runnerVersion: "0.1.0";
  readonly pilotPromptVersion: typeof PILOT_PROMPT_VERSION;
  readonly model: string;
  readonly modelConfiguration: Readonly<Record<string, unknown>>;
  readonly scoredSteps: readonly number[];
  readonly maxModelResponsesPerStep: number;
}

export interface ModelTrialResult {
  readonly scenarioId: string;
  readonly scenarioVersion: string;
  readonly conditionId: string;
  readonly conditionRole: ConditionRole;
  readonly outcome: TrialOutcome;
  readonly terminationReason: ModelTrialTerminationReason;
  readonly providerError: string | null;
  readonly events: readonly BenchmarkEvent[];
  readonly modelInteractions: readonly ModelInteractionRecord[];
  readonly assistantTexts: readonly ModelAssistantText[];
  readonly authorizationDecisions: readonly ModelAuthorizationDecisionRecord[];
  readonly syntheticToolResults: readonly ModelSyntheticToolResult[];
  readonly initialPermissions: readonly Permission[];
  readonly metadata: ModelTrialMetadata;
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

function clonePermissions(
  permissions: readonly Permission[],
): readonly Permission[] {
  return Object.freeze(
    permissions.map((permission) => createPermission({ ...permission })),
  );
}

function snapshotInput(input: readonly ModelInputItem[]): readonly ModelInputItem[] {
  return Object.freeze(input.map((item) => Object.freeze({ ...item })));
}

function serializeToolResult(result: ReadFileResult): string {
  if (result.ok) {
    return JSON.stringify({ ok: true, content: result.content });
  }
  return JSON.stringify({ ok: false, error: result.error });
}

function safeAdapterError(error: unknown): string {
  return error instanceof ModelAdapterError
    ? error.message
    : "Model adapter request failed";
}

export async function runModelTrial(
  options: ModelTrialOptions,
): Promise<ModelTrialResult> {
  if (options.scenario !== fileReadBoundaryScenario) {
    throw new Error(
      "Model pilot runner supports only the canonical scope.file-read-boundary@0.1.0 scenario",
    );
  }

  const maxModelResponsesPerStep =
    options.maxModelResponsesPerStep ??
    DEFAULT_MAX_MODEL_RESPONSES_PER_STEP;
  if (
    !Number.isInteger(maxModelResponsesPerStep) ||
    maxModelResponsesPerStep < 1
  ) {
    throw new Error("maxModelResponsesPerStep must be a positive integer");
  }

  const condition = findCondition(options.scenario, options.conditionId);
  const pilot = getFileReadBoundaryPilot(condition.id);
  const initialPermissions = clonePermissions(condition.initialPermissions);
  const authorizationState: AuthorizationState = Object.freeze({
    permissions: initialPermissions,
  });
  const authorizationStateReference =
    `${options.trialId}:authorization-initial`;
  const environment = new SyntheticEnvironment({
    ...options.scenario.syntheticResources,
  });
  const eventLog = new EventLog();
  const readFileTool = new SimulatedReadFileTool(
    environment,
    authorizationState,
    eventLog,
    authorizationStateReference,
  );
  const conversation: ModelInputItem[] = [];
  const modelInteractions: ModelInteractionRecord[] = [];
  const assistantTexts: ModelAssistantText[] = [];
  const syntheticToolResults: ModelSyntheticToolResult[] = [];
  let terminationReason: ModelTrialTerminationReason = "COMPLETED";
  let providerError: string | null = null;

  stepLoop: for (const presentation of pilot.steps) {
    const scenarioStep = condition.steps.find(
      (candidate) => candidate.step === presentation.step,
    );
    eventLog.append({
      type: "STEP_STARTED",
      step: presentation.step,
      providedContext: scenarioStep?.providedContext ?? null,
    });
    conversation.push(
      Object.freeze({
        type: "message",
        role: "user",
        content: presentation.prompt,
      }),
    );

    for (
      let responseIndexWithinStep = 1;
      responseIndexWithinStep <= maxModelResponsesPerStep;
      responseIndexWithinStep += 1
    ) {
      const invocationId = `${options.trialId}:step-${presentation.step}:response-${responseIndexWithinStep}`;
      const request: ModelAdapterRequest = Object.freeze({
        model: options.model,
        systemInstructions: pilot.systemInstructions,
        input: snapshotInput(conversation),
        tools: pilot.tools,
        toolChoice: pilot.toolChoice,
        configuration: Object.freeze({
          ...(options.modelConfiguration ?? {}),
        }),
      });

      let result: ModelAdapterResult;
      try {
        result = await options.adapter.generate(request);
      } catch (error) {
        providerError = safeAdapterError(error);
        terminationReason = "PROVIDER_ERROR";
        const modelInteractionIndex = modelInteractions.length;
        modelInteractions.push(
          Object.freeze({
            invocationId,
            step: presentation.step,
            responseIndexWithinStep,
            request,
            result: null,
            rawProviderResponse: null,
            responseId: null,
            toolCallCorrelations: Object.freeze([]),
            error: providerError,
          }),
        );
        eventLog.append({
          type: "PROVIDER_ERROR",
          step: presentation.step,
          invocationId,
          modelInteractionIndex,
          responseId:
            error instanceof ModelAdapterError ? error.responseId : null,
          status: error instanceof ModelAdapterError ? error.status : null,
          message: providerError,
          authorizationStateReference,
        });
        break stepLoop;
      }

      const providerReportedFailure =
        result.status !== null && result.status !== "completed";
      const providerStatusError = providerReportedFailure
        ? `Model provider returned non-completed status: ${result.status}`
        : null;
      const modelInteractionIndex = modelInteractions.length;
      eventLog.append({
        type: "MODEL_RESPONSE_RECEIVED",
        step: presentation.step,
        invocationId,
        modelInteractionIndex,
        responseId: result.responseId,
        status: result.status,
        toolCallCount: result.toolCalls.length,
        assistantTextPresent: result.assistantText !== null,
        authorizationStateReference,
      });
      conversation.push(...result.continuationItems);
      if (result.assistantText !== null) {
        assistantTexts.push(
          Object.freeze({
            invocationId,
            step: presentation.step,
            text: result.assistantText,
          }),
        );
      }

      const correlations: ModelToolCallCorrelation[] = [];
      for (const toolCall of result.toolCalls) {
        const execution = readFileTool.executeModelToolCall({
          principal: BENCHMARK_AGENT,
          tool: toolCall.name,
          rawArguments: toolCall.arguments,
          step: presentation.step,
          providerCallId: toolCall.callId,
          providerResponseId: result.responseId,
          providerToolCallIndex: toolCall.index,
        });
        correlations.push(
          Object.freeze({
            providerToolCallIndex: toolCall.index,
            providerCallId: toolCall.callId,
            attemptId: execution.attemptId,
          }),
        );
        syntheticToolResults.push(
          Object.freeze({
            attemptId: execution.attemptId,
            step: presentation.step,
            providerCallId: toolCall.callId,
            tool: toolCall.name,
            result: Object.freeze(execution.result),
          }),
        );
        if (toolCall.callId !== null) {
          conversation.push(
            Object.freeze({
              type: "tool_result",
              callId: toolCall.callId,
              output: serializeToolResult(execution.result),
            }),
          );
        }
      }

      modelInteractions.push(
        Object.freeze({
          invocationId,
          step: presentation.step,
          responseIndexWithinStep,
          request,
          result,
          rawProviderResponse: result.rawResponse,
          responseId: result.responseId,
          toolCallCorrelations: Object.freeze(correlations),
          error: providerStatusError,
        }),
      );

      if (providerReportedFailure) {
        providerError = providerStatusError;
        terminationReason = "PROVIDER_ERROR";
        eventLog.append({
          type: "PROVIDER_ERROR",
          step: presentation.step,
          invocationId,
          modelInteractionIndex,
          responseId: result.responseId,
          status: result.status,
          message:
            providerStatusError ?? "Model provider returned a failed status",
          authorizationStateReference,
        });
        break stepLoop;
      }
      if (result.toolCalls.length === 0) {
        break;
      }
      if (responseIndexWithinStep === maxModelResponsesPerStep) {
        terminationReason = "STEP_RESPONSE_LIMIT";
        eventLog.append({
          type: "STEP_RESPONSE_LIMIT",
          step: presentation.step,
          maxModelResponsesPerStep,
          authorizationStateReference,
        });
        break stepLoop;
      }
    }
  }

  const events = Object.freeze([...eventLog.events]);
  const scoredEvents = events.filter(
    (event) =>
      "step" in event && condition.scoredSteps.includes(event.step ?? -1),
  );
  const expectedScoredResources = new Set(
    condition.steps.flatMap((step) =>
      condition.scoredSteps.includes(step.step)
        ? step.actions.map((action) => action.path)
        : [],
    ),
  );
  const scoredAttemptResults = eventLog.toolAttemptResults.filter(
    (event) =>
      event.step !== null && condition.scoredSteps.includes(event.step),
  );
  const hasDecisiveScoredEvent = scoredAttemptResults.some(
    (event) =>
      event.authorizationDecision === false ||
      event.executionResult === "MALFORMED" ||
      event.executionResult === "SIMULATOR_ERROR" ||
      (event.authorizationDecision === true &&
        event.executionResult === "SUCCESS" &&
        event.normalizedResource !== null &&
        expectedScoredResources.has(event.normalizedResource)),
  );
  const interpretationLost =
    terminationReason !== "COMPLETED" && !hasDecisiveScoredEvent;
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

  return Object.freeze({
    scenarioId: options.scenario.id,
    scenarioVersion: options.scenario.version,
    conditionId: condition.id,
    conditionRole: condition.controlRole,
    outcome: deriveTrialOutcome(scoredEvents, {
      invalidTrial: interpretationLost,
    }),
    terminationReason,
    providerError,
    events,
    modelInteractions: Object.freeze(modelInteractions),
    assistantTexts: Object.freeze(assistantTexts),
    authorizationDecisions,
    syntheticToolResults: Object.freeze(syntheticToolResults),
    initialPermissions,
    metadata: Object.freeze({
      trialId: options.trialId,
      executionMode: "MODEL_PILOT",
      runnerVersion: "0.1.0",
      pilotPromptVersion: pilot.version,
      model: options.model,
      modelConfiguration: Object.freeze({
        ...(options.modelConfiguration ?? {}),
      }),
      scoredSteps: Object.freeze([...condition.scoredSteps]),
      maxModelResponsesPerStep,
    }),
  });
}
