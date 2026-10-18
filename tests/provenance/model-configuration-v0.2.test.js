import assert from "node:assert/strict";
import test from "node:test";

import { MODEL_CONFIGURATION_SCHEMA_VERSION, createModelConfiguration, verifyModelConfigurationRecord } from "../../dist/provenance/model-configuration.js";

const value = (entry) => ({ state: "VALUE", value: entry });
const omitted = () => ({ state: "OMITTED", reasonCode: "INTENTIONALLY_OMITTED" });
const unavailable = () => ({ state: "UNAVAILABLE", reasonCode: "NOT_EXPOSED_BY_API" });
const na = () => ({ state: "NOT_APPLICABLE" });

export const v02Input = (overrides = {}) => ({
  identity: {
    provider: "openai", providerBackend: "OpenAI Responses API", apiSurface: "responses-v1",
    requestedModel: "gpt-6.1-sol", adapterName: "OpenAIResponsesAdapter",
    adapterVersion: "openai-responses-adapter-v0.3.0", sdkPackage: "openai", sdkVersion: "7.15.0",
    ...(overrides.identity ?? {}),
  },
  settings: {
    snapshotVersion: unavailable(), reasoning: value({ effort: "medium" }), thinkingMode: na(),
    temperature: omitted(), topP: omitted(), outputTokenLimit: value(32768), seed: omitted(),
    toolChoice: value("auto"), parallelToolCalls: value(false), providerStorage: value(false),
    background: na(), providerSession: value("NONE"), continuationStrategy: value("LOCAL_TRANSCRIPT_REPLAY"),
    providerAddressableContinuationId: omitted(), automaticSdkRetries: value(0), responseCapPerStep: value(4),
    streaming: value(false), endpoint: value("OPENAI_DEFAULT"), backendMode: value("RESPONSES"),
    apiVersion: na(), vertexBackend: na(),
    providerStateReplay: value("ENCRYPTED_REASONING_OUTPUT_ITEMS"),
    reasoningStateInclusion: value("reasoning.encrypted_content"),
    ...(overrides.settings ?? {}),
  },
  returnedModelPolicy: overrides.returnedModelPolicy ?? "EXACT_REQUESTED_IF_PRESENT",
});

test("model-configuration-v0.2 hashes exact provider and execution identity", () => {
  const record = createModelConfiguration(v02Input());
  assert.equal(MODEL_CONFIGURATION_SCHEMA_VERSION, "model-configuration-v0.2");
  assert.equal(record.identity.apiSurface, "responses-v1");
  assert.equal(record.settings.toolChoice.value, "auto");
  assert.match(record.modelConfigurationHash, /^[a-f0-9]{64}$/);
  assert.equal(record.modelConfigurationId, `model-configuration-v0.2:sha256:${record.modelConfigurationHash}`);
});

test("v0.2 is deterministic and behaviorally relevant changes alter identity", () => {
  const first = createModelConfiguration(v02Input());
  assert.equal(first.modelConfigurationId, createModelConfiguration(v02Input()).modelConfigurationId);
  assert.notEqual(first.modelConfigurationId, createModelConfiguration(v02Input({ settings: { toolChoice: value("required") } })).modelConfigurationId);
});

test("v0.2 represents omitted, unavailable, not-applicable, and unresolved settings", () => {
  const record = createModelConfiguration(v02Input({ settings: { seed: { state: "UNRESOLVED" } } }));
  assert.equal(record.settings.temperature.state, "OMITTED");
  assert.equal(record.settings.snapshotVersion.state, "UNAVAILABLE");
  assert.equal(record.settings.background.state, "NOT_APPLICABLE");
  assert.equal(record.settings.seed.state, "UNRESOLVED");
});

test("v0.2 records self-verify, detach, freeze, and reject runtime or secret fields", () => {
  const input = v02Input();
  const record = createModelConfiguration(input);
  input.identity.requestedModel = "changed";
  assert.equal(record.identity.requestedModel, "gpt-6.1-sol");
  assert.deepEqual(verifyModelConfigurationRecord(JSON.parse(JSON.stringify(record))), record);
  for (const extra of ["timestamp", "apiKey", "environment", "returnedModel", "rawProviderResponse"]) {
    assert.throws(() => verifyModelConfigurationRecord({ ...record, [extra]: "fake" }), /fields/i);
  }
});

test("v0.2 rejects missing or unknown settings and unknown returned-model policy", () => {
  const missing = v02Input(); delete missing.settings.seed;
  assert.throws(() => createModelConfiguration(missing), /fields/i);
  assert.throws(() => createModelConfiguration(v02Input({ settings: { apiKey: value("fake") } })), /fields/i);
  assert.throws(() => createModelConfiguration(v02Input({ returnedModelPolicy: "ALLOW_ANY" })), /returned model policy/i);
});

test("v0.2 rejects credential-shaped or environment-shaped nested setting data", () => {
  for (const reasoning of [
    value({ effort: "medium", apiKey: "fake" }),
    value({ effort: "medium", headers: { Authorization: "fake" } }),
    value({ effort: "medium", environment: { HOME: "fake" } }),
    value({ effort: "medium", credential: { token: "fake" } }),
  ]) assert.throws(() => createModelConfiguration(v02Input({ settings: { reasoning } })), /credential|secret|environment/i);
});
