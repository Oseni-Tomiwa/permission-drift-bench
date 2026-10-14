import assert from "node:assert/strict";
import test from "node:test";

import {
  APIConnectionError as OpenAIConnectionError,
  APIConnectionTimeoutError as OpenAITimeoutError,
  AuthenticationError as OpenAIAuthenticationError,
  BadRequestError as OpenAIBadRequestError,
  InternalServerError as OpenAIInternalServerError,
  PermissionDeniedError as OpenAIPermissionError,
  RateLimitError as OpenAIRateLimitError,
} from "openai";
import {
  APIConnectionError as AnthropicConnectionError,
  APIConnectionTimeoutError as AnthropicTimeoutError,
  AuthenticationError as AnthropicAuthenticationError,
  BadRequestError as AnthropicBadRequestError,
  InternalServerError as AnthropicInternalServerError,
  PermissionDeniedError as AnthropicPermissionError,
  RateLimitError as AnthropicRateLimitError,
} from "@anthropic-ai/sdk";
import { ApiError as GoogleApiError } from "@google/genai";

import {
  MODEL_ADAPTER_CONTRACT_VERSION,
  READ_FILE_TOOL_DEFINITION,
  classifyProviderError,
  createModelAdapterIdentity,
  normalizeToolCallAttempts,
} from "../../dist/adapters/model-adapter.js";

test("provider-neutral adapter contract has an explicit version", () => {
  assert.equal(MODEL_ADAPTER_CONTRACT_VERSION, "model-adapter-v0.3.0");
});

test("adapter identity is immutable and available without a provider call", () => {
  const identity = createModelAdapterIdentity({
    provider: "openai",
    providerBackend: "OpenAI Responses API",
    apiSurface: "responses-v1",
    sdkPackage: "openai",
    sdkVersion: "7.15.0",
    adapterName: "OpenAIResponsesAdapter",
    adapterVersion: "openai-responses-adapter-v0.3.0",
    requestedModel: "gpt-6.1-sol",
  });
  assert.equal(Object.isFrozen(identity), true);
  assert.throws(() => { identity.requestedModel = "changed"; }, TypeError);
});

const headers = new Headers();
const statusCases = [
  ["openai", new OpenAIRateLimitError(429, {}, "rate", headers), "RATE_LIMIT"],
  ["openai", new OpenAIAuthenticationError(401, {}, "auth", headers), "AUTHENTICATION"],
  ["openai", new OpenAIPermissionError(403, {}, "permission", headers), "PERMISSION_OR_ACCOUNT"],
  ["openai", new OpenAIBadRequestError(400, {}, "bad", headers), "INVALID_REQUEST"],
  ["openai", new OpenAIInternalServerError(500, {}, "server", headers), "PROVIDER_5XX"],
  ["anthropic", new AnthropicRateLimitError(429, {}, "rate", headers), "RATE_LIMIT"],
  ["anthropic", new AnthropicAuthenticationError(401, {}, "auth", headers), "AUTHENTICATION"],
  ["anthropic", new AnthropicPermissionError(403, {}, "permission", headers), "PERMISSION_OR_ACCOUNT"],
  ["anthropic", new AnthropicBadRequestError(400, {}, "bad", headers), "INVALID_REQUEST"],
  ["anthropic", new AnthropicInternalServerError(500, {}, "server", headers), "PROVIDER_5XX"],
  ["google", new GoogleApiError({ message: "rate", status: 429 }), "RATE_LIMIT"],
  ["google", new GoogleApiError({ message: "auth", status: 401 }), "AUTHENTICATION"],
  ["google", new GoogleApiError({ message: "permission", status: 403 }), "PERMISSION_OR_ACCOUNT"],
  ["google", new GoogleApiError({ message: "bad", status: 400 }), "INVALID_REQUEST"],
  ["google", new GoogleApiError({ message: "server", status: 503 }), "PROVIDER_5XX"],
];

for (const [provider, error, expected] of statusCases) {
  test(`${provider} SDK error maps to ${expected}`, () => {
    assert.equal(classifyProviderError(provider, error).errorCode, expected);
  });
}

test("SDK timeout and connection subclasses are recognized through nested causes", () => {
  assert.equal(classifyProviderError("openai", new OpenAITimeoutError({ message: "timeout" })).errorCode, "TIMEOUT");
  assert.equal(classifyProviderError("anthropic", new AnthropicTimeoutError({ message: "timeout" })).errorCode, "TIMEOUT");
  assert.equal(classifyProviderError("openai", new Error("wrapper", { cause: new OpenAIConnectionError({ message: "network" }) })).errorCode, "NETWORK");
  assert.equal(classifyProviderError("anthropic", new Error("wrapper", { cause: new AnthropicConnectionError({ message: "network" }) })).errorCode, "NETWORK");
  assert.equal(classifyProviderError("google", { cause: Object.assign(new Error("socket"), { code: "ECONNRESET" }) }).errorCode, "NETWORK");
});

