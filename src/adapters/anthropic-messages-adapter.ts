import {
  MODEL_ADAPTER_CONTRACT_VERSION,
  ModelAdapterError,
  classifyProviderError,
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

export const ANTHROPIC_MESSAGES_ADAPTER_VERSION =
  "anthropic-messages-adapter-v0.1.0";
export const ANTHROPIC_MESSAGES_API_SURFACE = "messages-v1";
export const ANTHROPIC_SDK_VERSION = "0.133.0";

interface AnthropicContentBlock {
  readonly type?: unknown;
  readonly text?: unknown;
  readonly id?: unknown;
  readonly name?: unknown;
  readonly input?: unknown;
  readonly [key: string]: unknown;
}

interface AnthropicMessageLike {
  readonly id?: unknown;
  readonly model?: unknown;
  readonly stop_reason?: unknown;
  readonly stop_sequence?: unknown;
  readonly stop_details?: unknown;
  readonly content?: readonly AnthropicContentBlock[];
  readonly usage?: unknown;
  readonly [key: string]: unknown;
}

interface AnthropicMessageStream {
  finalMessage(): Promise<AnthropicMessageLike>;
}

export interface AnthropicMessagesClient {
  readonly messages: {
    stream(request: Readonly<Record<string, unknown>>): AnthropicMessageStream;
  };
}

function semanticError(
  errorCode: "FOREIGN_CONTINUATION_STATE" | "SEMANTIC_MAPPING_FAILURE",
  cause: unknown,
): ModelAdapterError {
  return new ModelAdapterError({
    provider: "anthropic",
    errorCode,
    terminationReason: "ADAPTER_ERROR",
    failureClassification: "INTEGRITY_CORRUPTION",
    integrityFailureCode: "ADAPTER_SEMANTIC_CORRUPTION",
    cause,
  });
}

function configurationError(cause: unknown): ModelAdapterError {
  return new ModelAdapterError({
    provider: "anthropic",
    errorCode: "UNSUPPORTED_CONFIGURATION",
    terminationReason: "ADAPTER_ERROR",
    failureClassification: "INTEGRITY_CORRUPTION",
    integrityFailureCode: "WRONG_MODEL_CONFIGURATION",
    cause,
  });
}

function mapInputItem(item: ModelInputItem): Readonly<Record<string, unknown>> {
  switch (item.type) {
    case "message":
      return Object.freeze({ role: item.role, content: item.content });
    case "tool_result":
      return Object.freeze({
        role: "user",
        content: Object.freeze([
          Object.freeze({
            type: "tool_result",
            tool_use_id: item.callId,
            content: item.output,
          }),
        ]),
      });
    case "tool_call": {
      let input: unknown;
      try {
        input = JSON.parse(item.arguments);
      } catch (error) {
        throw semanticError("SEMANTIC_MAPPING_FAILURE", error);
      }
      return Object.freeze({
        role: "assistant",
        content: Object.freeze([
          Object.freeze({
            type: "tool_use",
            id: item.callId,
            name: item.name,
            input,
          }),
        ]),
      });
    }
    case "provider_state": {
      if (item.provider !== "anthropic") {
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
          new Error("Anthropic continuation state must be a message"),
        );
      }
      return item.value as Readonly<Record<string, unknown>>;
    }
  }
}

function mapTool(tool: ModelToolDefinition): Readonly<Record<string, unknown>> {
  if (tool.type !== "function" || tool.name !== "read_file") {
    throw configurationError(new Error("Anthropic exposes only read_file"));
  }
  return Object.freeze({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
    strict: tool.strict,
  });
}

