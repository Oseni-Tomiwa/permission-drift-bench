import assert from "node:assert/strict";
import test from "node:test";

import {
  ModelAdapterError,
  READ_FILE_TOOL_DEFINITION,
} from "../../dist/adapters/model-adapter.js";
import { GoogleInteractionsAdapter } from "../../dist/adapters/google-interactions-adapter.js";

const interactionFixture = () => ({
  id: "interaction-test",
  object: "interaction",
  model: "gemini-3.8-flash-actual",
  status: "requires_action",
  created: "2026-10-14T10:00:00Z",
  updated: "2026-10-14T10:00:01Z",
  steps: [
    { type: "thought", signature: "thought-signature", summary: [] },
    {
      type: "function_call",
      id: "call-alpha",
      name: "read_file",
      arguments: { path: "project_alpha/report.txt" },
    },
    {
      type: "model_output",
      content: [{ type: "text", text: "I will compare the reports." }],
    },
    {
      type: "function_call",
      id: "call-beta",
      name: "read_file",
      arguments: { path: "project_beta/report.txt" },
    },
    { type: "future_step", value: "retain-me" },
  ],
  usage: {
    total_input_tokens: 20,
    total_output_tokens: 10,
    total_thought_tokens: 4,
  },
});

test("Google adapter maps the frozen stateless Interactions configuration", async () => {
  const requests = [];
  const response = interactionFixture();
  const priorThought = {
    type: "thought",
    signature: "prior-thought-signature",
    summary: [],
  };
  const priorCall = {
    type: "function_call",
    id: "prior-call",
    name: "read_file",
    arguments: { path: "project_alpha/report.txt" },
  };
  const adapter = new GoogleInteractionsAdapter({
    interactions: {
      async create(request) {
        requests.push(request);
        return response;
      },
    },
  });
  assert.deepEqual(adapter.getIdentity("gemini-3.8-flash"), {
    provider: "google",
    providerBackend: "Gemini Developer API",
    apiSurface: "interactions-v1beta",
    sdkPackage: "@google/genai",
    sdkVersion: "2.29.1",
    adapterName: "GoogleInteractionsAdapter",
    adapterVersion: "google-interactions-adapter-v0.2.0",
    requestedModel: "gemini-3.8-flash",
  });

  const result = await adapter.generate({
    model: "gemini-3.8-flash",
    systemInstructions: "Synthetic sandbox instructions.",
    input: [
      { type: "message", role: "user", content: "Read Alpha." },
      { type: "provider_state", provider: "google", value: priorThought },
      { type: "provider_state", provider: "google", value: priorCall },
      {
        type: "tool_result",
        callId: "prior-call",
        toolName: "read_file",
        output: '{"ok":true,"content":"alpha_metric=11"}',
      },
    ],
    tools: [READ_FILE_TOOL_DEFINITION],
    toolChoice: "auto",
    configuration: {
      reasoning: { effort: "medium" },
      maxOutputTokens: 32768,
    },
  });

  assert.deepEqual(requests, [
    {
      model: "gemini-3.8-flash",
      system_instruction: "Synthetic sandbox instructions.",
      input: [
        {
          type: "user_input",
          content: [{ type: "text", text: "Read Alpha." }],
        },
        priorThought,
        priorCall,
        {
          type: "function_result",
          call_id: "prior-call",
          name: "read_file",
          result: [
            {
              type: "text",
              text: '{"ok":true,"content":"alpha_metric=11"}',
            },
          ],
        },
      ],
      tools: [
        {
          type: "function",
          name: "read_file",
          description: READ_FILE_TOOL_DEFINITION.description,
          parameters: READ_FILE_TOOL_DEFINITION.parameters,
        },
      ],
      generation_config: {
        thinking_level: "medium",
        max_output_tokens: 32768,
        tool_choice: "auto",
      },
      store: false,
      background: false,
    },
  ]);
  assert.equal("seed" in requests[0].generation_config, false);
  assert.equal("previous_interaction_id" in requests[0], false);
  assert.equal("parallel_tool_calls" in requests[0], false);
  assert.strictEqual(result.rawResponse, response);
  assert.equal(result.assistantText, "I will compare the reports.");
  assert.deepEqual(result.assistantTextSegments, [
    "I will compare the reports.",
  ]);
  assert.deepEqual(
    result.orderedOutput.map((item) => item.kind),
    [
      "PROVIDER_STATE",
      "TOOL_CALL",
      "ASSISTANT_TEXT",
      "TOOL_CALL",
      "UNKNOWN_PROVIDER_ITEM",
    ],
  );
  assert.deepEqual(
    result.toolCalls.map((call) => [
      call.providerCallId,
      call.index,
      call.argumentStatus,
    ]),
    [
      ["call-alpha", 1, "VALID"],
      ["call-beta", 3, "VALID"],
    ],
  );
  assert.deepEqual(
    result.continuationItems.map((item) => item.value),
    response.steps,
  );
  assert.equal(result.responseId, "interaction-test");
  assert.equal(result.status, "requires_action");
  assert.equal(result.responseStatus, "REQUIRES_ACTION");
  assert.equal(result.requestedModel, "gemini-3.8-flash");
  assert.equal(result.returnedModel, "gemini-3.8-flash-actual");
  assert.deepEqual(result.usage, response.usage);
  assert.equal(result.metadata.apiSurface, "interactions-v1beta");
  assert.equal(
    result.metadata.adapterVersion,
    "google-interactions-adapter-v0.2.0",
  );
  assert.equal(result.metadata.sdkPackage, "@google/genai");
  assert.equal(result.metadata.sdkVersion, "2.29.1");
  assert.equal(result.metadata.previousInteractionId, "OMITTED");
  assert.equal(result.metadata.seed, "DELIBERATELY_OMITTED");
  assert.equal(result.metadata.parallelToolCallControl, "UNAVAILABLE");
  assert.equal(result.metadata.builtInTools, false);
});

test("Google adapter rejects foreign continuation state before requesting", async () => {
  let called = false;
  const adapter = new GoogleInteractionsAdapter({
    interactions: {
      async create() {
        called = true;
        throw new Error("should not request");
      },
    },
  });

  await assert.rejects(
    adapter.generate({
      model: "gemini-3.8-flash",
      systemInstructions: "Synthetic sandbox instructions.",
      input: [{ type: "provider_state", provider: "anthropic", value: {} }],
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

test("Google adapter rejects unavailable parallel control before requesting", async () => {
  let called = false;
  const adapter = new GoogleInteractionsAdapter({
    interactions: {
      async create() {
        called = true;
        throw new Error("should not request");
      },
    },
  });

  await assert.rejects(
    adapter.generate({
      model: "gemini-3.8-flash",
      systemInstructions: "Synthetic sandbox instructions.",
      input: [{ type: "message", role: "user", content: "Read Alpha." }],
      tools: [READ_FILE_TOOL_DEFINITION],
      toolChoice: "auto",
      configuration: { parallelToolCalls: false },
    }),
    (error) => {
      assert.ok(error instanceof ModelAdapterError);
      assert.equal(error.errorCode, "UNSUPPORTED_CONFIGURATION");
      assert.equal(error.failureClassification, "INTEGRITY_CORRUPTION");
      return true;
    },
  );
  assert.equal(called, false);
});
