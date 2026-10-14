import assert from "node:assert/strict";
import test from "node:test";

import {
  ModelAdapterError,
  READ_FILE_TOOL_DEFINITION,
} from "../../dist/adapters/model-adapter.js";
import { AnthropicMessagesAdapter } from "../../dist/adapters/anthropic-messages-adapter.js";
import { GoogleInteractionsAdapter } from "../../dist/adapters/google-interactions-adapter.js";
import { OpenAIResponsesAdapter } from "../../dist/adapters/openai-responses-adapter.js";
import { runModelTrial } from "../../dist/runner/model-trial-runner.js";
import { fileReadBoundaryScenario } from "../../dist/scenarios/file-read-boundary.js";

const item = {
  text: (text) => ({ kind: "text", text }),
  call: (properties) => ({ kind: "call", ...properties }),
  state: () => ({ kind: "state" }),
  unknown: () => ({ kind: "unknown" }),
};

function openAIResponse(items, overrides = {}) {
  return {
    id: overrides.id ?? "openai-response",
    status: overrides.status ?? "completed",
    model: overrides.model ?? "openai-returned-model",
    output: items.map((entry, index) => {
      if (entry.kind === "text") {
        return {
          type: "message",
          id: `message-${index}`,
          content: [{ type: "output_text", text: entry.text }],
        };
      }
      if (entry.kind === "call") {
        return {
          type: "function_call",
          ...(Object.hasOwn(entry, "id") ? { call_id: entry.id } : {}),
          ...(Object.hasOwn(entry, "name") ? { name: entry.name } : {}),
          ...(Object.hasOwn(entry, "arguments")
            ? { arguments: entry.arguments }
            : {}),
        };
      }
      if (entry.kind === "state") {
        return { type: "reasoning", id: `reasoning-${index}`, summary: [] };
      }
      return { type: "future_output", value: "retain-me" };
    }),
    usage: overrides.usage ?? { input_tokens: 12, output_tokens: 4 },
  };
}

function anthropicResponse(items, overrides = {}) {
  const hasCall = items.some((entry) => entry.kind === "call");
  return {
    id: overrides.id ?? "anthropic-response",
    stop_reason: overrides.status ?? (hasCall ? "tool_use" : "end_turn"),
    model: overrides.model ?? "anthropic-returned-model",
    content: items.map((entry, index) => {
      if (entry.kind === "text") return { type: "text", text: entry.text };
      if (entry.kind === "call") {
        return {
          type: "tool_use",
          ...(Object.hasOwn(entry, "id") ? { id: entry.id } : {}),
          ...(Object.hasOwn(entry, "name") ? { name: entry.name } : {}),
          ...(Object.hasOwn(entry, "arguments")
            ? { input: entry.arguments }
            : {}),
        };
      }
      if (entry.kind === "state") {
        return { type: "thinking", thinking: "", signature: `sig-${index}` };
      }
      return { type: "future_block", value: "retain-me" };
    }),
    usage: overrides.usage ?? { input_tokens: 12, output_tokens: 4 },
  };
}

function googleResponse(items, overrides = {}) {
  const hasCall = items.some((entry) => entry.kind === "call");
  return {
    id: overrides.id ?? "google-response",
    status: overrides.status ?? (hasCall ? "requires_action" : "completed"),
    model: overrides.model ?? "google-returned-model",
    steps: items.map((entry, index) => {
      if (entry.kind === "text") {
        return {
          type: "model_output",
          content: [{ type: "text", text: entry.text }],
        };
      }
      if (entry.kind === "call") {
        return {
          type: "function_call",
          ...(Object.hasOwn(entry, "id") ? { id: entry.id } : {}),
          ...(Object.hasOwn(entry, "name") ? { name: entry.name } : {}),
          ...(Object.hasOwn(entry, "arguments")
            ? { arguments: entry.arguments }
            : {}),
        };
      }
      if (entry.kind === "state") {
        return { type: "thought", signature: `sig-${index}`, summary: [] };
      }
      return { type: "future_step", value: "retain-me" };
    }),
    usage: overrides.usage ?? { total_input_tokens: 12, total_output_tokens: 4 },
  };
}

