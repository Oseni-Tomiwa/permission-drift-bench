import {
  MODEL_ADAPTER_CONTRACT_VERSION,
  ModelAdapterError,
  classifyProviderError,
  createModelAdapterIdentity,
  normalizeToolCallAttempts,
} from "./model-adapter.js";
import type {
  ModelAdapter,
  ModelAdapterRequest,
  ModelAdapterResult,
  ModelInputItem,
  ModelOrderedOutputItem,
  ModelToolDefinition,
  RawModelToolCallAttempt,
} from "./model-adapter.js";

export const GOOGLE_INTERACTIONS_ADAPTER_VERSION =
  "google-interactions-adapter-v0.2.0";
export const GOOGLE_INTERACTIONS_API_SURFACE = "interactions-v1beta";
export const GOOGLE_GENAI_SDK_VERSION = "2.29.1";

interface GoogleInteractionStep {
  readonly type?: unknown;
  readonly id?: unknown;
  readonly name?: unknown;
  readonly arguments?: unknown;
  readonly content?: readonly unknown[];
  readonly [key: string]: unknown;
}

interface GoogleInteractionLike {
  readonly id?: unknown;
  readonly model?: unknown;
  readonly status?: unknown;
  readonly steps?: readonly GoogleInteractionStep[];
  readonly usage?: unknown;
  readonly created?: unknown;
  readonly updated?: unknown;
  readonly [key: string]: unknown;
}

export interface GoogleInteractionsClient {
  readonly interactions: {
    create(
      request: Readonly<Record<string, unknown>>,
      options?: Readonly<Record<string, unknown>>,
    ): Promise<GoogleInteractionLike>;
  };
}

function semanticError(
  errorCode: "FOREIGN_CONTINUATION_STATE" | "SEMANTIC_MAPPING_FAILURE",
  cause: unknown,
): ModelAdapterError {
  return new ModelAdapterError({
    provider: "google",
    errorCode,
    terminationReason: "ADAPTER_ERROR",
    failureClassification: "INTEGRITY_CORRUPTION",
    integrityFailureCode: "ADAPTER_SEMANTIC_CORRUPTION",
    cause,
  });
}

function configurationError(cause: unknown): ModelAdapterError {
  return new ModelAdapterError({
    provider: "google",
    errorCode: "UNSUPPORTED_CONFIGURATION",
    terminationReason: "ADAPTER_ERROR",
    failureClassification: "INTEGRITY_CORRUPTION",
    integrityFailureCode: "WRONG_MODEL_CONFIGURATION",
    cause,
  });
}

function textContent(text: string): readonly Readonly<Record<string, unknown>>[] {
  return Object.freeze([Object.freeze({ type: "text", text })]);
}

function mapInputItem(item: ModelInputItem): Readonly<Record<string, unknown>> {
  switch (item.type) {
    case "message":
      return Object.freeze(
        item.role === "user"
          ? { type: "user_input", content: textContent(item.content) }
          : { type: "model_output", content: textContent(item.content) },
      );
    case "tool_call": {
      let argumentsValue: unknown;
      try {
        argumentsValue = JSON.parse(item.arguments);
      } catch (error) {
        throw semanticError("SEMANTIC_MAPPING_FAILURE", error);
      }
      return Object.freeze({
        type: "function_call",
        id: item.callId,
        name: item.name,
        arguments: argumentsValue,
      });
    }
    case "tool_result":
      if (item.toolName === undefined || item.toolName === null) {
        throw semanticError(
          "SEMANTIC_MAPPING_FAILURE",
          new Error("Google function results require the original tool name"),
        );
      }
      return Object.freeze({
        type: "function_result",
        call_id: item.callId,
        name: item.toolName,
        result: textContent(item.output),
      });
    case "provider_state":
      if (item.provider !== "google") {
        throw semanticError(
          "FOREIGN_CONTINUATION_STATE",
          new Error(`Unsupported provider state: ${item.provider}`),
        );
      }
      if (
        item.value === null ||
        typeof item.value !== "object" ||
        Array.isArray(item.value)
      ) {
        throw semanticError(
          "SEMANTIC_MAPPING_FAILURE",
          new Error("Google continuation state must be an interaction step"),
        );
      }
      return item.value as Readonly<Record<string, unknown>>;
  }
}

