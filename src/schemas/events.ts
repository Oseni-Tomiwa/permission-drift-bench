export type EnforcementResult = "ALLOWED" | "BLOCKED" | "NOT_EVALUATED";

export type ExecutionResult =
  | "SUCCESS"
  | "BLOCKED_UNAUTHORIZED"
  | "MALFORMED"
  | "SIMULATOR_ERROR";

export interface StepStartedEvent {
  readonly type: "STEP_STARTED";
  readonly step: number;
  readonly providedContext: string | null;
}

export interface ModelResponseReceivedEvent {
  readonly type: "MODEL_RESPONSE_RECEIVED";
  readonly step: number;
  readonly invocationId: string;
  readonly modelInteractionIndex: number;
  readonly responseId: string | null;
  readonly status: string | null;
  readonly toolCallCount: number;
  readonly assistantTextPresent: boolean;
  readonly authorizationStateReference: string;
}

export interface ProviderErrorEvent {
  readonly type: "PROVIDER_ERROR";
  readonly step: number;
  readonly invocationId: string;
  readonly modelInteractionIndex: number;
  readonly responseId: string | null;
  readonly status: string | null;
  readonly message: string;
  readonly authorizationStateReference: string;
}

export interface StepResponseLimitEvent {
  readonly type: "STEP_RESPONSE_LIMIT";
  readonly step: number;
  readonly maxModelResponsesPerStep: number;
  readonly authorizationStateReference: string;
}

interface ToolAttemptEventBase {
  readonly attemptId: number;
  readonly step: number | null;
  readonly principal: string;
  readonly tool: string;
  readonly rawArguments: Readonly<Record<string, unknown>>;
  readonly rawProviderArguments?: string;
  readonly providerCallId?: string | null;
  readonly providerResponseId?: string | null;
  readonly providerToolCallIndex?: number;
  readonly authorizationStateReference?: string;
  readonly action: string;
  readonly rawResource: unknown;
  readonly normalizedResource: string | null;
}

export interface ToolAttemptObservedEvent extends ToolAttemptEventBase {
  readonly type: "TOOL_ATTEMPT_OBSERVED";
}

export interface ToolAttemptResultEvent extends ToolAttemptEventBase {
  readonly type: "TOOL_ATTEMPT_RESULT";
  readonly authorizationDecision: boolean | null;
  readonly enforcementResult: EnforcementResult;
  readonly executionResult: ExecutionResult;
}

export type BenchmarkEvent =
  | StepStartedEvent
  | ModelResponseReceivedEvent
  | ProviderErrorEvent
  | StepResponseLimitEvent
  | ToolAttemptObservedEvent
  | ToolAttemptResultEvent;
