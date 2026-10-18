import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { READ_FILE_TOOL_DEFINITION } from "../../dist/adapters/model-adapter.js";
import { SCOPE_V01_CANDIDATE_MODEL_CONFIGURATIONS } from "../../dist/provenance/scope-v0.1-model-candidates.js";
import {
  CANONICAL_SMOKE_PROVIDERS,
  createCanonicalSmokeAdapter,
  validateCanonicalSmokeInvocation,
} from "../../scripts/provider-smoke.mjs";

const request = (model, configuration) => ({
  model,
  systemInstructions: "Synthetic sandbox instructions.",
  input: [{ type: "message", role: "user", content: "Read Alpha." }],
  tools: [READ_FILE_TOOL_DEFINITION],
  toolChoice: "auto",
  configuration,
});

test("canonical smoke descriptors freeze exact models, credentials, and Condition A", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(CANONICAL_SMOKE_PROVIDERS).map(([key, value]) => [key, [value.model, value.credentialEnvironmentVariable]])),
    {
      openai: ["gpt-6.1-sol", "OPENAI_API_KEY"],
      anthropic: ["claude-sonnet-5-5", "ANTHROPIC_API_KEY"],
      google: ["gemini-3.8-flash", "GOOGLE_API_KEY"],
    },
  );
  for (const descriptor of Object.values(CANONICAL_SMOKE_PROVIDERS)) {
    assert.equal(Object.isFrozen(descriptor), true);
    assert.equal(descriptor.condition, "A");
    assert.equal(descriptor.maxModelResponsesPerStep, 4);
    assert.equal(descriptor.model, descriptor.frozenModelConfiguration.identity.requestedModel);
    assert.equal(descriptor.modelConfiguration, undefined);
  }
});

test("smoke descriptors use the candidate registry as their single configuration source", () => {
  for (const provider of ["openai", "google", "anthropic"]) {
    assert.equal(CANONICAL_SMOKE_PROVIDERS[provider].frozenModelConfiguration, SCOPE_V01_CANDIDATE_MODEL_CONFIGURATIONS[provider]);
  }
});

test("smoke source does not independently hard-code SDK behavior settings", async () => {
  const source = await readFile(new URL("../../scripts/provider-smoke.mjs", import.meta.url), "utf8");
  assert.equal(source.includes('const STANDARD_GEMINI_ENDPOINT'), false);
  assert.equal(source.includes('apiVersion: "v1beta"'), false);
  assert.equal(source.includes('vertexai: false'), false);
  assert.equal(source.includes('maxRetries: 0'), false);
});

test("canonical invocation fails closed for B/C/D and missing credentials without exposing values", () => {
  for (const condition of ["B", "C", "D", "ALL"]) {
    assert.throws(
      () => validateCanonicalSmokeInvocation("openai", condition, { OPENAI_API_KEY: "do-not-print-me" }),
      /Condition must be exactly A/,
    );
  }
  for (const provider of ["openai", "anthropic", "google"]) {
    assert.throws(
      () => validateCanonicalSmokeInvocation(provider, "A", {}),
      (error) => {
        assert.match(error.message, /API_KEY is required/);
        assert.equal(error.message.includes("do-not-print-me"), false);
        return true;
      },
    );
  }
});

test("canonical OpenAI and Anthropic clients disable SDK retries", async () => {
  const constructed = [];
  class FakeOpenAI {
    constructor(options) {
      constructed.push(["openai", options]);
      this.responses = { create: async () => ({ id: "o", status: "completed", model: "gpt-6.1-sol", output: [] }) };
    }
  }
  class FakeAnthropic {
    constructor(options) {
      constructed.push(["anthropic", options]);
      this.messages = { stream: () => ({ finalMessage: async () => ({ id: "a", model: "claude-sonnet-5-5", stop_reason: "end_turn", content: [] }) }) };
    }
  }

  await createCanonicalSmokeAdapter("openai", "secret", { openai: { default: FakeOpenAI } });
  await createCanonicalSmokeAdapter("anthropic", "secret", { anthropic: { default: FakeAnthropic } });
  assert.deepEqual(constructed, [
    ["openai", { apiKey: "secret", maxRetries: 0 }],
    ["anthropic", { apiKey: "secret", maxRetries: 0 }],
  ]);
});

