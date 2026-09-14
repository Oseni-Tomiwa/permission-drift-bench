import assert from "node:assert/strict";
import test from "node:test";

import { READ_FILE_TOOL_DEFINITION } from "../../dist/adapters/model-adapter.js";
import { OpenAIResponsesAdapter } from "../../dist/adapters/openai-responses-adapter.js";

test("OpenAI adapter maps a stateless provider-neutral request to Responses API", async () => {
  const requests = [];
  const rawResponse = {
    id: "resp-test",
    object: "response",
    created_at: 1,
    status: "completed",
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: 100,
    model: "configured-model",
    output_text: "I used the available results.",
    output: [
      { type: "reasoning", id: "reasoning-1", summary: [] },
      {
        type: "function_call",
        id: "fc-1",
        call_id: "call-1",
        name: "read_file",
        arguments: '{"path":"project_alpha/report.txt"}',
        status: "completed",
      },
      {
        type: "message",
        id: "message-1",
        role: "assistant",
        status: "completed",
        content: [
          { type: "output_text", text: "I used the available results.", annotations: [] },
        ],
      },
      {
        type: "function_call",
        id: "fc-2",
        call_id: "call-2",
        name: "read_file",
        arguments: '{"path":"project_beta/report.txt"}',
        status: "completed",
      },
    ],
    parallel_tool_calls: true,
    previous_response_id: null,
    temperature: 0.2,
    tool_choice: "auto",
    tools: [],
    top_p: 0.9,
    truncation: "disabled",
    usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
  };
  const client = {
    responses: {
      async create(request) {
        requests.push(request);
        return rawResponse;
      },
    },
  };
  const adapter = new OpenAIResponsesAdapter(client);
  const reasoningItem = { type: "reasoning", id: "prior-reasoning", summary: [] };

  const result = await adapter.generate({
    model: "configured-model",
    systemInstructions: "Synthetic sandbox instructions.",
    input: [
      { type: "message", role: "user", content: "Read Alpha." },
      { type: "provider_state", provider: "openai", value: reasoningItem },
      {
        type: "tool_result",
        callId: "prior-call",
        output: '{"ok":true,"content":"synthetic"}',
      },
    ],
    tools: [READ_FILE_TOOL_DEFINITION],
    toolChoice: "auto",
    configuration: {
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: 100,
    },
  });

  assert.deepEqual(requests, [
    {
      model: "configured-model",
      instructions: "Synthetic sandbox instructions.",
      input: [
        { role: "user", content: "Read Alpha." },
        reasoningItem,
        {
          type: "function_call_output",
          call_id: "prior-call",
          output: '{"ok":true,"content":"synthetic"}',
        },
      ],
      tools: [READ_FILE_TOOL_DEFINITION],
      tool_choice: "auto",
      store: false,
      include: ["reasoning.encrypted_content"],
      temperature: 0.2,
      top_p: 0.9,
      max_output_tokens: 100,
    },
  ]);
  assert.equal("previous_response_id" in requests[0], false);
  assert.equal("conversation" in requests[0], false);
  assert.strictEqual(result.rawResponse, rawResponse);
  assert.equal(result.assistantText, "I used the available results.");
  assert.deepEqual(
    result.toolCalls.map((call) => [call.callId, call.index]),
    [
      ["call-1", 1],
      ["call-2", 3],
    ],
  );
  assert.deepEqual(
    result.continuationItems.map((item) => item.type),
    ["provider_state", "provider_state", "provider_state", "provider_state"],
  );
  assert.equal(result.responseId, "resp-test");
  assert.equal(result.status, "completed");
  assert.deepEqual(result.usage, rawResponse.usage);
  assert.equal(result.provider, "openai");
  assert.equal(result.model, "configured-model");
});

test("OpenAI adapter rejects foreign provider state without making a request", async () => {
  let called = false;
  const adapter = new OpenAIResponsesAdapter({
    responses: {
      async create() {
        called = true;
        throw new Error("should not be called");
      },
    },
  });

  await assert.rejects(
    adapter.generate({
      model: "configured-model",
      systemInstructions: "Synthetic sandbox instructions.",
      input: [{ type: "provider_state", provider: "other", value: {} }],
      tools: [READ_FILE_TOOL_DEFINITION],
      toolChoice: "auto",
    }),
    /openai model request failed/,
  );
  assert.equal(called, false);
});

test("OpenAI adapter rejects unimplemented configuration instead of ignoring it", async () => {
  let called = false;
  const adapter = new OpenAIResponsesAdapter({
    responses: {
      async create() {
        called = true;
        throw new Error("should not be called");
      },
    },
  });

  await assert.rejects(
    adapter.generate({
      model: "configured-model",
      systemInstructions: "Synthetic sandbox instructions.",
      input: [{ type: "message", role: "user", content: "Read Alpha." }],
      tools: [READ_FILE_TOOL_DEFINITION],
      toolChoice: "auto",
      configuration: { unsupportedSetting: true },
    }),
    /openai model request failed/,
  );
  assert.equal(called, false);
});
