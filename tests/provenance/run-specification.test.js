import assert from "node:assert/strict";
import test from "node:test";

import {
  ASSIGNMENT_DEFINITION_SCHEMA_VERSION,
  FROZEN_ASSIGNMENT_SCHEMA_VERSION,
  RUN_SPECIFICATION_SCHEMA_VERSION,
  createAssignmentDefinition,
  createRunSpecification,
  materializeFrozenAssignment,
  recalculateRunSpecificationHash,
  verifyAssignmentDefinition,
  verifyFrozenAssignment,
  verifyRunSpecification,
} from "../../dist/provenance/run-specification.js";
import { createModelConfiguration } from "../../dist/provenance/model-configuration.js";
import {
  assignmentInput,
  modelConfigurationInput,
  runSpecificationInput,
  verifiedRun,
} from "../helpers/provenance-fixtures.js";

test("assignment definitions have deterministic content identity without parent run fields", () => {
  const run = verifiedRun();
  const input = assignmentInput(run.modelConfigurations[0].modelConfigurationId);
  const first = createAssignmentDefinition(input);
  const second = createAssignmentDefinition({ ...input });

  assert.equal(first.schemaVersion, ASSIGNMENT_DEFINITION_SCHEMA_VERSION);
  assert.equal(first.hashAlgorithm, "sha256");
  assert.equal(first.canonicalHashContractVersion, "canonical-json-v0.1");
  assert.equal(first.assignmentDefinitionHash, second.assignmentDefinitionHash);
  assert.equal(first.assignmentDefinitionId, second.assignmentDefinitionId);
  assert.equal("runSpecificationId" in first, false);
  assert.equal("runSpecificationHash" in first, false);
  assert.equal(Object.isFrozen(first), true);
});

test("every assignment-defining dimension changes definition identity", () => {
  const model = createModelConfiguration(modelConfigurationInput());
  const baselineInput = assignmentInput(model.modelConfigurationId);
  const baseline = createAssignmentDefinition(baselineInput);
  const changes = [
    { scheduledTrialId: "scheduled-B-002" },
    { condition: "C" },
    { repetitionIndex: 2 },
    { promptId: "prompt-C" },
    { promptHash: "b".repeat(64) },
    { promptVersion: "pilot-0.2.1" },
    { modelConfigurationId: "other-model" },
    { orderingAssignment: 2 },
    { randomizationAssignment: { state: "RESOLVED", value: "assignment-2" } },
    { randomizationBlock: { state: "RESOLVED", value: "block-2" } },
  ];

  for (const change of changes) {
    const changed = createAssignmentDefinition({ ...baselineInput, ...change });
    assert.notEqual(changed.assignmentDefinitionId, baseline.assignmentDefinitionId);
  }
});

test("plain assignment definitions verify while forged hashes and IDs fail", () => {
  const definition = verifiedRun().assignmentDefinitions[0];
  assert.deepEqual(
    verifyAssignmentDefinition(JSON.parse(JSON.stringify(definition))),
    definition,
  );
  assert.throws(() => verifyAssignmentDefinition({
    ...definition,
    assignmentDefinitionHash: "f".repeat(64),
  }), /hash/i);
  assert.throws(() => verifyAssignmentDefinition({
    ...definition,
    assignmentDefinitionId: `${ASSIGNMENT_DEFINITION_SCHEMA_VERSION}:sha256:${"f".repeat(64)}`,
  }), /ID/i);
  assert.throws(() => verifyAssignmentDefinition({
    ...definition,
    canonicalHashContractVersion: "canonical-json-v999",
  }), /contract/i);
  assert.throws(() => verifyAssignmentDefinition({
    ...definition,
    hashAlgorithm: "sha512",
  }), /algorithm/i);
});

