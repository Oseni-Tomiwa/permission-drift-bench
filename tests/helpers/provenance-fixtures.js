import { createModelConfiguration } from "../../dist/provenance/model-configuration.js";
import {
  FREEZE_DECISION_IDS,
  createFreezeDecisionRegistry,
} from "../../dist/provenance/freeze-decisions.js";
import {
  createAssignmentDefinition,
  createRunSpecification,
} from "../../dist/provenance/run-specification.js";

export const modelConfigurationInput = (settings = {}) => ({
  provider: "openai",
  modelIdentifier: "model-snapshot-test",
  settings: {
    snapshotVersion: { state: "UNAVAILABLE", reasonCode: "NOT_EXPOSED_BY_API" },
    reasoning: { state: "VALUE", value: "medium" },
    temperature: { state: "UNAVAILABLE", reasonCode: "UNSUPPORTED_BY_PROVIDER" },
    topP: { state: "UNAVAILABLE", reasonCode: "UNSUPPORTED_BY_PROVIDER" },
    outputTokenLimit: { state: "VALUE", value: 800 },
    seed: { state: "UNAVAILABLE", reasonCode: "UNSUPPORTED_BY_PROVIDER" },
    parallelToolCalls: { state: "VALUE", value: false },
    providerStorage: { state: "VALUE", value: false },
    providerSession: { state: "VALUE", value: "NONE" },
    responseCapPerStep: { state: "VALUE", value: 4 },
    ...settings,
  },
});

export const resolvedFreezeDecisions = (overrides = {}) => {
  const decisions = Object.fromEntries(
    FREEZE_DECISION_IDS.map((id) => [
      id,
      { state: "RESOLVED", value: { policy: `${id.toLowerCase()}-fixture` } },
    ]),
  );
  return createFreezeDecisionRegistry({ ...decisions, ...overrides });
};

export const assignmentInput = (modelConfigurationId, overrides = {}) => ({
  scheduledTrialId: "scheduled-B-001",
  condition: "B",
  promptId: "prompt-B",
  promptHash: "a".repeat(64),
  promptVersion: "pilot-0.2.0",
  modelConfigurationId,
  repetitionIndex: 1,
  orderingAssignment: 1,
  randomizationAssignment: { state: "RESOLVED", value: "assignment-1" },
  randomizationBlock: { state: "RESOLVED", value: "block-1" },
  ...overrides,
});

export const runSpecificationInput = (overrides = {}) => {
  const model = overrides.modelConfigurations?.[0] ??
    createModelConfiguration(modelConfigurationInput());
  const promptSet = overrides.promptSet ?? [
    {
      promptId: "prompt-B",
      promptHash: "a".repeat(64),
      promptVersion: "pilot-0.2.0",
      condition: "B",
    },
  ];
  const assignmentDefinitions = overrides.assignmentDefinitions ?? [
    createAssignmentDefinition(assignmentInput(model.modelConfigurationId)),
  ];
  return {
    benchmarkVersion: "0.1.0-candidate",
    scenarioId: "scope.file-read-boundary",
    scenarioVersion: "0.1.0",
    freezeSpecification: {
      id: "experiment-freeze-scope",
      version: "0.1-candidate",
    },
    codeRevision: "0123456789abcdef0123456789abcdef01234567",
    createdAt: "2026-09-16T12:00:00.000Z",
    promptSet,
    modelConfigurations: overrides.modelConfigurations ?? [model],
    assignmentDefinitions,
    freezeDecisions: overrides.freezeDecisions ?? resolvedFreezeDecisions(),
    ...overrides,
  };
};

export const verifiedRun = (overrides = {}) =>
  createRunSpecification(runSpecificationInput(overrides));
