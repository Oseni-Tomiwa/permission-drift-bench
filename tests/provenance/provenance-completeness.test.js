import assert from "node:assert/strict";
import test from "node:test";

import {
  PROVENANCE_COMPLETENESS_SCHEMA_VERSION,
  validateProvenanceCompleteness,
} from "../../dist/provenance/provenance-completeness.js";

const expected = {
  runSpecificationId: `run-specification-v0.1:sha256:${"a".repeat(64)}`,
  runSpecificationHash: "a".repeat(64),
  codeRevision: "0123456789abcdef0123456789abcdef01234567",
  scheduledTrialId: "scheduled-B-001",
  condition: "B",
  promptId: "prompt-B",
  promptHash: "b".repeat(64),
  modelConfigurationId: "model-config-B",
  optionalProviderFields: ["modelSnapshot"],
  optionalUnavailableReasonCodes: [
    "UNSUPPORTED_BY_PROVIDER",
    "NOT_EXPOSED_BY_API",
    "PROVIDER_CONTROLLED",
  ],
};

const attempt = (overrides = {}) => ({
  trialAttemptId: "attempt-B-1",
  scheduledTrialId: expected.scheduledTrialId,
  runSpecificationId: expected.runSpecificationId,
  runSpecificationHash: expected.runSpecificationHash,
  attemptNumber: 1,
  replacementForAttemptId: null,
  ...overrides,
});

const observed = (overrides = {}) => ({
  runSpecificationId: { state: "PRESENT", value: expected.runSpecificationId },
  runSpecificationHash: { state: "PRESENT", value: expected.runSpecificationHash },
  codeRevision: { state: "PRESENT", value: expected.codeRevision },
  scheduledTrialId: { state: "PRESENT", value: expected.scheduledTrialId },
  condition: { state: "PRESENT", value: expected.condition },
  promptId: { state: "PRESENT", value: expected.promptId },
  promptHash: { state: "PRESENT", value: expected.promptHash },
  modelConfigurationId: { state: "PRESENT", value: expected.modelConfigurationId },
  attemptChain: {
    currentTrialAttemptId: "attempt-B-1",
    attempts: [attempt()],
  },
  optionalProviderMetadata: [
    { field: "modelSnapshot", state: "PRESENT", value: "snapshot-test" },
  ],
  ...overrides,
});

test("exact provenance match is complete", () => {
  const result = validateProvenanceCompleteness(expected, observed());
  assert.equal(result.schemaVersion, PROVENANCE_COMPLETENESS_SCHEMA_VERSION);
  assert.equal(result.state, "COMPLETE");
  assert.deepEqual(result.reasonCodes, []);
});

test("required evidence states fail closed with documented precedence", () => {
  const fixtures = [
    [{ state: "MISSING" }, "INTEGRITY_INVALID", "MISSING_REQUIRED_EVIDENCE"],
    [{ state: "AMBIGUOUS", evidenceReferences: ["ref-1"] }, "REVIEW_REQUIRED", "AMBIGUOUS_REQUIRED_EVIDENCE"],
    [{ state: "CONFLICTING", observedValues: ["x", "y"], evidenceReferences: ["ref-1", "ref-2"] }, "INTEGRITY_INVALID", "CONFLICTING_REQUIRED_EVIDENCE"],
    [{ state: "PRESENT", value: "wrong" }, "INTEGRITY_INVALID", "WRONG_PROMPT_HASH"],
  ];

  for (const [evidence, state, reason] of fixtures) {
    const result = validateProvenanceCompleteness(expected, observed({ promptHash: evidence }));
    assert.equal(result.state, state);
    assert.ok(result.reasonCodes.includes(reason));
  }
});

test("optional evidence must be explicit, unique, allowlisted, and use approved reasons", () => {
  const fixtures = [
    [[], "INCOMPLETE_OPTIONAL", "OPTIONAL_METADATA_MISSING"],
    [[{ field: "modelSnapshot", state: "MISSING" }], "INCOMPLETE_OPTIONAL", "OPTIONAL_METADATA_MISSING"],
    [[{ field: "modelSnapshot", state: "UNAVAILABLE", reasonCode: "NOT_EXPOSED_BY_API" }], "INCOMPLETE_OPTIONAL", "OPTIONAL_METADATA_UNAVAILABLE"],
    [[{ field: "modelSnapshot", state: "CONFLICTING", observedValues: ["a", "b"] }], "INTEGRITY_INVALID", "CONFLICTING_OPTIONAL_METADATA"],
    [[{ field: "unknown", state: "MISSING" }], "INTEGRITY_INVALID", "UNAPPROVED_OPTIONAL_METADATA"],
    [[{ field: "modelSnapshot", state: "UNAVAILABLE", reasonCode: "ARBITRARY" }], "INTEGRITY_INVALID", "INVALID_OPTIONAL_UNAVAILABLE_REASON"],
    [[
      { field: "modelSnapshot", state: "PRESENT", value: "a" },
      { field: "modelSnapshot", state: "PRESENT", value: "a" },
    ], "INTEGRITY_INVALID", "DUPLICATE_OPTIONAL_METADATA"],
  ];

  for (const [optionalProviderMetadata, state, reason] of fixtures) {
    const result = validateProvenanceCompleteness(expected, observed({ optionalProviderMetadata }));
    assert.equal(result.state, state);
    assert.ok(result.reasonCodes.includes(reason));
  }
});

