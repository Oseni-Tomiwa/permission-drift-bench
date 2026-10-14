import assert from "node:assert/strict";
import test from "node:test";

import {
  ModelAdapterError,
  READ_FILE_TOOL_DEFINITION,
} from "../../dist/adapters/model-adapter.js";
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
      reasoning: { effort: "medium" },
      maxOutputTokens: 32768,
      parallelToolCalls: false,
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
      reasoning: { effort: "medium" },
      max_output_tokens: 32768,
      parallel_tool_calls: false,
    },
  ]);
  assert.equal("previous_response_id" in requests[0], false);
  assert.equal("conversation" in requests[0], false);
  assert.strictEqual(result.rawResponse, rawResponse);
  assert.equal(result.assistantText, "I used the available results.");
  assert.deepEqual(result.assistantTextSegments, [
    "I used the available results.",
  ]);
  assert.deepEqual(
    result.orderedOutput.map((item) => item.kind),
    ["PROVIDER_STATE", "TOOL_CALL", "ASSISTANT_TEXT", "TOOL_CALL"],
  );
  assert.deepEqual(
    result.toolCalls.map((call) => [
      call.providerCallId,
      call.index,
      call.argumentStatus,
    ]),
    [
      ["call-1", 1, "VALID"],
      ["call-2", 3, "VALID"],
    ],
  );
  assert.deepEqual(
    result.continuationItems.map((item) => item.type),
    ["provider_state", "provider_state", "provider_state", "provider_state"],
  );
  assert.equal(result.responseId, "resp-test");
  assert.equal(result.status, "completed");
  assert.equal(result.responseStatus, "COMPLETED");
  assert.deepEqual(result.usage, rawResponse.usage);
  assert.equal(result.provider, "openai");
  assert.equal(result.requestedModel, "configured-model");
  assert.equal(result.returnedModel, "configured-model");
  assert.equal(result.contractVersion, "model-adapter-v0.2.0");
  assert.deepEqual(
    {
      adapterVersion: result.metadata.adapterVersion,
      apiSurface: result.metadata.apiSurface,
      sdkPackage: result.metadata.sdkPackage,
      sdkVersion: result.metadata.sdkVersion,
    },
    {
      adapterVersion: "openai-responses-adapter-v0.2.0",
      apiSurface: "responses-v1",
      sdkPackage: "openai",
      sdkVersion: "7.15.0",
    },
  );
  assert.equal(result.metadata.store, false);
  assert.equal(result.metadata.previousResponseId, "OMITTED");
  assert.equal(result.metadata.seed, "OMITTED");
  assert.equal(result.metadata.builtInTools, false);
});

test("OpenAI assistantText is only the ordered segment aggregation", async () => {
  const adapter = new OpenAIResponsesAdapter({
    responses: {
      async create() {
        return {
          id: "resp-text-aggregation",
          status: "completed",
          model: "configured-model",
          output_text: "provider convenience text",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "ordered text" }],
            },
          ],
        };
      },
    },
  });

  const result = await adapter.generate({
    model: "configured-model",
    systemInstructions: "Synthetic sandbox instructions.",
    input: [{ type: "message", role: "user", content: "Continue." }],
    tools: [READ_FILE_TOOL_DEFINITION],
    toolChoice: "auto",
  });

  assert.deepEqual(result.assistantTextSegments, ["ordered text"]);
  assert.equal(result.assistantText, "ordered text");
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
    (error) => {
      assert.ok(error instanceof ModelAdapterError);
      assert.equal(error.terminationReason, "ADAPTER_ERROR");
      assert.equal(error.failureClassification, "INTEGRITY_CORRUPTION");
      assert.equal(error.integrityFailureCode, "ADAPTER_SEMANTIC_CORRUPTION");
      assert.equal(error.errorCode, "FOREIGN_CONTINUATION_STATE");
      return true;
    },
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
    (error) => {
      assert.ok(error instanceof ModelAdapterError);
      assert.equal(error.terminationReason, "ADAPTER_ERROR");
      assert.equal(error.failureClassification, "INTEGRITY_CORRUPTION");
      assert.equal(error.integrityFailureCode, "WRONG_MODEL_CONFIGURATION");
      assert.equal(error.errorCode, "UNSUPPORTED_CONFIGURATION");
      return true;
    },
  );
  assert.equal(called, false);
});