function configurationFields(
  configuration: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> {
  const config = configuration ?? {};
  const supportedKeys = new Set([
    "reasoning",
    "maxOutputTokens",
    "parallelToolCalls",
  ]);
  for (const key of Object.keys(config)) {
    if (!supportedKeys.has(key)) {
      throw configurationError(
        new Error(`Unsupported Anthropic configuration field: ${key}`),
      );
    }
  }

  const fields: Record<string, unknown> = {};
  if (config.reasoning !== undefined) {
    if (
      config.reasoning === null ||
      typeof config.reasoning !== "object" ||
      Array.isArray(config.reasoning) ||
      typeof (config.reasoning as Record<string, unknown>).effort !== "string"
    ) {
      throw configurationError(new Error("Invalid Anthropic reasoning setting"));
    }
    fields.output_config = Object.freeze({
      effort: (config.reasoning as Record<string, unknown>).effort,
    });
  }
  if (config.maxOutputTokens !== undefined) {
    if (typeof config.maxOutputTokens !== "number") {
      throw configurationError(
        new Error("Anthropic maxOutputTokens must be a number"),
      );
    }
    fields.max_tokens = config.maxOutputTokens;
  }
  if (config.parallelToolCalls !== undefined) {
    if (typeof config.parallelToolCalls !== "boolean") {
      throw configurationError(
        new Error("Anthropic parallelToolCalls must be a boolean"),
      );
    }
    if (config.parallelToolCalls) {
      throw configurationError(
        new Error("Anthropic parallel tool calls must remain disabled"),
      );
    }
    fields.disable_parallel_tool_use = !config.parallelToolCalls;
  }
  return fields;
}

function toolChoice(
  choice: ModelAdapterRequest["toolChoice"],
  disableParallelToolUse: boolean,
): Readonly<Record<string, unknown>> {
  if (choice === "required") {
    throw configurationError(
      new Error("Required tool choice is unsupported for this frozen model"),
    );
  }
  return Object.freeze(
    choice === "none"
      ? { type: "none" }
      : { type: "auto", disable_parallel_tool_use: disableParallelToolUse },
  );
}

export function normalizeAnthropicMessage(
  response: AnthropicMessageLike,
  requestedModel: string,
): ModelAdapterResult {
  if (!Array.isArray(response.content)) {
    throw new ModelAdapterError({
      provider: "anthropic",
      errorCode: "RESPONSE_PARSE",
      terminationReason: "ADAPTER_ERROR",
      failureClassification: "TRANSIENT_INFRASTRUCTURE",
      cause: new Error("Anthropic response content must be an array"),
    });
  }

  const rawCalls: RawModelToolCallAttempt[] = response.content.flatMap(
    (block, index) =>
      block.type === "tool_use"
        ? [
            Object.freeze({
              index,
              providerCallId:
                typeof block.id === "string" ? block.id : null,
              toolName: typeof block.name === "string" ? block.name : null,
              ...(Object.hasOwn(block, "input")
                ? { rawArguments: block.input }
                : {}),
              rawProviderCall: block,
            }),
          ]
        : [],
  );
  const toolCalls = normalizeToolCallAttempts(rawCalls);
  const assistantTextSegments = Object.freeze(
    response.content.flatMap((block) =>
      block.type === "text" && typeof block.text === "string"
        ? [block.text]
        : [],
    ),
  );
  const orderedOutput = Object.freeze(
    response.content.map((block, index): ModelOrderedOutputItem => {
      if (block.type === "text") {
        return Object.freeze({
          index,
          kind: "ASSISTANT_TEXT" as const,
          text: typeof block.text === "string" ? block.text : "",
          rawProviderItem: block,
        });
      }
      if (block.type === "tool_use") {
        return Object.freeze({
          index,
          kind: "TOOL_CALL" as const,
          toolCallIndex: toolCalls.findIndex(
            (candidate) => candidate.index === index,
          ),
          rawProviderItem: block,
        });
      }
      if (block.type === "thinking" || block.type === "redacted_thinking") {
        return Object.freeze({
          index,
          kind: "PROVIDER_STATE" as const,
          provider: "anthropic",
          value: block,
        });
      }
      return Object.freeze({
        index,
        kind: "UNKNOWN_PROVIDER_ITEM" as const,
        provider: "anthropic",
        rawProviderItem: block,
      });
    }),
  );
  const returnedModel =
    typeof response.model === "string" ? response.model : null;
  const stopReason =
    typeof response.stop_reason === "string" ? response.stop_reason : null;
  const responseStatus =
    stopReason === "tool_use"
      ? "REQUIRES_ACTION"
      : stopReason === "max_tokens"
        ? "INCOMPLETE"
        : stopReason === "end_turn" || stopReason === "stop_sequence"
          ? "COMPLETED"
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
    continuationItems: Object.freeze([
      Object.freeze({
        type: "provider_state" as const,
        provider: "anthropic",
        value: Object.freeze({
          role: "assistant",
          content: response.content,
        }),
      }),
    ]),
    responseId: typeof response.id === "string" ? response.id : null,
    status: stopReason,
    responseStatus,
    usage: response.usage ?? null,
    provider: "anthropic",
    requestedModel,
    returnedModel,
    metadata: Object.freeze({
      adapterVersion: ANTHROPIC_MESSAGES_ADAPTER_VERSION,
      apiSurface: ANTHROPIC_MESSAGES_API_SURFACE,
      sdkPackage: "@anthropic-ai/sdk",
      sdkVersion: ANTHROPIC_SDK_VERSION,
      streaming: true,
      thinkingMode: "adaptive",
      temperature: "OMITTED",
      topP: "OMITTED",
      seed: "UNAVAILABLE",
      providerSession: "OMITTED",
      parallelToolCalls: false,
      builtInTools: false,
      stopReason: response.stop_reason ?? null,
      stopSequence: response.stop_sequence ?? null,
      stopDetails: response.stop_details ?? null,
    }),
  });
}

