import assert from "node:assert/strict";
import test from "node:test";
import { bindModelConfiguration, verifyReturnedModelBinding } from "../../dist/provenance/model-configuration-binding.js";
import { candidateModelConfiguration } from "../../dist/provenance/scope-v0.1-model-candidates.js";
import { createModelConfiguration } from "../../dist/provenance/model-configuration.js";

const identity = (record, overrides = {}) => ({ ...record.identity, ...overrides });

test("binding verifies exact identity and derives adapter request configuration", () => {
  const record = candidateModelConfiguration("openai");
  const binding = bindModelConfiguration(record, identity(record));
  assert.deepEqual(binding.requestConfiguration, { reasoning: { effort: "medium" }, maxOutputTokens: 32768, parallelToolCalls: false });
  assert.equal(binding.model, "gpt-6.1-sol");
  assert.equal(binding.toolChoice, "auto");
  assert.equal(binding.responseCapPerStep, 4);
  assert.deepEqual(binding.sdkClientConfiguration, { maxRetries: 0 });
  assert.equal("background" in binding.requestConfiguration, false);
});

test("binding fails closed for model, backend, API, adapter, or SDK mismatch", () => {
  const record = candidateModelConfiguration("openai");
  for (const overrides of [{ requestedModel: "other" }, { providerBackend: "other" }, { apiSurface: "other" }, { adapterVersion: "other" }, { sdkVersion: "other" }]) {
    assert.throws(() => bindModelConfiguration(record, identity(record, overrides)), (error) => error.errorCode === "UNSUPPORTED_CONFIGURATION" && error.failureClassification === "INTEGRITY_CORRUPTION");
  }
});

test("returned model exact policy rejects conflicts but permits unavailable metadata", () => {
  const record = candidateModelConfiguration("openai");
  assert.doesNotThrow(() => verifyReturnedModelBinding(record, null));
  assert.doesNotThrow(() => verifyReturnedModelBinding(record, "gpt-6.1-sol"));
  assert.throws(() => verifyReturnedModelBinding(record, "different-model"), (error) => error.errorCode === "UNSUPPORTED_CONFIGURATION" && error.integrityFailureCode === "WRONG_MODEL_CONFIGURATION");
});

test("Anthropic pinned requested identity retains exact returned-model enforcement", () => {
  const record = candidateModelConfiguration("anthropic");
  assert.equal(record.identity.requestedModel, "claude-sonnet-5-5");
  assert.doesNotThrow(() => verifyReturnedModelBinding(record, "claude-sonnet-5-5"));
  assert.throws(() => verifyReturnedModelBinding(record, "different-model"), (error) => error.errorCode === "UNSUPPORTED_CONFIGURATION" && error.integrityFailureCode === "WRONG_MODEL_CONFIGURATION");
});

test("observe-separately policy does not infer provider alias equivalence", () => {
  const record = candidateModelConfiguration("google");
  assert.equal(record.returnedModelPolicy, "OBSERVE_SEPARATELY");
  assert.deepEqual(bindModelConfiguration(record, identity(record)).sdkClientConfiguration, {
    maxRetries: 0,
    vertexai: false,
    apiVersion: "v1beta",
    baseUrl: "https://generativelanguage.googleapis.com/",
  });
  assert.doesNotThrow(() => verifyReturnedModelBinding(record, "provider-resolved-version"));
});

test("binding rejects unresolved behavioral settings before provider use", () => {
  const record = candidateModelConfiguration("openai");
  const unresolved = createModelConfiguration({
    identity: record.identity,
    settings: { ...record.settings, temperature: { state: "UNRESOLVED" } },
    returnedModelPolicy: record.returnedModelPolicy,
  });
  assert.throws(() => bindModelConfiguration(unresolved, identity(record)), (error) => error.failureClassification === "INTEGRITY_CORRUPTION");
});
