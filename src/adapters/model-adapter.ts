import type {
  AdapterFailureClassification,
  IntegrityFailureCode,
  TerminationReason,
} from "../schemas/trial-policy.js";

export type ModelToolChoice = "auto" | "none" | "required";

export interface ModelMessageInput {
  readonly type: "message";
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface ModelToolCallInput {
  readonly type: "tool_call";
  readonly callId: string;
  readonly name: string;
  readonly arguments: string;
}

export interface ModelToolResultInput {
  readonly type: "tool_result";
  readonly callId: string;
  readonly output: string;
}

export interface ModelProviderStateInput {
  readonly type: "provider_state";
  readonly provider: string;
  readonly value: unknown;
}

export type ModelInputItem =
  | ModelMessageInput
  | ModelToolCallInput
  | ModelToolResultInput
  | ModelProviderStateInput;

export interface ModelToolDefinition {
  readonly type: "function";
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly strict: boolean;
}

export interface ModelAdapterRequest {
  readonly model: string;
  readonly systemInstructions: string;
  readonly input: readonly ModelInputItem[];
  readonly tools: readonly ModelToolDefinition[];
  readonly toolChoice: ModelToolChoice;
  readonly configuration?: Readonly<Record<string, unknown>>;
}

export interface ModelToolCallAttempt {
  readonly callId: string | null;
  readonly name: string;
  readonly arguments: string;
  readonly index: number;
  readonly rawCall: unknown;
}

export interface ModelAdapterResult {
  readonly rawResponse: unknown;
  readonly assistantText: string | null;
  readonly toolCalls: readonly ModelToolCallAttempt[];
  readonly continuationItems: readonly ModelInputItem[];
  readonly responseId: string | null;
  readonly status: string | null;
  readonly usage: unknown;
  readonly provider: string;
  readonly model: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface ModelAdapter {
  generate(request: ModelAdapterRequest): Promise<ModelAdapterResult>;
}

export const READ_FILE_TOOL_DEFINITION: ModelToolDefinition = Object.freeze({
  type: "function",
  name: "read_file",
  description: "Read the contents of a file at the specified path.",
  parameters: Object.freeze({
    type: "object",
    properties: Object.freeze({
      path: Object.freeze({
        type: "string",
        description: "Path of the file to read.",
      }),
    }),
    required: Object.freeze(["path"]),
    additionalProperties: false,
  }),
  strict: true,
});

export class ModelAdapterError extends Error {
  readonly provider: string;
  readonly status: string | null;
  readonly responseId: string | null;
  readonly terminationReason: Exclude<
    TerminationReason,
    "COMPLETED" | "STEP_RESPONSE_LIMIT"
  >;
  readonly failureClassification: AdapterFailureClassification;
  readonly integrityFailureCode: IntegrityFailureCode | null;

  constructor(options: {
    readonly provider: string;
    readonly status?: string | null;
    readonly responseId?: string | null;
    readonly terminationReason?: Exclude<
      TerminationReason,
      "COMPLETED" | "STEP_RESPONSE_LIMIT"
    >;
    readonly failureClassification?: AdapterFailureClassification;
    readonly integrityFailureCode?: IntegrityFailureCode | null;
    readonly cause?: unknown;
  }) {
    super(`${options.provider} model request failed`, { cause: options.cause });
    this.name = "ModelAdapterError";
    this.provider = options.provider;
    this.status = options.status ?? null;
    this.responseId = options.responseId ?? null;
    this.terminationReason = options.terminationReason ?? "PROVIDER_ERROR";
    this.failureClassification =
      options.failureClassification ?? "TRANSIENT_INFRASTRUCTURE";
    this.integrityFailureCode = options.integrityFailureCode ?? null;
  }
}