function queueValue(queue) {
  if (queue.length === 0) throw new Error("fixture queue exhausted");
  const value = queue.shift();
  if (value instanceof Error) throw value;
  return value;
}

const providerCases = [
  {
    name: "openai",
    model: "gpt-6.1-sol",
    response: openAIResponse,
    configuration: {
      reasoning: { effort: "medium" },
      maxOutputTokens: 32768,
      parallelToolCalls: false,
    },
    adapter(queue, requests = []) {
      return new OpenAIResponsesAdapter({
        responses: {
          async create(request) {
            requests.push(request);
            return queueValue(queue);
          },
        },
      });
    },
  },
  {
    name: "anthropic",
    model: "claude-sonnet-5-5",
    response: anthropicResponse,
    configuration: {
      reasoning: { effort: "medium" },
      maxOutputTokens: 32768,
      parallelToolCalls: false,
    },
    adapter(queue, requests = []) {
      return new AnthropicMessagesAdapter({
        messages: {
          stream(request) {
            requests.push(request);
            return { finalMessage: async () => queueValue(queue) };
          },
        },
      });
    },
  },
  {
    name: "google",
    model: "gemini-3.8-flash",
    response: googleResponse,
    configuration: {
      reasoning: { effort: "medium" },
      maxOutputTokens: 32768,
    },
    adapter(queue, requests = []) {
      return new GoogleInteractionsAdapter({
        interactions: {
          async create(request) {
            requests.push(request);
            return queueValue(queue);
          },
        },
      });
    },
  },
];

function requestFor(provider, input = []) {
  return {
    model: provider.model,
    systemInstructions: "Exact canonical system instructions.",
    input:
      input.length === 0
        ? [{ type: "message", role: "user", content: "Exact authored step." }]
        : input,
    tools: [READ_FILE_TOOL_DEFINITION],
    toolChoice: "auto",
    configuration: provider.configuration,
  };
}

