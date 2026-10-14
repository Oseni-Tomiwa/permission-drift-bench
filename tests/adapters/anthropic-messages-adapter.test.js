import assert from "node:assert/strict";
import test from "node:test";

import {
  ModelAdapterError,
  READ_FILE_TOOL_DEFINITION,
} from "../../dist/adapters/model-adapter.js";
import {
  AnthropicMessagesAdapter,
  normalizeAnthropicMessage,
} from "../../dist/adapters/anthropic-messages-adapter.js";

const completeMessage = () => ({
  id: "msg-test",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-5-5",
  stop_reason: "tool_use",
  stop_sequence: null,
  content: [
    { type: "thinking", thinking: "", signature: "signature-1" },
    { type: "text", text: "I will inspect the file." },
    {
      type: "tool_use",
      id: "toolu-1",
      name: "read_file",
      input: { path: "project_alpha/report.txt" },
    },
    { type: "redacted_thinking", data: "opaque-state" },
    { type: "future_block", value: "retain-me" },
  ],
  usage: { input_tokens: 20, output_tokens: 10 },
});

test("Anthropic adapter maps the frozen stateless Messages configuration", async () => {
  const requests = [];
  let finalMessageCalled = false;
  const response = completeMessage();
  const priorContent = [
    { type: "thinking", thinking: "", signature: "prior-signature" },
    {
      type: "tool_use",
      id: "prior-tool",
      name: "read_file",
      input: { path: "project_alpha/report.txt" },
    },
  ];
  const client = {
    messages: {
      stream(request) {
        requests.push(request);
        return {
          async finalMessage() {
            finalMessageCalled = true;
            return response;
          },
        };
      },
    },
  };

  const adapter = new AnthropicMessagesAdapter(client);
  const result = await adapter.generate({
    model: "claude-sonnet-5-5",
    systemInstructions: "Synthetic sandbox instructions.",
    input: [
      { type: "message", role: "user", content: "Read Alpha." },
      {
        type: "provider_state",
        provider: "anthropic",
        value: { role: "assistant", content: priorContent },
      },
      {
        type: "tool_result",
        callId: "prior-tool",
        output: '{"ok":true,"content":"alpha_metric=11"}',
      },
    ],
    tools: [READ_FILE_TOOL_DEFINITION],
    toolChoice: "auto",
    configuration: {
      reasoning: { effort: "medium" },
      maxOutputTokens: 32768,
      parallelToolCalls: false,
    },
  });

  assert.equal(finalMessageCalled, true);
  assert.deepEqual(requests, [
    {
      model: "claude-sonnet-5-5",
      system: "Synthetic sandbox instructions.",
      messages: [
        { role: "user", content: "Read Alpha." },
        { role: "assistant", content: priorContent },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "prior-tool",
              content: '{"ok":true,"content":"alpha_metric=11"}',
            },
          ],
        },
      ],
      tools: [
        {
          name: "read_file",
          description: READ_FILE_TOOL_DEFINITION.description,
          input_schema: READ_FILE_TOOL_DEFINITION.parameters,
          strict: true,
        },
      ],
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      max_tokens: 32768,
    },
  ]);
  assert.equal("container" in requests[0], false);
  assert.equal("temperature" in requests[0], false);
  assert.equal("top_p" in requests[0], false);
  assert.equal("seed" in requests[0], false);
  assert.strictEqual(result.rawResponse, response);
  assert.equal(result.assistantText, "I will inspect the file.");
  assert.deepEqual(result.assistantTextSegments, ["I will inspect the file."]);
  assert.deepEqual(
    result.orderedOutput.map((item) => item.kind),
    [
      "PROVIDER_STATE",
      "ASSISTANT_TEXT",
      "TOOL_CALL",
      "PROVIDER_STATE",
      "UNKNOWN_PROVIDER_ITEM",
    ],
  );
  assert.deepEqual(result.toolCalls[0], {
    index: 2,
    providerCallId: "toolu-1",
    toolName: "read_file",
    rawArguments: { path: "project_alpha/report.txt" },
    normalizedArguments: '{"path":"project_alpha/report.txt"}',
    parsedArguments: { path: "project_alpha/report.txt" },
    argumentStatus: "VALID",
    duplicateOfIndex: null,
    rawProviderCall: response.content[2],
  });
  assert.deepEqual(result.continuationItems, [
    {
      type: "provider_state",
      provider: "anthropic",
      value: { role: "assistant", content: response.content },
    },
  ]);
  assert.equal(result.responseId, "msg-test");
  assert.equal(result.status, "tool_use");
  assert.equal(result.responseStatus, "REQUIRES_ACTION");
  assert.equal(result.requestedModel, "claude-sonnet-5-5");
  assert.equal(result.returnedModel, "claude-sonnet-5-5");
  assert.deepEqual(result.usage, response.usage);
  assert.equal(result.metadata.apiSurface, "messages-v1");
  assert.equal(result.metadata.streaming, true);
  assert.equal(
    result.metadata.adapterVersion,
    "anthropic-messages-adapter-v0.1.0",
  );
  assert.equal(result.metadata.sdkPackage, "@anthropic-ai/sdk");
  assert.equal(result.metadata.sdkVersion, "0.133.0");
  assert.equal(result.metadata.thinkingMode, "adaptive");
  assert.equal(result.metadata.temperature, "OMITTED");
  assert.equal(result.metadata.topP, "OMITTED");
  assert.equal(result.metadata.seed, "UNAVAILABLE");
  assert.equal(result.metadata.providerSession, "OMITTED");
  assert.equal(result.metadata.parallelToolCalls, false);
  assert.equal(result.metadata.builtInTools, false);
});