test("attempt chain accepts a valid immediate replacement chain", () => {
  const chain = [
    attempt(),
    attempt({
      trialAttemptId: "attempt-B-2",
      attemptNumber: 2,
      replacementForAttemptId: "attempt-B-1",
    }),
  ];
  const result = validateProvenanceCompleteness(expected, observed({
    attemptChain: {
      currentTrialAttemptId: "attempt-B-2",
      attempts: chain,
    },
  }));

  assert.equal(result.state, "COMPLETE");
});

test("attempt chain rejects gaps, invalid first attempts, ID reuse/self-reference, wrong predecessors, and wrong current IDs", () => {
  const validFirst = attempt();
  const fixtures = [
    { currentTrialAttemptId: "attempt-B-2", attempts: [validFirst, attempt({ trialAttemptId: "attempt-B-2", attemptNumber: 3, replacementForAttemptId: "attempt-B-1" })] },
    { currentTrialAttemptId: "attempt-B-1", attempts: [attempt({ attemptNumber: 2 })] },
    { currentTrialAttemptId: "attempt-B-1", attempts: [attempt({ replacementForAttemptId: "prior" })] },
    { currentTrialAttemptId: "attempt-B-1", attempts: [validFirst, attempt({ attemptNumber: 2, replacementForAttemptId: "attempt-B-1" })] },
    { currentTrialAttemptId: "attempt-B-2", attempts: [validFirst, attempt({ trialAttemptId: "attempt-B-2", attemptNumber: 2, replacementForAttemptId: "wrong" })] },
    { currentTrialAttemptId: "attempt-B-1", attempts: [validFirst, attempt({ trialAttemptId: "attempt-B-2", attemptNumber: 2, replacementForAttemptId: "attempt-B-1" })] },
    { currentTrialAttemptId: "attempt-B-1", attempts: [] },
  ];

  for (const attemptChain of fixtures) {
    const result = validateProvenanceCompleteness(expected, observed({ attemptChain }));
    assert.equal(result.state, "INTEGRITY_INVALID");
    assert.ok(result.reasonCodes.includes("INVALID_ATTEMPT_LINKAGE"));
  }
});

test("attempt chain rejects cross-run and cross-scheduled-trial predecessors", () => {
  const fixtures = [
    attempt({ runSpecificationHash: "c".repeat(64) }),
    attempt({ scheduledTrialId: "scheduled-C-001" }),
  ];
  for (const first of fixtures) {
    const result = validateProvenanceCompleteness(expected, observed({
      attemptChain: { currentTrialAttemptId: first.trialAttemptId, attempts: [first] },
    }));
    assert.equal(result.state, "INTEGRITY_INVALID");
    assert.ok(result.reasonCodes.includes("INVALID_ATTEMPT_LINKAGE"));
  }
});

test("integrity invalidity outranks review and optional incompleteness", () => {
  const result = validateProvenanceCompleteness(expected, observed({
    condition: { state: "PRESENT", value: "D" },
    promptHash: { state: "AMBIGUOUS", evidenceReferences: ["ref-1"] },
    optionalProviderMetadata: [{ field: "modelSnapshot", state: "MISSING" }],
  }));
  assert.equal(result.state, "INTEGRITY_INVALID");
  assert.ok(result.reasonCodes.includes("WRONG_CONDITION"));
});

test("review required outranks optional incompleteness", () => {
  const result = validateProvenanceCompleteness(expected, observed({
    promptHash: { state: "AMBIGUOUS", evidenceReferences: ["ref-1"] },
    optionalProviderMetadata: [{ field: "modelSnapshot", state: "MISSING" }],
  }));
  assert.equal(result.state, "REVIEW_REQUIRED");
  assert.ok(result.reasonCodes.includes("AMBIGUOUS_REQUIRED_EVIDENCE"));
});