test("provider-neutral read_file definition exposes only the exact path argument", () => {
  assert.deepEqual(READ_FILE_TOOL_DEFINITION, {
    type: "function",
    name: "read_file",
    description: "Read the contents of a file at the specified path.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path of the file to read.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    strict: true,
  });
});

test("read_file model-visible descriptions are functional and evaluation-neutral", () => {
  const text = [
    READ_FILE_TOOL_DEFINITION.description,
    READ_FILE_TOOL_DEFINITION.parameters.properties.path.description,
  ]
    .join(" ")
    .toLowerCase();

  assert.match(text, /read/);
  assert.match(text, /file/);
  assert.match(text, /path/);
  for (const prohibited of [
    "benchmark",
    "evaluation",
    "safety test",
    "permission drift",
    "being tested",
    "scoring",
    "authorized",
    "unauthorized",
  ]) {
    assert.equal(text.includes(prohibited), false, prohibited);
  }
});

test("normalizes valid string and object arguments without losing raw values", () => {
  const rawObject = { path: "project_beta/report.txt" };
  const calls = normalizeToolCallAttempts([
    {
      index: 1,
      providerCallId: "call-string",
      toolName: "read_file",
      rawArguments: '{"path":"project_alpha/report.txt"}',
      rawProviderCall: { fixture: "string" },
    },
    {
      index: 3,
      providerCallId: "call-object",
      toolName: "read_file",
      rawArguments: rawObject,
      rawProviderCall: { fixture: "object" },
    },
  ]);

  assert.deepEqual(calls[0], {
    index: 1,
    providerCallId: "call-string",
    toolName: "read_file",
    rawArguments: '{"path":"project_alpha/report.txt"}',
    normalizedArguments: '{"path":"project_alpha/report.txt"}',
    parsedArguments: { path: "project_alpha/report.txt" },
    argumentStatus: "VALID",
    duplicateOfIndex: null,
    rawProviderCall: { fixture: "string" },
  });
  assert.strictEqual(calls[1].rawArguments, rawObject);
  assert.equal(
    calls[1].normalizedArguments,
    '{"path":"project_beta/report.txt"}',
  );
  assert.deepEqual(calls[1].parsedArguments, rawObject);
  assert.equal(calls[1].argumentStatus, "VALID");
});

test("keeps malformed, invalid-shape, and missing arguments observable", () => {
  const calls = normalizeToolCallAttempts([
    {
      index: 0,
      providerCallId: null,
      toolName: null,
      rawArguments: '{"path":',
      rawProviderCall: { fixture: "malformed" },
    },
    {
      index: 1,
      providerCallId: "array-call",
      toolName: "read_file",
      rawArguments: ["not-an-object"],
      rawProviderCall: { fixture: "invalid-shape" },
    },
    {
      index: 2,
      providerCallId: "missing-call",
      toolName: "read_file",
      rawProviderCall: { fixture: "missing" },
    },
  ]);

  assert.equal(calls[0].providerCallId, null);
  assert.equal(calls[0].toolName, null);
  assert.equal(calls[0].argumentStatus, "MALFORMED_JSON");
  assert.equal(calls[0].normalizedArguments, null);
  assert.equal(calls[1].argumentStatus, "INVALID_SHAPE");
  assert.equal(calls[1].normalizedArguments, '["not-an-object"]');
  assert.equal(calls[2].argumentStatus, "MISSING");
  assert.equal(calls[2].rawArguments, undefined);
});

test("marks only repeated non-null provider call IDs as duplicates", () => {
  const calls = normalizeToolCallAttempts([
    {
      index: 0,
      providerCallId: "same-id",
      toolName: "read_file",
      rawArguments: { path: "same.txt" },
      rawProviderCall: {},
    },
    {
      index: 1,
      providerCallId: "same-id",
      toolName: "read_file",
      rawArguments: { path: "different.txt" },
      rawProviderCall: {},
    },
    {
      index: 2,
      providerCallId: "different-id",
      toolName: "read_file",
      rawArguments: { path: "same.txt" },
      rawProviderCall: {},
    },
    {
      index: 3,
      providerCallId: null,
      toolName: "read_file",
      rawArguments: { path: "same.txt" },
      rawProviderCall: {},
    },
    {
      index: 4,
      providerCallId: null,
      toolName: "read_file",
      rawArguments: { path: "same.txt" },
      rawProviderCall: {},
    },
  ]);

  assert.deepEqual(
    calls.map((call) => call.duplicateOfIndex),
    [null, 0, null, null, null],
  );
});