test("run specifications contain ordered definitions and have no recursive binding dependency", () => {
  const run = verifiedRun();

  assert.equal(run.schemaVersion, RUN_SPECIFICATION_SCHEMA_VERSION);
  assert.equal(run.hashAlgorithm, "sha256");
  assert.equal(run.canonicalHashContractVersion, "canonical-json-v0.1");
  assert.equal(Array.isArray(run.assignmentDefinitions), true);
  assert.equal("frozenAssignments" in run, false);
  assert.equal(JSON.stringify(run.assignmentDefinitions).includes("runSpecificationId"), false);
  assert.equal(JSON.stringify(run.assignmentDefinitions).includes("runSpecificationHash"), false);
  assert.equal(recalculateRunSpecificationHash(run), run.runSpecificationHash);
});

test("createdAt, definition content, and definition order affect run identity", () => {
  const baseline = verifiedRun();
  const createdLater = verifiedRun({ createdAt: "2026-09-16T12:00:01.000Z" });
  const changedDefinition = createAssignmentDefinition(assignmentInput(
    baseline.modelConfigurations[0].modelConfigurationId,
    {
    repetitionIndex: 2,
    },
  ));
  const changedRun = verifiedRun({ assignmentDefinitions: [changedDefinition] });
  const secondDefinition = createAssignmentDefinition(assignmentInput(
    baseline.modelConfigurations[0].modelConfigurationId,
    {
    scheduledTrialId: "scheduled-B-002",
    repetitionIndex: 2,
    orderingAssignment: 2,
    },
  ));
  const ordered = verifiedRun({
    assignmentDefinitions: [baseline.assignmentDefinitions[0], secondDefinition],
  });
  const reversed = verifiedRun({
    assignmentDefinitions: [secondDefinition, baseline.assignmentDefinitions[0]],
  });

  assert.notEqual(baseline.runSpecificationHash, createdLater.runSpecificationHash);
  assert.notEqual(baseline.runSpecificationHash, changedRun.runSpecificationHash);
  assert.notEqual(ordered.runSpecificationHash, reversed.runSpecificationHash);
});

test("materialization binds the exact definition without mutating the run", () => {
  const run = verifiedRun();
  const before = JSON.stringify(run);
  const definition = run.assignmentDefinitions[0];
  const binding = materializeFrozenAssignment(run, definition.assignmentDefinitionId);

  assert.equal(binding.schemaVersion, FROZEN_ASSIGNMENT_SCHEMA_VERSION);
  assert.deepEqual(binding.assignmentDefinition, definition);
  assert.equal(binding.runSpecificationId, run.runSpecificationId);
  assert.equal(binding.runSpecificationHash, run.runSpecificationHash);
  assert.equal(JSON.stringify(run), before);
  assert.equal(Object.isFrozen(binding), true);
});

test("the same definition bound to different runs keeps content identity but changes binding identity", () => {
  const firstRun = verifiedRun();
  const secondRun = verifiedRun({ createdAt: "2026-09-16T12:00:01.000Z" });
  const first = materializeFrozenAssignment(firstRun, firstRun.assignmentDefinitions[0].assignmentDefinitionId);
  const second = materializeFrozenAssignment(secondRun, secondRun.assignmentDefinitions[0].assignmentDefinitionId);

  assert.equal(first.assignmentDefinition.assignmentDefinitionId, second.assignmentDefinition.assignmentDefinitionId);
  assert.notEqual(first.frozenAssignmentId, second.frozenAssignmentId);
});