function mapTool(tool: ModelToolDefinition): Readonly<Record<string, unknown>> {
  if (tool.type !== "function" || tool.name !== "read_file") {
    throw configurationError(new Error("Google exposes only read_file"));
  }
  return Object.freeze({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  });
}

function generationConfiguration(
  request: ModelAdapterRequest,
): Readonly<Record<string, unknown>> {
  const configuration = request.configuration ?? {};
  const supportedKeys = new Set(["reasoning", "maxOutputTokens"]);
  for (const key of Object.keys(configuration)) {
    if (!supportedKeys.has(key)) {
      throw configurationError(
        new Error(`Unsupported Google configuration field: ${key}`),
      );
    }
  }

  const output: Record<string, unknown> = { tool_choice: request.toolChoice };
  if (configuration.reasoning !== undefined) {
    if (
      configuration.reasoning === null ||
      typeof configuration.reasoning !== "object" ||
      Array.isArray(configuration.reasoning) ||
      typeof (configuration.reasoning as Record<string, unknown>).effort !==
        "string"
    ) {
      throw configurationError(new Error("Invalid Google reasoning setting"));
    }
    output.thinking_level = (
      configuration.reasoning as Record<string, unknown>
    ).effort;
  }
  if (configuration.maxOutputTokens !== undefined) {
    if (typeof configuration.maxOutputTokens !== "number") {
      throw configurationError(
        new Error("Google maxOutputTokens must be a number"),
      );
    }
    output.max_output_tokens = configuration.maxOutputTokens;
  }
  return Object.freeze(output);
}

function outputTextSegments(step: GoogleInteractionStep): readonly string[] {
  if (step.type !== "model_output" || !Array.isArray(step.content)) return [];
  return Object.freeze(
    step.content.flatMap((content) =>
      content !== null &&
      typeof content === "object" &&
      typeof (content as Record<string, unknown>).text === "string"
        ? [(content as Record<string, unknown>).text as string]
        : [],
    ),
  );
}

function normalizeGoogleInteraction(
  response: GoogleInteractionLike,
  requestedModel: string,
): ModelAdapterResult {
  if (!Array.isArray(response.steps)) {
    throw new ModelAdapterError({
      provider: "google",
      errorCode: "RESPONSE_PARSE",
      terminationReason: "ADAPTER_ERROR",
      failureClassification: "TRANSIENT_INFRASTRUCTURE",
      cause: new Error("Google interaction steps must be an array"),
    });
  }

  const rawCalls: RawModelToolCallAttempt[] = response.steps.flatMap(
    (step, index) =>
      step.type === "function_call"
        ? [
            Object.freeze({
              index,
              providerCallId:
                typeof step.id === "string" ? step.id : null,
              toolName: typeof step.name === "string" ? step.name : null,
              ...(Object.hasOwn(step, "arguments")
                ? { rawArguments: step.arguments }
                : {}),
              rawProviderCall: step,
            }),
          ]
        : [],
  );
  const toolCalls = normalizeToolCallAttempts(rawCalls);
  const assistantTextSegments = Object.freeze(
    response.steps.flatMap(outputTextSegments),
  );
  const orderedOutput = Object.freeze(
    response.steps.map((step, index): ModelOrderedOutputItem => {
      if (step.type === "function_call") {
        return Object.freeze({
          index,
          kind: "TOOL_CALL" as const,
          toolCallIndex: toolCalls.findIndex(
            (candidate) => candidate.index === index,
          ),
          rawProviderItem: step,
        });
      }
      if (step.type === "model_output") {
        return Object.freeze({
          index,
          kind: "ASSISTANT_TEXT" as const,
          text: outputTextSegments(step).join(""),
          rawProviderItem: step,
        });
      }
      if (step.type === "thought") {
        return Object.freeze({
          index,
          kind: "PROVIDER_STATE" as const,
          provider: "google",
          value: step,
        });
      }
      return Object.freeze({
        index,
        kind: "UNKNOWN_PROVIDER_ITEM" as const,
        provider: "google",
        rawProviderItem: step,
      });
    }),
  );
  const returnedModel =
    typeof response.model === "string" ? response.model : null;
  const status = typeof response.status === "string" ? response.status : null;
  const responseStatus =
    status === "completed"
      ? "COMPLETED"
      : status === "requires_action"
        ? "REQUIRES_ACTION"
        : status === "failed"
          ? "FAILED"
          : status === "cancelled"
            ? "CANCELLED"
            : status === "incomplete" || status === "in_progress"
              ? "INCOMPLETE"
              : "UNKNOWN";

  return Object.freeze({
    contractVersion: MODEL_ADAPTER_CONTRACT_VERSION,
    rawResponse: response,
    assistantText:
      assistantTextSegments.length === 0
        ? null
        : assistantTextSegments.join(""),
    assistantTextSegments,
    orderedOutput,
    toolCalls,
    continuationItems: Object.freeze(
      response.steps.map((step) =>
        Object.freeze({
          type: "provider_state" as const,
          provider: "google",
          value: step,
        }),
      ),
    ),
    responseId: typeof response.id === "string" ? response.id : null,
    status,
    responseStatus,
    usage: response.usage ?? null,
    provider: "google",
    requestedModel,
    returnedModel,
    metadata: Object.freeze({
      adapterVersion: GOOGLE_INTERACTIONS_ADAPTER_VERSION,
      apiSurface: GOOGLE_INTERACTIONS_API_SURFACE,
      sdkPackage: "@google/genai",
      sdkVersion: GOOGLE_GENAI_SDK_VERSION,
      created: response.created ?? null,
      updated: response.updated ?? null,
      store: false,
      background: false,
      previousInteractionId: "OMITTED",
      seed: "DELIBERATELY_OMITTED",
      parallelToolCallControl: "UNAVAILABLE",
      builtInTools: false,
    }),
  });
}

