import OpenAI from "openai";

import {
  ModelAdapterError,
} from "./model-adapter.js";
import type {
  ModelAdapter,
  ModelAdapterRequest,
  ModelAdapterResult,
  ModelInputItem,
  ModelToolCallAttempt,
} from "./model-adapter.js";

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
  return fields;
}

function parseToolCalls(
  output: readonly OpenAIResponseOutputItem[],
): readonly ModelToolCallAttempt[] {
  return Object.freeze(
    output.flatMap((item, index) => {
      if (item.type !== "function_call") {
        return [];
      }
      return [
        Object.freeze({
          callId: typeof item.call_id === "string" ? item.call_id : null,
          name: typeof item.name === "string" ? item.name : "",
          arguments:
            typeof item.arguments === "string" ? item.arguments : "",
          index,
          rawCall: item,
        }),
      ];
    }),
  );
}

export class OpenAIResponsesAdapter implements ModelAdapter {
  readonly #client: OpenAIResponsesClient;

  constructor(client?: OpenAIResponsesClient) {
    this.#client =
      client ?? (new OpenAI() as unknown as OpenAIResponsesClient);
  }

  async generate(request: ModelAdapterRequest): Promise<ModelAdapterResult> {
    try {
      const response = await this.#client.responses.create({
        model: request.model,
        instructions: request.systemInstructions,
        input: request.input.map(mapInputItem),
        tools: [...request.tools],
        tool_choice: request.toolChoice,
        store: false,
        include: ["reasoning.encrypted_content"],
        ...configurationFields(request.configuration),
      });
      const output = response.output ?? [];
      const responseId =
        typeof response.id === "string" ? response.id : null;
      const status =
        typeof response.status === "string" ? response.status : null;
      const responseModel =
        typeof response.model === "string" ? response.model : request.model;

      return Object.freeze({
        rawResponse: response,
        assistantText:
          typeof response.output_text === "string" &&
          response.output_text.length > 0
            ? response.output_text
            : null,
        toolCalls: parseToolCalls(output),
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
        usage: response.usage ?? null,
        provider: "openai",
        model: responseModel,
        metadata: Object.freeze({
          parallelToolCalls: response.parallel_tool_calls ?? null,
          incompleteDetails: response.incomplete_details ?? null,
        }),
      });
    } catch (error) {
      throw new ModelAdapterError({ provider: "openai" });
    }
  }
}
