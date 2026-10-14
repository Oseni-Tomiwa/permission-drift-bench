import type {
  AdapterFailureClassification,
  IntegrityFailureCode,
  TerminationReason,
} from "../schemas/trial-policy.js";
import { canonicalJson } from "../provenance/canonical-json.js";
import type { CanonicalJsonValue } from "../provenance/canonical-json.js";

export const MODEL_ADAPTER_CONTRACT_VERSION = "model-adapter-v0.2.0";

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
  readonly toolName?: string | null;
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

export type ToolArgumentStatus =
  | "VALID"
  | "MALFORMED_JSON"
  | "INVALID_SHAPE"
  | "MISSING"
  | "PROVIDER_PARSE_FAILURE";

export type NormalizedResponseStatus =
  | "COMPLETED"
  | "REQUIRES_ACTION"
  | "INCOMPLETE"
  | "FAILED"
  | "CANCELLED"
  | "UNKNOWN";

export interface RawModelToolCallAttempt {
  readonly index: number;
  readonly providerCallId: string | null;
  readonly toolName: string | null;
  readonly rawArguments?: unknown;
  readonly rawProviderCall: unknown;
}

export interface ModelToolCallAttempt extends RawModelToolCallAttempt {
  readonly normalizedArguments: string | null;
  readonly parsedArguments: unknown | null;
  readonly argumentStatus: ToolArgumentStatus;
  readonly duplicateOfIndex: number | null;
}

export type ModelOrderedOutputItem =
  | Readonly<{
      index: number;
      kind: "ASSISTANT_TEXT";
      text: string;
      rawProviderItem: unknown;
    }>
  | Readonly<{
      index: number;
      kind: "TOOL_CALL";
      toolCallIndex: number;
      rawProviderItem: unknown;
    }>
  | Readonly<{
      index: number;
      kind: "PROVIDER_STATE";
      provider: string;
      value: unknown;
    }>
  | Readonly<{
      index: number;
      kind: "UNKNOWN_PROVIDER_ITEM";
      provider: string;
      rawProviderItem: unknown;
    }>;

export type AdapterErrorCode =
  | "TIMEOUT"
  | "RATE_LIMIT"
  | "AUTHENTICATION"
  | "PERMISSION_OR_ACCOUNT"
  | "INVALID_REQUEST"
  | "PROVIDER_5XX"
  | "NETWORK"
  | "RESPONSE_PARSE"
  | "UNSUPPORTED_CONFIGURATION"
  | "FOREIGN_CONTINUATION_STATE"
  | "SEMANTIC_MAPPING_FAILURE"
  | "UNKNOWN_PROVIDER_ERROR";

function errorRecord(error: unknown): Record<string, unknown> {
  return error !== null && typeof error === "object"
    ? (error as Record<string, unknown>)
    : {};
}