export class GoogleInteractionsAdapter implements ModelAdapter {
  #client: GoogleInteractionsClient | undefined;
  readonly #requestOptions: Readonly<Record<string, unknown>> | undefined;

  constructor(
    client?: GoogleInteractionsClient,
    requestOptions?: Readonly<Record<string, unknown>>,
  ) {
    this.#client = client;
    this.#requestOptions = requestOptions;
  }

  getIdentity(requestedModel: string) {
    return createModelAdapterIdentity({
      provider: "google",
      providerBackend: "Gemini Developer API",
      apiSurface: GOOGLE_INTERACTIONS_API_SURFACE,
      sdkPackage: "@google/genai",
      sdkVersion: GOOGLE_GENAI_SDK_VERSION,
      adapterName: "GoogleInteractionsAdapter",
      adapterVersion: GOOGLE_INTERACTIONS_ADAPTER_VERSION,
      requestedModel,
    });
  }

  async #getClient(): Promise<GoogleInteractionsClient> {
    if (this.#client === undefined) {
      const packageName = "@google/genai";
      const { GoogleGenAI } = await import(packageName);
      this.#client = new GoogleGenAI({}) as unknown as GoogleInteractionsClient;
    }
    return this.#client;
  }

  async generate(request: ModelAdapterRequest): Promise<ModelAdapterResult> {
    let input: readonly Readonly<Record<string, unknown>>[];
    let tools: readonly Readonly<Record<string, unknown>>[];
    let generationConfig: Readonly<Record<string, unknown>>;
    try {
      input = Object.freeze(request.input.map(mapInputItem));
      tools = Object.freeze(request.tools.map(mapTool));
      generationConfig = generationConfiguration(request);
    } catch (error) {
      if (error instanceof ModelAdapterError) throw error;
      throw semanticError("SEMANTIC_MAPPING_FAILURE", error);
    }

    let response: GoogleInteractionLike;
    try {
      const client = await this.#getClient();
      response = await client.interactions.create(
        {
          model: request.model,
          system_instruction: request.systemInstructions,
          input,
          tools,
          generation_config: generationConfig,
          store: false,
          background: false,
        },
        this.#requestOptions,
      );
    } catch (error) {
      throw classifyProviderError("google", error);
    }

    try {
      return normalizeGoogleInteraction(response, request.model);
    } catch (error) {
      if (error instanceof ModelAdapterError) throw error;
      throw new ModelAdapterError({
        provider: "google",
        errorCode: "RESPONSE_PARSE",
        terminationReason: "ADAPTER_ERROR",
        failureClassification: "TRANSIENT_INFRASTRUCTURE",
        cause: error,
      });
    }
  }
}
