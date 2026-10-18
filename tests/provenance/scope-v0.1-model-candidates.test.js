import assert from "node:assert/strict";
import test from "node:test";
import { SCOPE_V01_CANDIDATE_MODEL_CONFIGURATIONS, SCOPE_V01_MODEL_ASYMMETRY_REGISTER, SCOPE_V01_MODEL_LIVE_VALIDATION, candidateModelConfiguration, verifyCandidateModelConfigurationSet } from "../../dist/provenance/scope-v0.1-model-candidates.js";
import { SCOPE_V01_CANDIDATE_FREEZE_DECISIONS } from "../../dist/provenance/scope-v0.1-candidate-freeze.js";
import { createModelConfiguration, verifyModelConfigurationRecord } from "../../dist/provenance/model-configuration.js";

const PRE_CORRECTION_IDS = Object.freeze({
  openai: "model-configuration-v0.2:sha256:75fcb2b1519e0d81d7729203f011e8a95f85f1f762bc301e37e58fcf3cbc338a",
  google: "model-configuration-v0.2:sha256:ac2644e52d180fac8e143c51465423e559bdc75f0d8ac74295697cd0bcd086f5",
  anthropic: "model-configuration-v0.2:sha256:eae7b81b309ba2c5dbd230c239cfe81bcf9b613d3dffab4488cff4165c206d1b",
});

const CORRECTED_IDS = Object.freeze({
  openai: "model-configuration-v0.2:sha256:cd7eb337f3bc69c9a32748adb1d55bbdb2fcd98bdcfc0e8ba0b4af4ceadbd558",
  google: PRE_CORRECTION_IDS.google,
  anthropic: "model-configuration-v0.2:sha256:8901f9128c70f55a9e7c96620fabb57b7db2a15967dd41532c100573e0657d9d",
});

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
  const openai = candidateModelConfiguration("openai");
  const anthropic = candidateModelConfiguration("anthropic");
  assert.equal(openai.settings.reasoningStateInclusion.value, "reasoning.encrypted_content");
  assert.deepEqual(openai.settings.background, { state: "OMITTED", reasonCode: "INTENTIONALLY_OMITTED" });
  assert.equal(anthropic.settings.thinkingMode.value, "adaptive");
  assert.equal(anthropic.settings.streaming.value, true);
  assert.deepEqual(anthropic.settings.snapshotVersion, { state: "VALUE", value: "claude-sonnet-5-5" });
  assert.equal(anthropic.identity.requestedModel, "claude-sonnet-5-5");
  assert.equal(candidateModelConfiguration("google").settings.endpoint.value, "https://generativelanguage.googleapis.com/");
  assert.equal(candidateModelConfiguration("google").settings.parallelToolCalls.state, "UNAVAILABLE");
  const dimensions = new Map(SCOPE_V01_MODEL_ASYMMETRY_REGISTER.map((entry) => [entry.dimension, entry.classification]));
  assert.equal(dimensions.get("reasoningControl"), "INTENTIONALLY_DIFFERENT");
  assert.equal(dimensions.get("parallelToolCalls"), "PROVIDER_UNAVAILABLE");
  assert.equal(dimensions.get("background"), "INTENTIONALLY_DIFFERENT");
  assert.equal(dimensions.get("modelSnapshotMutability"), "AMBIGUOUS_REQUIRES_REVIEW");
});

test("approved corrections change only the OpenAI and Anthropic content identities", () => {
  const openai = candidateModelConfiguration("openai");
  const google = candidateModelConfiguration("google");
  const anthropic = candidateModelConfiguration("anthropic");
  assert.notEqual(openai.modelConfigurationId, PRE_CORRECTION_IDS.openai);
  assert.equal(google.modelConfigurationId, PRE_CORRECTION_IDS.google);
  assert.notEqual(anthropic.modelConfigurationId, PRE_CORRECTION_IDS.anthropic);
  assert.equal(openai.modelConfigurationId, CORRECTED_IDS.openai);
  assert.equal(google.modelConfigurationId, CORRECTED_IDS.google);
  assert.equal(anthropic.modelConfigurationId, CORRECTED_IDS.anthropic);
  for (const record of [openai, google, anthropic]) {
    assert.equal(record.hashAlgorithm, "sha256");
    assert.equal(record.canonicalHashContractVersion, "canonical-json-v0.1");
    assert.deepEqual(verifyModelConfigurationRecord(structuredClone(record)), record);
  }
});

test("live validation is separate from model identity", () => {
  assert.deepEqual(SCOPE_V01_MODEL_LIVE_VALIDATION, { openai: "CONDITION_A_LIVE_PILOT_VALIDATED", google: "CONDITION_A_LIVE_PILOT_VALIDATED", anthropic: "PENDING_CREDENTIALS" });
  for (const record of Object.values(SCOPE_V01_CANDIDATE_MODEL_CONFIGURATIONS)) assert.equal("liveValidation" in record, false);
});

test("candidate cleanup does not resolve the roster", () => {
  assert.deepEqual(SCOPE_V01_CANDIDATE_FREEZE_DECISIONS.MODEL_ROSTER_CONFIGURATIONS, { state: "UNRESOLVED" });
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