export function classifyProviderError(
  provider: string,
  cause: unknown,
): ModelAdapterError {
  const record = errorRecord(cause);
  const status = typeof record.status === "number" ? record.status : null;
  const name =
    typeof record.name === "string" ? record.name.toLowerCase() : "";
  const code =
    typeof record.code === "string" ? record.code.toUpperCase() : "";

  if (name.includes("timeout") || code === "ETIMEDOUT") {
    return new ModelAdapterError({
      provider,
      errorCode: "TIMEOUT",
      terminationReason: "PROVIDER_TIMEOUT",
      cause,
    });
  }
  if (status === 429) {
    return new ModelAdapterError({
      provider,
      status: String(status),
      errorCode: "RATE_LIMIT",
      terminationReason: "RATE_LIMIT",
      cause,
    });
  }
  if (status === 401 || status === 403 || status === 400) {
    const errorCode: AdapterErrorCode =
      status === 401
        ? "AUTHENTICATION"
        : status === 403
          ? "PERMISSION_OR_ACCOUNT"
          : "INVALID_REQUEST";
    return new ModelAdapterError({
      provider,
      status: String(status),
      errorCode,
      failureClassification: "INTEGRITY_CORRUPTION",
      integrityFailureCode: "WRONG_MODEL_CONFIGURATION",
      cause,
    });
  }
  if (status !== null && status >= 500) {
    return new ModelAdapterError({
      provider,
      status: String(status),
      errorCode: "PROVIDER_5XX",
      cause,
    });
  }
  if (
    ["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(code)
  ) {
    return new ModelAdapterError({
      provider,
      errorCode: "NETWORK",
      cause,
    });
  }
  return new ModelAdapterError({ provider, cause });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeArguments(rawArguments: unknown): Readonly<{
  normalizedArguments: string | null;
  parsedArguments: unknown | null;
  argumentStatus: ToolArgumentStatus;
}> {
  if (rawArguments === undefined) {
    return Object.freeze({
      normalizedArguments: null,
      parsedArguments: null,
      argumentStatus: "MISSING" as const,
    });
  }

  let parsedArguments: unknown;
  if (typeof rawArguments === "string") {
    try {
      parsedArguments = JSON.parse(rawArguments);
    } catch {
      return Object.freeze({
        normalizedArguments: null,
        parsedArguments: null,
        argumentStatus: "MALFORMED_JSON" as const,
      });
    }
  } else {
    parsedArguments = rawArguments;
  }

  let normalizedArguments: string;
  try {
    normalizedArguments = canonicalJson(parsedArguments as CanonicalJsonValue);
  } catch {
    return Object.freeze({
      normalizedArguments: null,
      parsedArguments: null,
      argumentStatus: "PROVIDER_PARSE_FAILURE" as const,
    });
  }

  return Object.freeze({
    normalizedArguments,
    parsedArguments,
    argumentStatus: isPlainRecord(parsedArguments)
      ? ("VALID" as const)
      : ("INVALID_SHAPE" as const),
  });
}

export function normalizeToolCallAttempts(
  calls: readonly RawModelToolCallAttempt[],
): readonly ModelToolCallAttempt[] {
  const firstIndexByCallId = new Map<string, number>();
  return Object.freeze(
    calls.map((call) => {
      const normalized = normalizeArguments(call.rawArguments);
      const duplicateOfIndex =
        call.providerCallId === null
          ? null
          : (firstIndexByCallId.get(call.providerCallId) ?? null);
      if (
        call.providerCallId !== null &&
        !firstIndexByCallId.has(call.providerCallId)
      ) {
        firstIndexByCallId.set(call.providerCallId, call.index);
      }
      return Object.freeze({
        ...call,
        ...normalized,
        duplicateOfIndex,
      });
    }),
  );
}

export interface ModelAdapterResult {
  readonly contractVersion: typeof MODEL_ADAPTER_CONTRACT_VERSION;
  readonly rawResponse: unknown;
  readonly assistantText: string | null;
  readonly assistantTextSegments: readonly string[];
  readonly orderedOutput: readonly ModelOrderedOutputItem[];
  readonly toolCalls: readonly ModelToolCallAttempt[];
  readonly continuationItems: readonly ModelInputItem[];
  readonly responseId: string | null;
  readonly status: string | null;
  readonly responseStatus: NormalizedResponseStatus;
  readonly usage: unknown;
  readonly provider: string;
  readonly requestedModel: string;
  readonly returnedModel: string | null;
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
  readonly errorCode: AdapterErrorCode;
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
    readonly errorCode?: AdapterErrorCode;
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
    this.errorCode = options.errorCode ?? "UNKNOWN_PROVIDER_ERROR";
    this.status = options.status ?? null;
    this.responseId = options.responseId ?? null;
    this.terminationReason = options.terminationReason ?? "PROVIDER_ERROR";
    this.failureClassification =
      options.failureClassification ?? "TRANSIENT_INFRASTRUCTURE";
    this.integrityFailureCode = options.integrityFailureCode ?? null;
  }
}
