import { ModelAdapterError } from "../../dist/adapters/model-adapter.js";

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
      call_id: call.callId ?? `call-${id}-${index}`,
      name: call.name ?? "read_file",
      arguments: call.arguments,
      status: "completed",
    })),
    usage,
    model: "fake-model",
  };
  const toolCalls = rawResponse.output.map((call, index) => ({
    callId: call.call_id,
    name: call.name,
    arguments: call.arguments,
    index,
    rawCall: call,
  }));
  const continuationItems = [
    ...(text === null
      ? []
      : [{ type: "message", role: "assistant", content: text }]),
    ...toolCalls.map((call) => ({
      type: "tool_call",
      callId: call.callId,
      name: call.name,
      arguments: call.arguments,
    })),
  ];
  return {
    rawResponse,
    assistantText: text,
    toolCalls,
    continuationItems,
    responseId: id,
    status,
    usage,
    provider: "fake",
    model: "fake-model",
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