test("Anthropic streamed complete-message normalization equals direct normalization", async () => {
  const response = completeMessage();
  const adapter = new AnthropicMessagesAdapter({
    messages: {
      stream() {
        return { finalMessage: async () => response };
      },
    },
  });
  const request = {
    model: "claude-sonnet-5-5",
    systemInstructions: "Synthetic sandbox instructions.",
    input: [{ type: "message", role: "user", content: "Read Alpha." }],
    tools: [READ_FILE_TOOL_DEFINITION],
    toolChoice: "auto",
    configuration: {
      reasoning: { effort: "medium" },
      maxOutputTokens: 32768,
      parallelToolCalls: false,
    },
  };

  const streamed = await adapter.generate(request);
  const complete = normalizeAnthropicMessage(response, request.model);
  assert.deepEqual(streamed, complete);
});

test("Anthropic adapter rejects foreign continuation state before streaming", async () => {
  let called = false;
  const adapter = new AnthropicMessagesAdapter({
    messages: {
      stream() {
        called = true;
        throw new Error("should not stream");
      },
    },
  });

  await assert.rejects(
    adapter.generate({
      model: "claude-sonnet-5-5",
      systemInstructions: "Synthetic sandbox instructions.",
      input: [{ type: "provider_state", provider: "openai", value: {} }],
      tools: [READ_FILE_TOOL_DEFINITION],
      toolChoice: "auto",
    }),
    (error) => {
      assert.ok(error instanceof ModelAdapterError);
      assert.equal(error.errorCode, "FOREIGN_CONTINUATION_STATE");
      assert.equal(error.failureClassification, "INTEGRITY_CORRUPTION");
      return true;
    },
  );
  assert.equal(called, false);
});

test("Anthropic adapter rejects unsupported configuration before streaming", async () => {
  let called = false;
  const adapter = new AnthropicMessagesAdapter({
    messages: {
      stream() {
        called = true;
        throw new Error("should not stream");
      },
    },
  });

  await assert.rejects(
    adapter.generate({
      model: "claude-sonnet-5-5",
      systemInstructions: "Synthetic sandbox instructions.",
      input: [{ type: "message", role: "user", content: "Read Alpha." }],
      tools: [READ_FILE_TOOL_DEFINITION],
      toolChoice: "auto",
      configuration: { seed: 7 },
    }),
    (error) => {
      assert.ok(error instanceof ModelAdapterError);
      assert.equal(error.errorCode, "UNSUPPORTED_CONFIGURATION");
      assert.equal(error.failureClassification, "INTEGRITY_CORRUPTION");
      return true;
    },
  );
  assert.equal(called, false);

  await assert.rejects(
    adapter.generate({
      model: "claude-sonnet-5-5",
      systemInstructions: "Synthetic sandbox instructions.",
      input: [{ type: "message", role: "user", content: "Read Alpha." }],
      tools: [READ_FILE_TOOL_DEFINITION],
      toolChoice: "auto",
      configuration: { parallelToolCalls: true },
    }),
    (error) => {
      assert.ok(error instanceof ModelAdapterError);
      assert.equal(error.errorCode, "UNSUPPORTED_CONFIGURATION");
      return true;
    },
  );
  assert.equal(called, false);
});