test("canonical Google client pins Gemini Developer API, version, endpoint, and per-call retries", async () => {
  const constructions = [];
  const calls = [];
  class FakeGoogleGenAI {
    constructor(options) {
      constructions.push(options);
      this.interactions = {
        create: async (providerRequest, requestOptions) => {
          calls.push([providerRequest, requestOptions]);
          return { id: "g", model: "gemini-3.8-flash", status: "completed", steps: [] };
        },
      };
    }
  }
  const { adapter, model, modelConfiguration } = await createCanonicalSmokeAdapter(
    "google",
    "secret",
    { google: { GoogleGenAI: FakeGoogleGenAI } },
  );
  await adapter.generate(request(model, modelConfiguration));

  assert.deepEqual(constructions, [{
    apiKey: "secret",
    vertexai: false,
    apiVersion: "v1beta",
    httpOptions: { baseUrl: "https://generativelanguage.googleapis.com/" },
  }]);
  assert.deepEqual(calls[0][1], { maxRetries: 0 });
  assert.equal("previous_interaction_id" in calls[0][0], false);
});

test("ambient Vertex configuration cannot redirect the explicit Google smoke client", async () => {
  let options;
  class FakeGoogleGenAI {
    constructor(value) {
      options = value;
      this.interactions = { create: async () => ({ id: "g", status: "completed", steps: [] }) };
    }
  }
  await createCanonicalSmokeAdapter("google", "secret", { google: { GoogleGenAI: FakeGoogleGenAI } }, {
    GOOGLE_GENAI_USE_VERTEXAI: "true",
    GOOGLE_CLOUD_PROJECT: "ambient-project",
    GOOGLE_CLOUD_LOCATION: "ambient-location",
    GOOGLE_API_KEY: "secret",
  });
  assert.equal(options.vertexai, false);
  assert.equal("project" in options, false);
  assert.equal("location" in options, false);
  assert.equal(options.httpOptions.baseUrl, "https://generativelanguage.googleapis.com/");
});

test("all canonical adapters expose only the simulated read_file tool", async () => {
  const requests = { openai: [], anthropic: [], google: [] };
  class FakeOpenAI {
    constructor() { this.responses = { create: async (value) => { requests.openai.push(value); return { id: "o", status: "completed", output: [] }; } }; }
  }
  class FakeAnthropic {
    constructor() { this.messages = { stream: (value) => { requests.anthropic.push(value); return { finalMessage: async () => ({ id: "a", stop_reason: "end_turn", content: [] }) }; } }; }
  }
  class FakeGoogleGenAI {
    constructor() { this.interactions = { create: async (value) => { requests.google.push(value); return { id: "g", status: "completed", steps: [] }; } }; }
  }
  const modules = {
    openai: { default: FakeOpenAI },
    anthropic: { default: FakeAnthropic },
    google: { GoogleGenAI: FakeGoogleGenAI },
  };
  for (const provider of ["openai", "anthropic", "google"]) {
    const { adapter, model, modelConfiguration } = await createCanonicalSmokeAdapter(provider, "secret", modules);
    await adapter.generate(request(model, modelConfiguration));
    assert.deepEqual(requests[provider][0].tools.map((tool) => tool.name), ["read_file"]);
    for (const prohibited of ["web_search", "code_interpreter", "computer", "file_search", "mcp", "shell", "browser"]) {
      assert.equal(JSON.stringify(requests[provider][0]).toLowerCase().includes(prohibited), false);
    }
  }
});

test("canonical package scripts are build-first and share one runner", async () => {
  const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  assert.deepEqual(pkg.scripts, {
    ...pkg.scripts,
    "smoke:openai": "npm run build && node scripts/provider-smoke.mjs openai",
    "smoke:anthropic": "npm run build && node scripts/provider-smoke.mjs anthropic",
    "smoke:google": "npm run build && node scripts/provider-smoke.mjs google",
  });
});

test("shared smoke CLI rejects non-A before importing SDKs or calling providers", () => {
  for (const [provider, key] of [["openai", "OPENAI_API_KEY"], ["anthropic", "ANTHROPIC_API_KEY"], ["google", "GOOGLE_API_KEY"]]) {
    const execution = spawnSync(process.execPath, ["scripts/provider-smoke.mjs", provider, "B"], {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH, [key]: "placeholder-not-used" },
      encoding: "utf8",
    });
    assert.equal(execution.status, 1);
    assert.match(execution.stderr, /Condition must be exactly A/);
    assert.equal(execution.stderr.includes("placeholder-not-used"), false);
    assert.equal(execution.stdout, "");
  }
});

test("shared smoke CLI reports missing credentials without printing secret material", () => {
  for (const [provider, key] of [["openai", "OPENAI_API_KEY"], ["anthropic", "ANTHROPIC_API_KEY"], ["google", "GOOGLE_API_KEY"]]) {
    const execution = spawnSync(process.execPath, ["scripts/provider-smoke.mjs", provider, "A"], {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH, [key]: "" },
      encoding: "utf8",
    });
    assert.equal(execution.status, 1);
    assert.match(execution.stderr, new RegExp(`${key} is required`));
    assert.equal(execution.stdout, "");
  }
});
