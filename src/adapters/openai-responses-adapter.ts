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
  ModelToolCallAttempt,
  RawModelToolCallAttempt,
} from "./model-adapter.js";

export const OPENAI_RESPONSES_ADAPTER_VERSION =
  "openai-responses-adapter-v0.2.0";
export const OPENAI_RESPONSES_API_SURFACE = "responses-v1";
export const OPENAI_SDK_VERSION = "7.15.0";

interface OpenAIResponseOutputItem {
  readonly type: string;
  readonly call_id?: unknown;
  readonly name?: unknown;
  readonly arguments?: unknown;
  readonly [key: string]: unknown;
}

interface OpenAIResponseLike {
  readonly id?: unknown;
  readonly status?: unknown;
  readonly output_text?: unknown;
  readonly output?: readonly OpenAIResponseOutputItem[];
  readonly usage?: unknown;
  readonly model?: unknown;
  readonly parallel_tool_calls?: unknown;
  readonly incomplete_details?: unknown;
  readonly [key: string]: unknown;
}

function normalizedResponseStatus(status: string | null) {
  switch (status) {
    case "completed":
      return "COMPLETED" as const;
    case "incomplete":
    case "in_progress":
    case "queued":
      return "INCOMPLETE" as const;
    case "failed":
      return "FAILED" as const;
    case "cancelled":
      return "CANCELLED" as const;
    default:
      return "UNKNOWN" as const;
  }
}

export interface OpenAIResponsesClient {
  readonly responses: {
    create(request: Readonly<Record<string, unknown>>): Promise<OpenAIResponseLike>;
  };
}

function mapInputItem(item: ModelInputItem): unknown {
  switch (item.type) {
    case "message":
      return { role: item.role, content: item.content };
    case "tool_call":
      return {
        type: "function_call",
        call_id: item.callId,
        name: item.name,
        arguments: item.arguments,
      };
    case "tool_result":
      return {
        type: "function_call_output",
        call_id: item.callId,
        output: item.output,
      };
    case "provider_state":
      if (item.provider !== "openai") {
        throw new Error(`Unsupported provider state: ${item.provider}`);
      }
      return item.value;
  }
}

