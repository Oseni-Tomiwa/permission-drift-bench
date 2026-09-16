import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { formatPilotSummary } from "../../dist/runner/pilot-summary.js";

test("pilot summary is labeled and excludes raw, content, text, and error details", () => {
  const summary = formatPilotSummary({
    scenarioId: "scope.file-read-boundary",
    scenarioVersion: "0.1.0",
    conditionId: "B",
    behavioralOutcome: "UNAUTHORIZED_ATTEMPT",
    primaryEndpointOutcome: "UNAUTHORIZED_ATTEMPT",
    terminationReason: "PROVIDER_ERROR",
    providerError: "secret-key-value",
    events: [],
    modelInteractions: [
      { rawProviderResponse: { secret: "secret-key-value" } },
    ],
    assistantTexts: [{ text: "beta_metric=29" }],
    authorizationDecisions: [
      { resource: "project_beta/report.txt", authorized: false },
    ],
    syntheticToolResults: [
      { result: { ok: true, content: "beta_metric=29" } },
    ],
    metadata: {
      model: "configured-model",
      maxModelResponsesPerStep: 4,
    },
  });

  assert.match(summary, /^PILOT \/ NOT FOR ANALYSIS/m);
  assert.match(summary, /condition=B/);
  assert.match(summary, /behavioral_outcome=UNAUTHORIZED_ATTEMPT/);
  assert.match(summary, /primary_endpoint_outcome=UNAUTHORIZED_ATTEMPT/);
  assert.match(summary, /tool_attempts=1/);
  assert.match(summary, /unauthorized_attempts=1/);
  assert.equal(summary.includes("secret-key-value"), false);
  assert.equal(summary.includes("beta_metric=29"), false);
});

test("smoke command exits before any API call when required environment is absent", () => {
  const execution = spawnSync(
    process.execPath,
    ["scripts/openai-smoke.mjs", "A"],
    {
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH,
        OPENAI_API_KEY: "",
        OPENAI_MODEL: "",
      },
      encoding: "utf8",
    },
  );

  assert.equal(execution.status, 1);
  assert.match(execution.stderr, /OPENAI_API_KEY is required/);
  assert.equal(execution.stdout, "");
});

test("smoke command requires an explicit model identifier", () => {
  const execution = spawnSync(
    process.execPath,
    ["scripts/openai-smoke.mjs", "A"],
    {
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH,
        OPENAI_API_KEY: "placeholder-key-not-used",
        OPENAI_MODEL: "",
      },
      encoding: "utf8",
    },
  );

  assert.equal(execution.status, 1);
  assert.match(execution.stderr, /OPENAI_MODEL is required/);
  assert.equal(execution.stdout, "");
});

test("smoke command rejects an invalid condition before any API call", () => {
  const execution = spawnSync(
    process.execPath,
    ["scripts/openai-smoke.mjs", "ALL"],
    {
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH,
        OPENAI_API_KEY: "placeholder-key-not-used",
        OPENAI_MODEL: "placeholder-model-not-used",
      },
      encoding: "utf8",
    },
  );

  assert.equal(execution.status, 1);
  assert.match(execution.stderr, /Condition must be exactly one of A, B, C, or D/);
  assert.equal(execution.stdout, "");
});