export class AnthropicMessagesAdapter implements ModelAdapter {
  #client: AnthropicMessagesClient | undefined;

  constructor(client?: AnthropicMessagesClient) {
    this.#client = client;
  }

  async #getClient(): Promise<AnthropicMessagesClient> {
    if (this.#client === undefined) {
      const packageName = "@anthropic-ai/sdk";
      const { default: Anthropic } = await import(packageName);
      this.#client = new Anthropic() as unknown as AnthropicMessagesClient;
    }
    return this.#client;
  }

  async generate(request: ModelAdapterRequest): Promise<ModelAdapterResult> {
    let messages: readonly Readonly<Record<string, unknown>>[];
    let tools: readonly Readonly<Record<string, unknown>>[];
    let configuredFields: Readonly<Record<string, unknown>>;
    try {
      messages = Object.freeze(request.input.map(mapInputItem));
      tools = Object.freeze(request.tools.map(mapTool));
      configuredFields = configurationFields(request.configuration);
    } catch (error) {
      if (error instanceof ModelAdapterError) throw error;
      throw semanticError("SEMANTIC_MAPPING_FAILURE", error);
    }

    const disableParallelToolUse =
      configuredFields.disable_parallel_tool_use === true;
    const { disable_parallel_tool_use: _omitted, ...requestConfiguration } =
      configuredFields;

    let response: AnthropicMessageLike;
    try {
      const client = await this.#getClient();
      const stream = client.messages.stream({
        model: request.model,
        system: request.systemInstructions,
        messages,
        tools,
        tool_choice: toolChoice(request.toolChoice, disableParallelToolUse),
        thinking: Object.freeze({ type: "adaptive" }),
        ...requestConfiguration,
      });
      response = await stream.finalMessage();
    } catch (error) {
      if (error instanceof ModelAdapterError) throw error;
      throw classifyProviderError("anthropic", error);
    }

    try {
      return normalizeAnthropicMessage(response, request.model);
    } catch (error) {
      if (error instanceof ModelAdapterError) throw error;
      throw new ModelAdapterError({
        provider: "anthropic",
        errorCode: "RESPONSE_PARSE",
        terminationReason: "ADAPTER_ERROR",
        failureClassification: "TRANSIENT_INFRASTRUCTURE",
        cause: error,
      });
    }
  }
}
