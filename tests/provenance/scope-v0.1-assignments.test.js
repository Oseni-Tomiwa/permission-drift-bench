import assert from "node:assert/strict";
import test from "node:test";

import { createModelConfiguration } from "../../dist/provenance/model-configuration.js";
import {
  SCOPE_V01_BLOCKS_PER_MODEL,
  SCOPE_V01_CONDITIONS,
  createScopeV01AssignmentDefinitions,
  deriveModelRandomizationSeed,
} from "../../dist/provenance/scope-v0.1-assignments.js";
import {
  createRunSpecification,
  verifyAssignmentDefinition,
} from "../../dist/provenance/run-specification.js";
import {
  formallyFrozenFreezeDecisions,
  modelConfigurationInput,
  runSpecificationInput,
} from "../helpers/provenance-fixtures.js";

const MASTER_SEED = "scope-v0.1-test-master-seed";
const promptReferences = Object.freeze(Object.fromEntries(
  SCOPE_V01_CONDITIONS.map((condition, index) => {
    const promptHash = String(index + 1).repeat(64);
    return [condition, Object.freeze({
      condition,
      promptId: `pilot-0.2.0:${condition}:${promptHash}`,
      promptHash,
      promptVersion: "pilot-0.2.0",
    })];
  }),
));

const model = (modelIdentifier) => createModelConfiguration({
  ...modelConfigurationInput(),
  identity: {
    ...modelConfigurationInput().identity,
    requestedModel: modelIdentifier,
  },
});

const assignmentsFor = (...models) => createScopeV01AssignmentDefinitions({
  masterSeed: MASTER_SEED,
  models: models.map((configuration) => ({
    modelConfigurationId: configuration.modelConfigurationId,
    promptReferences,
  })),
});

test("each model receives 100 complete A-D blocks and 100 assignments per condition", () => {
  const configuration = model("model-one");
  const assignments = assignmentsFor(configuration);

  assert.equal(SCOPE_V01_BLOCKS_PER_MODEL, 100);
  assert.equal(assignments.length, 400);
  assert.deepEqual(
    Object.fromEntries(SCOPE_V01_CONDITIONS.map((condition) => [
      condition,
      assignments.filter((assignment) => assignment.condition === condition).length,
    ])),
    { A: 100, B: 100, C: 100, D: 100 },
  );

  for (let blockIndex = 0; blockIndex < 100; blockIndex += 1) {
    const block = assignments.slice(blockIndex * 4, blockIndex * 4 + 4);
    assert.deepEqual([...block.map(({ condition }) => condition)].sort(), ["A", "B", "C", "D"]);
    assert.deepEqual(block.map(({ orderingAssignment }) => orderingAssignment), [
      blockIndex * 4 + 1,
      blockIndex * 4 + 2,
      blockIndex * 4 + 3,
      blockIndex * 4 + 4,
    ]);
    assert.equal(block.every((assignment) =>
      assignment.randomizationBlock.value.blockIndex === blockIndex + 1), true);
  }
});

test("generated assignments retain exact model and prompt bindings with verified identities", () => {
  const configuration = model("model-bindings");
  const assignments = assignmentsFor(configuration);
  const repetitionCounts = { A: 0, B: 0, C: 0, D: 0 };

  for (const assignment of assignments) {
    repetitionCounts[assignment.condition] += 1;
    assert.equal(assignment.modelConfigurationId, configuration.modelConfigurationId);
    assert.equal(assignment.promptId, promptReferences[assignment.condition].promptId);
    assert.equal(assignment.promptHash, promptReferences[assignment.condition].promptHash);
    assert.equal(assignment.promptVersion, "pilot-0.2.0");
    assert.equal(assignment.repetitionIndex, repetitionCounts[assignment.condition]);
    assert.deepEqual(verifyAssignmentDefinition(JSON.parse(JSON.stringify(assignment))), assignment);
  }
});

test("same seed and inputs reproduce identical order and content identities", () => {
  const configuration = model("model-repeatable");

  assert.deepEqual(assignmentsFor(configuration), assignmentsFor(configuration));
});

test("model-specific seed derivation isolates model strata", () => {
  const first = model("model-first");
  const second = model("model-second");
  const firstSeed = deriveModelRandomizationSeed(MASTER_SEED, first.modelConfigurationId);
  const secondSeed = deriveModelRandomizationSeed(MASTER_SEED, second.modelConfigurationId);
  const together = assignmentsFor(first, second);
  const firstAlone = assignmentsFor(first);
  const secondAlone = assignmentsFor(second);

  assert.match(firstSeed, /^[a-f0-9]{64}$/);
  assert.notEqual(firstSeed, secondSeed);
  assert.deepEqual(together.slice(0, 400), firstAlone);
  assert.deepEqual(together.slice(400), secondAlone);
  assert.notDeepEqual(
    firstAlone.map(({ condition }) => condition),
    secondAlone.map(({ condition }) => condition),
  );
});

test("assignment generation fails closed without explicit unique inputs", () => {
  const configuration = model("model-validation");
  const inputModel = {
    modelConfigurationId: configuration.modelConfigurationId,
    promptReferences,
  };

  assert.throws(() => createScopeV01AssignmentDefinitions({
    masterSeed: "",
    models: [inputModel],
  }), /master seed/i);
  assert.throws(() => createScopeV01AssignmentDefinitions({
    masterSeed: MASTER_SEED,
    models: [],
  }), /model/i);
  assert.throws(() => createScopeV01AssignmentDefinitions({
    masterSeed: MASTER_SEED,
    models: [inputModel, inputModel],
  }), /duplicate model/i);

  const mismatchedPromptId = {
    ...promptReferences,
    B: {
      ...promptReferences.B,
      promptId: "pilot-0.2.0:B:not-the-prompt-hash",
    },
  };
  assert.throws(() => createScopeV01AssignmentDefinitions({
    masterSeed: MASTER_SEED,
    models: [{
      modelConfigurationId: configuration.modelConfigurationId,
      promptReferences: mismatchedPromptId,
    }],
  }), /prompt id/i);
});

test("ordered generated definitions are content-addressed by the existing run specification", () => {
  const configuration = model("model-run-hash");
  const assignments = assignmentsFor(configuration);
  const promptSet = Object.values(promptReferences);
  const input = runSpecificationInput({
    promptSet,
    modelConfigurations: [configuration],
    assignmentDefinitions: assignments,
    freezeDecisions: formallyFrozenFreezeDecisions(),
  });
  const ordered = createRunSpecification(input);
  const reversed = createRunSpecification({
    ...input,
    assignmentDefinitions: [...assignments].reverse(),
  });

  assert.notEqual(ordered.runSpecificationHash, reversed.runSpecificationHash);
  assert.equal("assignmentSetHash" in ordered, false);
});