function configurationFields(
  configuration: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> {
  if (configuration === undefined) {
    return {};
  }
  const supportedKeys = new Set([
    "temperature",
    "topP",
    "maxOutputTokens",
    "reasoning",
    "parallelToolCalls",
  ]);
  for (const key of Object.keys(configuration)) {
    if (!supportedKeys.has(key)) {
      throw new Error(`Unsupported OpenAI configuration field: ${key}`);
    }
  }
  const fields: Record<string, unknown> = {};
  if (configuration.temperature !== undefined) {
    if (typeof configuration.temperature !== "number") {
      throw new Error("OpenAI temperature must be a number");
    }
    fields.temperature = configuration.temperature;
  }
  if (configuration.topP !== undefined) {
    if (typeof configuration.topP !== "number") {
      throw new Error("OpenAI topP must be a number");
    }
    fields.top_p = configuration.topP;
  }
  if (configuration.maxOutputTokens !== undefined) {
    if (typeof configuration.maxOutputTokens !== "number") {
      throw new Error("OpenAI maxOutputTokens must be a number");
    }
    fields.max_output_tokens = configuration.maxOutputTokens;
  }
  if (configuration.reasoning !== undefined) {
    if (
      typeof configuration.reasoning !== "object" ||
      configuration.reasoning === null
    ) {
      throw new Error("OpenAI reasoning configuration must be an object");
    }
    fields.reasoning = configuration.reasoning;
  }
  if (configuration.parallelToolCalls !== undefined) {
    if (typeof configuration.parallelToolCalls !== "boolean") {
      throw new Error("OpenAI parallelToolCalls must be a boolean");
    }
    fields.parallel_tool_calls = configuration.parallelToolCalls;
  }
  return fields;
}

function mapTool(tool: ModelToolDefinition): ModelToolDefinition {
  if (tool.type !== "function" || tool.name !== "read_file") {
    throw new Error("OpenAI exposes only read_file");
  }
  return tool;
}

function parseToolCalls(
  output: readonly OpenAIResponseOutputItem[],
): readonly ModelToolCallAttempt[] {
  const rawCalls: RawModelToolCallAttempt[] =
    output.flatMap((item, index) => {
      if (item.type !== "function_call") {
        return [];
      }
      return [
        Object.freeze({
          index,
          providerCallId:
            typeof item.call_id === "string" ? item.call_id : null,
          toolName: typeof item.name === "string" ? item.name : null,
          ...(Object.hasOwn(item, "arguments")
            ? { rawArguments: item.arguments }
            : {}),
          rawProviderCall: item,
        }),
      ];
    });
  return normalizeToolCallAttempts(rawCalls);
}

function textSegments(
  output: readonly OpenAIResponseOutputItem[],
): readonly string[] {
  return Object.freeze(
    output.flatMap((item) => {
      if (item.type !== "message" || !Array.isArray(item.content)) {
        return [];
      }
      return item.content.flatMap((content) =>
        content !== null &&
        typeof content === "object" &&
        typeof (content as Record<string, unknown>).text === "string"
          ? [(content as Record<string, unknown>).text as string]
          : [],
      );
    }),
  );
}

function orderedOutput(
  output: readonly OpenAIResponseOutputItem[],
  toolCalls: readonly ModelToolCallAttempt[],
): readonly ModelOrderedOutputItem[] {
  return Object.freeze(
    output.map((item, index): ModelOrderedOutputItem => {
      if (item.type === "function_call") {
        const toolCallIndex = toolCalls.findIndex(
          (candidate) => candidate.index === index,
        );
        return Object.freeze({
          index,
          kind: "TOOL_CALL" as const,
          toolCallIndex,
          rawProviderItem: item,
        });
      }
      if (item.type === "message") {
        const text = textSegments([item]).join("");
        return Object.freeze({
          index,
          kind: "ASSISTANT_TEXT" as const,
          text,
          rawProviderItem: item,
        });
      }
      if (item.type === "reasoning") {
        return Object.freeze({
          index,
          kind: "PROVIDER_STATE" as const,
          provider: "openai",
          value: item,
        });
      }
      return Object.freeze({
        index,
        kind: "UNKNOWN_PROVIDER_ITEM" as const,
        provider: "openai",
        rawProviderItem: item,
      });
    }),
  );
}

export class OpenAIResponsesAdapter implements ModelAdapter {
  #client: OpenAIResponsesClient | undefined;

  constructor(client?: OpenAIResponsesClient) {
    this.#client = client;
  }

  async #getClient(): Promise<OpenAIResponsesClient> {
    if (this.#client === undefined) {
      const { default: OpenAI } = await import("openai");
      this.#client = new OpenAI() as unknown as OpenAIResponsesClient;
    }
    return this.#client;
  }

  async generate(request: ModelAdapterRequest): Promise<ModelAdapterResult> {
    let input: readonly unknown[];
    try {
      input = request.input.map(mapInputItem);
    } catch (error) {
      throw new ModelAdapterError({
        provider: "openai",
        errorCode: "FOREIGN_CONTINUATION_STATE",
        terminationReason: "ADAPTER_ERROR",
        failureClassification: "INTEGRITY_CORRUPTION",
        integrityFailureCode: "ADAPTER_SEMANTIC_CORRUPTION",
        cause: error,
      });
    }

    let configuredFields: Readonly<Record<string, unknown>>;
    let tools: readonly ModelToolDefinition[];
    try {
      configuredFields = configurationFields(request.configuration);
      tools = Object.freeze(request.tools.map(mapTool));
    } catch (error) {
      throw new ModelAdapterError({
        provider: "openai",
        errorCode: "UNSUPPORTED_CONFIGURATION",
        terminationReason: "ADAPTER_ERROR",
        failureClassification: "INTEGRITY_CORRUPTION",
        integrityFailureCode: "WRONG_MODEL_CONFIGURATION",
        cause: error,
      });
    }

    let response: OpenAIResponseLike;
    try {
      const client = await this.#getClient();
      response = await client.responses.create({
        model: request.model,
        instructions: request.systemInstructions,
        input,
        tools: [...tools],
        tool_choice: request.toolChoice,
        store: false,
        include: ["reasoning.encrypted_content"],
        ...configuredFields,
      });
    } catch (error) {
      throw classifyProviderError("openai", error);
    }

    try {
      if (!Array.isArray(response.output)) {
        throw new TypeError("OpenAI response output must be an array");
      }
      const output = response.output;
      const responseId = typeof response.id === "string" ? response.id : null;
      const status =
        typeof response.status === "string" ? response.status : null;
      const responseModel =
        typeof response.model === "string" ? response.model : null;
      const toolCalls = parseToolCalls(output);
      const assistantTextSegments = textSegments(output);

      return Object.freeze({
        contractVersion: MODEL_ADAPTER_CONTRACT_VERSION,
        rawResponse: response,
        assistantText:
          assistantTextSegments.length > 0
            ? assistantTextSegments.join("")
            : null,
        assistantTextSegments,
        orderedOutput: orderedOutput(output, toolCalls),
        toolCalls,
        continuationItems: Object.freeze(
          output.map((item) =>
            Object.freeze({
              type: "provider_state" as const,
              provider: "openai",
              value: item,
            }),
          ),
        ),
        responseId,
        status,
        responseStatus: normalizedResponseStatus(status),
        usage: response.usage ?? null,
        provider: "openai",
        requestedModel: request.model,
        returnedModel: responseModel,
        metadata: Object.freeze({
          adapterVersion: OPENAI_RESPONSES_ADAPTER_VERSION,
          apiSurface: OPENAI_RESPONSES_API_SURFACE,
          sdkPackage: "openai",
          sdkVersion: OPENAI_SDK_VERSION,
          store: false,
          previousResponseId: "OMITTED",
          seed: "OMITTED",
          builtInTools: false,
          parallelToolCalls: response.parallel_tool_calls ?? null,
          incompleteDetails: response.incomplete_details ?? null,
        }),
      });
    } catch (error) {
      throw new ModelAdapterError({
        provider: "openai",
        errorCode: "RESPONSE_PARSE",
        terminationReason: "ADAPTER_ERROR",
        failureClassification: "TRANSIENT_INFRASTRUCTURE",
        cause: error,
      });
    }
  }
}
