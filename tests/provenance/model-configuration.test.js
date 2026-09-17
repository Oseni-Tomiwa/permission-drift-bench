import assert from "node:assert/strict";
import test from "node:test";

import {
  MODEL_CONFIGURATION_SCHEMA_VERSION,
  createModelConfiguration,
  verifyModelConfigurationRecord,
} from "../../dist/provenance/model-configuration.js";
import {
  CANONICAL_HASH_CONTRACT_VERSION,
} from "../../dist/provenance/canonical-json.js";

const resolvedInput = (overrides = {}) => ({
  provider: "openai",
  modelIdentifier: "model-snapshot-test",
  settings: {
    snapshotVersion: {
      state: "UNAVAILABLE",
      reasonCode: "NOT_EXPOSED_BY_API",
    },
    reasoning: { state: "VALUE", value: "medium" },
    temperature: { state: "UNAVAILABLE", reasonCode: "UNSUPPORTED_BY_PROVIDER" },
    topP: { state: "UNAVAILABLE", reasonCode: "UNSUPPORTED_BY_PROVIDER" },
    outputTokenLimit: { state: "VALUE", value: 800 },
    seed: { state: "UNAVAILABLE", reasonCode: "UNSUPPORTED_BY_PROVIDER" },
    parallelToolCalls: { state: "VALUE", value: false },
    providerStorage: { state: "VALUE", value: false },
    providerSession: { state: "VALUE", value: "NONE" },
    responseCapPerStep: { state: "VALUE", value: 4 },
    ...overrides,
  },
});

test("model configuration preserves explicit unavailable states", () => {
  const configuration = createModelConfiguration(resolvedInput());

  assert.equal(
    configuration.schemaVersion,
    MODEL_CONFIGURATION_SCHEMA_VERSION,
  );
  assert.equal(configuration.hashAlgorithm, "sha256");
  assert.equal(
    configuration.canonicalHashContractVersion,
    CANONICAL_HASH_CONTRACT_VERSION,
  );
  assert.deepEqual(configuration.settings.snapshotVersion, {
    state: "UNAVAILABLE",
    reasonCode: "NOT_EXPOSED_BY_API",
  });
  assert.match(configuration.modelConfigurationHash, /^[a-f0-9]{64}$/);
  assert.equal(
    configuration.modelConfigurationId,
    `${MODEL_CONFIGURATION_SCHEMA_VERSION}:sha256:${configuration.modelConfigurationHash}`,
  );
});

test("equivalent model configurations have deterministic IDs and hashes", () => {
  const first = createModelConfiguration(resolvedInput());
  const reordered = createModelConfiguration({
    settings: resolvedInput().settings,
    modelIdentifier: "model-snapshot-test",
    provider: "openai",
  });

  assert.equal(first.modelConfigurationHash, reordered.modelConfigurationHash);
  assert.equal(first.modelConfigurationId, reordered.modelConfigurationId);
});

test("model configuration hash changes when a setting changes", () => {
  const first = createModelConfiguration(resolvedInput());
  const changed = createModelConfiguration(
    resolvedInput({ responseCapPerStep: { state: "VALUE", value: 5 } }),
  );

  assert.notEqual(first.modelConfigurationHash, changed.modelConfigurationHash);
});

test("model configuration preserves unresolved settings for readiness validation", () => {
  const configuration = createModelConfiguration(
    resolvedInput({ seed: { state: "UNRESOLVED" } }),
  );

  assert.deepEqual(configuration.settings.seed, { state: "UNRESOLVED" });
});

test("model configuration records are deeply immutable and detached from input", () => {
  const input = resolvedInput();
  const configuration = createModelConfiguration(input);

  input.settings.responseCapPerStep.value = 99;
  assert.equal(configuration.settings.responseCapPerStep.value, 4);
  assert.equal(Object.isFrozen(configuration), true);
  assert.equal(Object.isFrozen(configuration.settings), true);
  assert.equal(Object.isFrozen(configuration.settings.responseCapPerStep), true);
  assert.throws(() => {
    configuration.settings.responseCapPerStep.value = 99;
  }, TypeError);
});

test("model configuration rejects omitted provider settings", () => {
  const input = resolvedInput();
  delete input.settings.seed;

  assert.throws(() => createModelConfiguration(input), TypeError);
});

test("plain deserialized model configurations verify and become immutable", () => {
  const original = createModelConfiguration(resolvedInput());
  const verified = verifyModelConfigurationRecord(
    JSON.parse(JSON.stringify(original)),
  );

  assert.deepEqual(verified, original);
  assert.equal(Object.isFrozen(verified), true);
});

test("forged model configuration hashes and IDs fail verification", () => {
  const original = createModelConfiguration(resolvedInput());

  assert.throws(
    () => verifyModelConfigurationRecord({
      ...original,
      modelConfigurationHash: "f".repeat(64),
    }),
    /hash/i,
  );
  assert.throws(
    () => verifyModelConfigurationRecord({
      ...original,
      modelConfigurationId: `${MODEL_CONFIGURATION_SCHEMA_VERSION}:sha256:${"f".repeat(64)}`,
    }),
    /ID/i,
  );
});

test("unknown hash contracts, wrong algorithms, and unknown fields fail closed", () => {
  const original = createModelConfiguration(resolvedInput());

  for (const forged of [
    { ...original, canonicalHashContractVersion: "canonical-json-v999" },
    { ...original, hashAlgorithm: "sha512" },
    { ...original, providerMetadata: "not-allowlisted" },
  ]) {
    assert.throws(() => verifyModelConfigurationRecord(forged));
  }
});
