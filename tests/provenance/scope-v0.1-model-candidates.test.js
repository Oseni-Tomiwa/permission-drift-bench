import assert from "node:assert/strict";
import test from "node:test";
import { SCOPE_V01_CANDIDATE_MODEL_CONFIGURATIONS, SCOPE_V01_MODEL_ASYMMETRY_REGISTER, SCOPE_V01_MODEL_LIVE_VALIDATION, candidateModelConfiguration, verifyCandidateModelConfigurationSet } from "../../dist/provenance/scope-v0.1-model-candidates.js";
import { createModelConfiguration, verifyModelConfigurationRecord } from "../../dist/provenance/model-configuration.js";

test("scope-v0.1 exposes three exact immutable candidate configurations", () => {
  assert.deepEqual(Object.keys(SCOPE_V01_CANDIDATE_MODEL_CONFIGURATIONS), ["openai", "google", "anthropic"]);
  const expected = {
    openai: ["gpt-6.1-sol", "OpenAI Responses API", "responses-v1", "openai-responses-adapter-v0.3.0", "openai", "7.15.0"],
    google: ["gemini-3.8-flash", "Gemini Developer API", "interactions-v1beta", "google-interactions-adapter-v0.2.0", "@google/genai", "2.29.1"],
    anthropic: ["claude-sonnet-5-5", "Anthropic Messages API", "messages-v1", "anthropic-messages-adapter-v0.2.0", "@anthropic-ai/sdk", "0.133.0"],
  };
  for (const [provider, record] of Object.entries(SCOPE_V01_CANDIDATE_MODEL_CONFIGURATIONS)) {
    assert.deepEqual([record.identity.requestedModel, record.identity.providerBackend, record.identity.apiSurface, record.identity.adapterVersion, record.identity.sdkPackage, record.identity.sdkVersion], expected[provider]);
    assert.deepEqual(verifyModelConfigurationRecord(record), record);
  }
});

test("provider-specific settings and asymmetries are explicit", () => {
  assert.equal(candidateModelConfiguration("openai").settings.reasoningStateInclusion.value, "reasoning.encrypted_content");
  assert.equal(candidateModelConfiguration("anthropic").settings.thinkingMode.value, "adaptive");
  assert.equal(candidateModelConfiguration("anthropic").settings.streaming.value, true);
  assert.equal(candidateModelConfiguration("google").settings.endpoint.value, "https://generativelanguage.googleapis.com/");
  assert.equal(candidateModelConfiguration("google").settings.parallelToolCalls.state, "UNAVAILABLE");
  const dimensions = new Map(SCOPE_V01_MODEL_ASYMMETRY_REGISTER.map((entry) => [entry.dimension, entry.classification]));
  assert.equal(dimensions.get("reasoningControl"), "INTENTIONALLY_DIFFERENT");
  assert.equal(dimensions.get("parallelToolCalls"), "PROVIDER_UNAVAILABLE");
  assert.equal(dimensions.get("modelSnapshotMutability"), "AMBIGUOUS_REQUIRES_REVIEW");
});

test("live validation is separate from model identity", () => {
  assert.deepEqual(SCOPE_V01_MODEL_LIVE_VALIDATION, { openai: "CONDITION_A_LIVE_PILOT_VALIDATED", google: "CONDITION_A_LIVE_PILOT_VALIDATED", anthropic: "PENDING_CREDENTIALS" });
  for (const record of Object.values(SCOPE_V01_CANDIDATE_MODEL_CONFIGURATIONS)) assert.equal("liveValidation" in record, false);
});

test("candidate lookup and duplicate identities fail closed", () => {
  assert.throws(() => candidateModelConfiguration("unknown"), /Unknown/);
  const ids = Object.values(SCOPE_V01_CANDIDATE_MODEL_CONFIGURATIONS).map((record) => record.modelConfigurationId);
  assert.equal(new Set(ids).size, ids.length);
  const openai = candidateModelConfiguration("openai");
  assert.throws(() => verifyCandidateModelConfigurationSet([openai, openai]), /duplicate/i);
  const google = candidateModelConfiguration("google");
  const conflictingProvider = createModelConfiguration({
    identity: { ...google.identity, provider: "openai" },
    settings: google.settings,
    returnedModelPolicy: google.returnedModelPolicy,
  });
  assert.throws(() => verifyCandidateModelConfigurationSet([openai, conflictingProvider]), /conflicting/i);
});
