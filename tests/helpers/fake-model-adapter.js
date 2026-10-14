import {
  MODEL_ADAPTER_CONTRACT_VERSION,
  ModelAdapterError,
  normalizeToolCallAttempts,
} from "../../dist/adapters/model-adapter.js";

export function fakeResult({
  id,
  text = null,
  calls = [],
  status = "completed",
  usage = { inputTokens: 10, outputTokens: 5 },
}) {
  const rawResponse = {
    id,
    status,
    output_text: text ?? "",
    output: calls.map((call, index) => ({
      type: "function_call",
      id: `item-${id}-${index}`,
      call_id: Object.hasOwn(call, "callId")
        ? call.callId
        : `call-${id}-${index}`,
      name: Object.hasOwn(call, "name") ? call.name : "read_file",
      arguments: call.arguments,
      status: "completed",
    })),
    usage,
    model: "fake-model",
  };
  const toolCalls = normalizeToolCallAttempts(
    rawResponse.output.map((call, index) => ({
      providerCallId: typeof call.call_id === "string" ? call.call_id : null,
      toolName: typeof call.name === "string" ? call.name : null,
      rawArguments: call.arguments,
      index,
      rawProviderCall: call,
    })),
  );
  const continuationItems = [
    ...(text === null
      ? []
      : [{ type: "message", role: "assistant", content: text }]),
    ...toolCalls.map((call) => ({
      type: "tool_call",
      callId: call.providerCallId,
      name: call.toolName,
      arguments: call.normalizedArguments ?? "",
    })),
  ];
  return {
    contractVersion: MODEL_ADAPTER_CONTRACT_VERSION,
    rawResponse,
    assistantText: text,
    assistantTextSegments: text === null ? [] : [text],
    orderedOutput: [
      ...(text === null
        ? []
        : [
            {
              index: 0,
              kind: "ASSISTANT_TEXT",
              text,
              rawProviderItem: { type: "message", text },
            },
          ]),
      ...toolCalls.map((call, index) => ({
        index: (text === null ? 0 : 1) + index,
        kind: "TOOL_CALL",
        toolCallIndex: index,
        rawProviderItem: call.rawProviderCall,
      })),
    ],
    toolCalls,
    continuationItems,
    responseId: id,
    status,
    responseStatus:
      status === "completed"
        ? "COMPLETED"
        : status === "cancelled"
          ? "CANCELLED"
          : status === "failed"
            ? "FAILED"
            : "INCOMPLETE",
    usage,
    provider: "fake",
    requestedModel: "fake-model",
    returnedModel: "fake-model",
    metadata: { fixture: true },
  };
}

export class ScriptedFakeModelAdapter {
  constructor(responses) {
    this.responses = [...responses];
    this.requests = [];
  }

  async generate(request) {
    this.requests.push({ ...request, input: [...request.input] });
    if (this.responses.length === 0) {
      throw new Error("Fake adapter exhausted");
    }
    const next = this.responses.shift();
    if (next instanceof Error) {
      throw next;
    }
    return next;
  }
}

export const fakeProviderError = () =>
  new ModelAdapterError({ provider: "fake", status: "failed" });

export const readCall = (path, callId) => ({
  callId,
  arguments: JSON.stringify({ path }),
});