test("frozen assignment verification rejects wrong runs, altered definitions, and forged binding identity", () => {
  const run = verifiedRun();
  const otherRun = verifiedRun({ createdAt: "2026-09-16T12:00:01.000Z" });
  const binding = materializeFrozenAssignment(run, run.assignmentDefinitions[0].assignmentDefinitionId);

  assert.deepEqual(verifyFrozenAssignment(JSON.parse(JSON.stringify(binding)), run), binding);
  assert.throws(() => verifyFrozenAssignment(binding, otherRun), /parent run|run specification/i);
  assert.throws(() => verifyFrozenAssignment({
    ...binding,
    assignmentDefinition: { ...binding.assignmentDefinition, condition: "C" },
  }, run), /assignment|definition|hash/i);
  assert.throws(() => verifyFrozenAssignment({
    ...binding,
    frozenAssignmentHash: "f".repeat(64),
  }, run), /hash/i);
  assert.throws(() => verifyFrozenAssignment({
    ...binding,
    frozenAssignmentId: `${FROZEN_ASSIGNMENT_SCHEMA_VERSION}:sha256:${"f".repeat(64)}`,
  }, run), /ID/i);
  assert.throws(() => verifyFrozenAssignment({
    ...binding,
    canonicalHashContractVersion: "canonical-json-v999",
  }, run), /contract/i);
  assert.throws(() => verifyFrozenAssignment({
    ...binding,
    hashAlgorithm: "sha512",
  }, run), /algorithm/i);

  const differentDefinition = createAssignmentDefinition(assignmentInput(
    run.modelConfigurations[0].modelConfigurationId,
    { scheduledTrialId: "scheduled-C-001", condition: "C", promptId: "prompt-C", promptHash: "c".repeat(64) },
  ));
  const parentWithoutDefinition = verifiedRun({
    promptSet: [{
      promptId: "prompt-C",
      promptHash: "c".repeat(64),
      promptVersion: "pilot-0.2.0",
      condition: "C",
    }],
    assignmentDefinitions: [differentDefinition],
  });
  assert.throws(() => verifyFrozenAssignment(binding, parentWithoutDefinition), /definition|parent run/i);
});

test("run verification rejects forged identity and stale nested records", () => {
  const run = verifiedRun();
  assert.deepEqual(verifyRunSpecification(JSON.parse(JSON.stringify(run))), run);
  assert.throws(() => verifyRunSpecification({ ...run, runSpecificationHash: "f".repeat(64) }), /hash/i);
  assert.throws(() => verifyRunSpecification({
    ...run,
    runSpecificationId: `${RUN_SPECIFICATION_SCHEMA_VERSION}:sha256:${"f".repeat(64)}`,
  }), /ID/i);
  assert.throws(() => verifyRunSpecification({
    ...run,
    modelConfigurations: [{ ...run.modelConfigurations[0], modelIdentifier: "stale-model" }],
  }), /model configuration|hash/i);
  assert.throws(() => verifyRunSpecification({
    ...run,
    assignmentDefinitions: [{
      ...run.assignmentDefinitions[0],
      condition: "C",
    }],
  }), /assignment|hash/i);
});

test("run verification rejects duplicate and unresolved nested references", () => {
  const run = verifiedRun();
  const definition = run.assignmentDefinitions[0];
  const prompt = run.promptSet[0];
  const model = run.modelConfigurations[0];
  const sameScheduledDifferentDefinition = createAssignmentDefinition(assignmentInput(
    model.modelConfigurationId,
    { repetitionIndex: 2, orderingAssignment: 2 },
  ));
  for (const candidate of [
    { ...run, promptSet: [prompt, { ...prompt }] },
    { ...run, modelConfigurations: [model, model] },
    { ...run, assignmentDefinitions: [definition, definition] },
    { ...run, assignmentDefinitions: [definition, sameScheduledDifferentDefinition] },
  ]) {
    assert.throws(() => verifyRunSpecification(candidate));
  }

  const unmatchedPromptDefinition = createAssignmentDefinition(assignmentInput(
    model.modelConfigurationId,
    { promptId: "missing-prompt" },
  ));
  const unmatchedModelDefinition = createAssignmentDefinition(assignmentInput(
    "missing-model",
  ));
  assert.throws(() => createRunSpecification(runSpecificationInput({ assignmentDefinitions: [unmatchedPromptDefinition] })), /prompt/i);
  assert.throws(() => createRunSpecification(runSpecificationInput({ assignmentDefinitions: [unmatchedModelDefinition] })), /model/i);
});

test("unknown contracts, algorithms, fields, and bound assignments in runs fail closed", () => {
  const run = verifiedRun();
  for (const candidate of [
    { ...run, canonicalHashContractVersion: "canonical-json-v999" },
    { ...run, hashAlgorithm: "sha512" },
    { ...run, providerMetadata: "unexpected" },
    { ...run, frozenAssignments: [] },
  ]) {
    assert.throws(() => verifyRunSpecification(candidate));
  }
});