for (const provider of providerCases) {
  test(`${provider.name} conformance: preserves no-call text and ordered interleaving`, async () => {
    const response = provider.response([
      item.state(),
      item.text("first"),
      item.unknown(),
      item.text("second"),
    ]);
    const result = await provider.adapter([response]).generate(
      requestFor(provider),
    );

    assert.equal(result.assistantText, "firstsecond");
    assert.deepEqual(result.assistantTextSegments, ["first", "second"]);
    assert.equal(result.toolCalls.length, 0);
    assert.deepEqual(
      result.orderedOutput.map((entry) => entry.kind),
      [
        "PROVIDER_STATE",
        "ASSISTANT_TEXT",
        "UNKNOWN_PROVIDER_ITEM",
        "ASSISTANT_TEXT",
      ],
    );
    assert.strictEqual(result.rawResponse, response);
    assert.equal(result.requestedModel, provider.model);
    assert.match(result.returnedModel, /returned-model/);
    assert.deepEqual(result.usage, response.usage);
  });

  test(`${provider.name} conformance: preserves every call and parse status`, async () => {
    const sharedArguments = { path: "same.txt" };
    const response = provider.response([
      item.call({ id: "valid", name: "read_file", arguments: { path: "a" } }),
      item.call({ id: "malformed", name: "read_file", arguments: '{"path":' }),
      item.call({ id: "shape", name: "read_file", arguments: [] }),
      item.call({ id: "missing-arguments", name: "read_file" }),
      item.call({ name: "read_file", arguments: { path: "no-id" } }),
      item.call({ id: "no-name", arguments: { path: "no-name" } }),
      item.call({ id: "valid", name: "read_file", arguments: { path: "b" } }),
      item.call({ id: "equal-1", name: "read_file", arguments: sharedArguments }),
      item.call({ id: "equal-2", name: "read_file", arguments: sharedArguments }),
    ]);
    const result = await provider.adapter([response]).generate(
      requestFor(provider),
    );

    assert.equal(result.toolCalls.length, 9);
    assert.deepEqual(
      result.toolCalls.map((call) => call.argumentStatus),
      [
        "VALID",
        "MALFORMED_JSON",
        "INVALID_SHAPE",
        "MISSING",
        "VALID",
        "VALID",
        "VALID",
        "VALID",
        "VALID",
      ],
    );
    assert.equal(result.toolCalls[4].providerCallId, null);
    assert.equal(result.toolCalls[5].toolName, null);
    assert.equal(result.toolCalls[6].duplicateOfIndex, 0);
    assert.equal(result.toolCalls[8].duplicateOfIndex, null);
  });

  test(`${provider.name} conformance: retains provider argument parse failures`, async () => {
    const response = provider.response([
      item.call({
        id: "provider-parse-failure",
        name: "read_file",
        arguments: new Date("2026-01-01T00:00:00.000Z"),
      }),
    ]);
    const result = await provider.adapter([response]).generate(
      requestFor(provider),
    );

    assert.equal(result.toolCalls[0].argumentStatus, "PROVIDER_PARSE_FAILURE");
    assert.equal(result.toolCalls[0].normalizedArguments, null);
    assert.equal(result.toolCalls[0].parsedArguments, null);
  });

  test(`${provider.name} conformance: rejects an unreadable provider response`, async () => {
    await assert.rejects(
      provider.adapter([{ id: "unreadable", model: provider.model }]).generate(
        requestFor(provider),
      ),
      (error) => {
        assert.ok(error instanceof ModelAdapterError);
        assert.equal(error.errorCode, "RESPONSE_PARSE");
        return true;
      },
    );
  });

  test(`${provider.name} conformance: types malformed nested provider output as RESPONSE_PARSE`, async () => {
    const response = provider.response([item.text("placeholder")]);
    if (provider.name === "openai") response.output = [null];
    if (provider.name === "anthropic") response.content = [null];
    if (provider.name === "google") response.steps = [null];

    await assert.rejects(
      provider.adapter([response]).generate(requestFor(provider)),
      (error) => {
        assert.ok(error instanceof ModelAdapterError);
        assert.equal(error.errorCode, "RESPONSE_PARSE");
        return true;
      },
    );
  });

  test(`${provider.name} conformance: does not invent a missing returned model identifier`, async () => {
    const response = provider.response([item.text("done")]);
    delete response.model;
    const result = await provider.adapter([response]).generate(
      requestFor(provider),
    );

    assert.equal(result.requestedModel, provider.model);
    assert.equal(result.returnedModel, null);
  });

  test(`${provider.name} conformance: rejects foreign continuation state before provider use`, async () => {
    const requests = [];
    const foreignProvider = provider.name === "openai" ? "google" : "openai";
    await assert.rejects(
      provider.adapter([], requests).generate(
        requestFor(provider, [
          { type: "provider_state", provider: foreignProvider, value: {} },
        ]),
      ),
      (error) => {
        assert.ok(error instanceof ModelAdapterError);
        assert.equal(error.errorCode, "FOREIGN_CONTINUATION_STATE");
        return true;
      },
    );
    assert.equal(requests.length, 0);
  });

  test(`${provider.name} conformance: rejects a non-read_file tool allowlist before provider use`, async () => {
    const requests = [];
    await assert.rejects(
      provider.adapter([], requests).generate({
        ...requestFor(provider),
        tools: [
          {
            ...READ_FILE_TOOL_DEFINITION,
            name: "other_tool",
          },
        ],
      }),
      (error) => {
        assert.ok(error instanceof ModelAdapterError);
        assert.equal(error.errorCode, "UNSUPPORTED_CONFIGURATION");
        return true;
      },
    );
    assert.equal(requests.length, 0);
  });

  for (const errorFixture of [
    [Object.assign(new Error("timeout"), { name: "TimeoutError" }), "TIMEOUT"],
    [Object.assign(new Error("rate"), { status: 429 }), "RATE_LIMIT"],
    [Object.assign(new Error("bad request"), { status: 400 }), "INVALID_REQUEST"],
    [Object.assign(new Error("server"), { status: 503 }), "PROVIDER_5XX"],
    [Object.assign(new Error("network"), { code: "ECONNRESET" }), "NETWORK"],
  ]) {
    test(`${provider.name} conformance: classifies ${errorFixture[1]}`, async () => {
      await assert.rejects(
        provider.adapter([errorFixture[0]]).generate(requestFor(provider)),
        (error) => {
          assert.ok(error instanceof ModelAdapterError);
          assert.equal(error.errorCode, errorFixture[1]);
          return true;
        },
      );
    });
  }

  test(`${provider.name} conformance: keeps a valid non-completed response observable`, async () => {
    const rawStatus =
      provider.name === "anthropic" ? "max_tokens" : "incomplete";
    const response = provider.response([item.text("partial")], {
      status: rawStatus,
    });
    const result = await provider.adapter([response]).generate(
      requestFor(provider),
    );
    assert.equal(result.status, rawStatus);
    assert.equal(result.responseStatus, "INCOMPLETE");
    assert.equal(result.assistantText, "partial");
  });

  test(`${provider.name} conformance: rebuilds synthetic continuation from the local ledger`, async () => {
    const requests = [];
    const adapter = provider.adapter(
      [
        provider.response([
          item.state(),
          item.call({
            id: `${provider.name}-prior-call`,
            name: "read_file",
            arguments: { path: "project_alpha/report.txt" },
          }),
        ]),
        provider.response([item.text("continued")]),
      ],
      requests,
    );
    const initialRequest = requestFor(provider);
    const first = await adapter.generate(initialRequest);
    await adapter.generate({
      ...initialRequest,
      input: [
        ...initialRequest.input,
        ...first.continuationItems,
        {
          type: "tool_result",
          callId: `${provider.name}-prior-call`,
          toolName: "read_file",
          output: '{"ok":true,"content":"alpha_metric=11"}',
        },
      ],
    });

    assert.equal(requests.length, 2);
    const serialized = JSON.stringify(requests[1]);
    assert.match(serialized, /Exact authored step/);
    assert.match(serialized, new RegExp(`${provider.name}-prior-call`));
    assert.match(serialized, /alpha_metric=11/);
    assert.match(serialized, /sig-0|reasoning-0/);
    assert.equal("previous_response_id" in requests[1], false);
    assert.equal("previous_interaction_id" in requests[1], false);
  });

  test(`${provider.name} conformance: later provider error does not erase a Beta attempt`, async () => {
    const adapter = provider.adapter([
      provider.response([item.text("step one complete")]),
      provider.response([
        item.call({
          id: `${provider.name}-beta-call`,
          name: "read_file",
          arguments: { path: "project_beta/report.txt" },
        }),
      ]),
      Object.assign(new Error("later outage"), { status: 503 }),
    ]);
    const result = await runModelTrial({
      scenario: fileReadBoundaryScenario,
      conditionId: "B",
      scheduledTrialId: `${provider.name}-scheduled`,
      trialAttemptId: `${provider.name}-attempt-1`,
      attemptNumber: 1,
      replacementForAttemptId: null,
      adapter,
      model: provider.model,
      modelConfiguration: provider.configuration,
    });

    assert.equal(result.primaryEndpointOutcome, "UNAUTHORIZED_ATTEMPT");
    assert.equal(result.terminationReason, "PROVIDER_ERROR");
    assert.equal(
      result.events.some(
        (event) =>
          event.type === "TOOL_ATTEMPT_RESULT" &&
          event.normalizedResource === "project_beta/report.txt" &&
          event.authorizationDecision === false,
      ),
      true,
    );
  });
}

test("provider requests preserve canonical prompt semantics and expose no credential fields", async () => {
  for (const provider of providerCases) {
    const requests = [];
    await provider.adapter(
      [provider.response([item.text("done")])],
      requests,
    ).generate(requestFor(provider));
    const serialized = JSON.stringify(requests[0]);
    assert.match(serialized, /Exact canonical system instructions/);
    assert.match(serialized, /Exact authored step/);
    assert.match(serialized, /read_file/);
    assert.match(serialized, /Read the contents of a file at the specified path/);
    assert.doesNotMatch(
      serialized,
      /api[_-]?key|authorization|bearer|environment|credential/i,
    );
  }
});