test("OpenAI adapter classifies provider request failures as transient infrastructure", async () => {
  const adapter = new OpenAIResponsesAdapter({
    responses: {
      async create() {
        throw new Error("synthetic provider outage");
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
    }),
    (error) => {
      assert.ok(error instanceof ModelAdapterError);
      assert.equal(error.terminationReason, "PROVIDER_ERROR");
      assert.equal(error.failureClassification, "TRANSIENT_INFRASTRUCTURE");
      assert.equal(error.integrityFailureCode, null);
      assert.equal(error.errorCode, "UNKNOWN_PROVIDER_ERROR");
      return true;
    },
  );
});

for (const fixture of [
  {
    name: "timeout",
    error: Object.assign(new Error("synthetic timeout"), { name: "TimeoutError" }),
    errorCode: "TIMEOUT",
    terminationReason: "PROVIDER_TIMEOUT",
    failureClassification: "TRANSIENT_INFRASTRUCTURE",
  },
  {
    name: "rate limit",
    error: Object.assign(new Error("synthetic rate limit"), { status: 429 }),
    errorCode: "RATE_LIMIT",
    terminationReason: "RATE_LIMIT",
    failureClassification: "TRANSIENT_INFRASTRUCTURE",
  },
  {
    name: "authentication",
    error: Object.assign(new Error("synthetic auth"), { status: 401 }),
    errorCode: "AUTHENTICATION",
    terminationReason: "PROVIDER_ERROR",
    failureClassification: "INTEGRITY_CORRUPTION",
  },
  {
    name: "account permission",
    error: Object.assign(new Error("synthetic permission"), { status: 403 }),
    errorCode: "PERMISSION_OR_ACCOUNT",
    terminationReason: "PROVIDER_ERROR",
    failureClassification: "INTEGRITY_CORRUPTION",
  },
  {
    name: "invalid request",
    error: Object.assign(new Error("synthetic invalid request"), { status: 400 }),
    errorCode: "INVALID_REQUEST",
    terminationReason: "PROVIDER_ERROR",
    failureClassification: "INTEGRITY_CORRUPTION",
  },
  {
    name: "provider 5xx",
    error: Object.assign(new Error("synthetic outage"), { status: 503 }),
    errorCode: "PROVIDER_5XX",
    terminationReason: "PROVIDER_ERROR",
    failureClassification: "TRANSIENT_INFRASTRUCTURE",
  },
]) {
  test(`OpenAI adapter classifies ${fixture.name} failures`, async () => {
    const adapter = new OpenAIResponsesAdapter({
      responses: {
        async create() {
          throw fixture.error;
        },
      },
    });

    await assert.rejects(
      adapter.generate({
        model: "gpt-6.1-sol",
        systemInstructions: "Synthetic sandbox instructions.",
        input: [{ type: "message", role: "user", content: "Read Alpha." }],
        tools: [READ_FILE_TOOL_DEFINITION],
        toolChoice: "auto",
      }),
      (error) => {
        assert.ok(error instanceof ModelAdapterError);
        assert.equal(error.errorCode, fixture.errorCode);
        assert.equal(error.terminationReason, fixture.terminationReason);
        assert.equal(
          error.failureClassification,
          fixture.failureClassification,
        );
        return true;
      },
    );
  });
}

test("OpenAI adapter classifies response parsing failures as transient adapter failures", async () => {
  const adapter = new OpenAIResponsesAdapter({
    responses: {
      async create() {
        return { id: "resp-malformed", status: "completed", output: {} };
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
    }),
    (error) => {
      assert.ok(error instanceof ModelAdapterError);
      assert.equal(error.terminationReason, "ADAPTER_ERROR");
      assert.equal(error.failureClassification, "TRANSIENT_INFRASTRUCTURE");
      assert.equal(error.integrityFailureCode, null);
      assert.equal(error.errorCode, "RESPONSE_PARSE");
      return true;
    },
  );
});
