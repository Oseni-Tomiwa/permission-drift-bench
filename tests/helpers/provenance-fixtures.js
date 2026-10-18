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
  identity: {
    provider: "openai",
    providerBackend: "OpenAI Responses API",
    apiSurface: "responses-v1",
    requestedModel: "model-snapshot-test",
    adapterName: "OpenAIResponsesAdapter",
    adapterVersion: "openai-responses-adapter-v0.3.0",
    sdkPackage: "openai",
    sdkVersion: "7.15.0",
  },
  settings: {
    snapshotVersion: { state: "UNAVAILABLE", reasonCode: "NOT_EXPOSED_BY_API" },
    reasoning: { state: "VALUE", value: "medium" },
    thinkingMode: { state: "NOT_APPLICABLE" },
    temperature: { state: "OMITTED", reasonCode: "INTENTIONALLY_OMITTED" },
    topP: { state: "OMITTED", reasonCode: "INTENTIONALLY_OMITTED" },
    outputTokenLimit: { state: "VALUE", value: 800 },
    seed: { state: "OMITTED", reasonCode: "INTENTIONALLY_OMITTED" },
    toolChoice: { state: "VALUE", value: "auto" },
    parallelToolCalls: { state: "VALUE", value: false },
    providerStorage: { state: "VALUE", value: false },
    background: { state: "NOT_APPLICABLE" },
    providerSession: { state: "VALUE", value: "NONE" },
    continuationStrategy: { state: "VALUE", value: "LOCAL_TRANSCRIPT_REPLAY" },
    providerAddressableContinuationId: { state: "OMITTED", reasonCode: "INTENTIONALLY_OMITTED" },
    automaticSdkRetries: { state: "VALUE", value: 0 },
    responseCapPerStep: { state: "VALUE", value: 4 },
    streaming: { state: "VALUE", value: false },
    endpoint: { state: "VALUE", value: "OPENAI_SDK_DEFAULT" },
    backendMode: { state: "VALUE", value: "RESPONSES_API" },
    apiVersion: { state: "NOT_APPLICABLE" },
    vertexBackend: { state: "NOT_APPLICABLE" },
    providerStateReplay: { state: "VALUE", value: "OUTPUT_ITEMS" },
    reasoningStateInclusion: { state: "VALUE", value: "reasoning.encrypted_content" },
    ...settings,
  },
  returnedModelPolicy: "EXACT_REQUESTED_IF_PRESENT",
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

export const formallyFrozenFreezeDecisions = (overrides = {}) => {
  const decisions = Object.fromEntries(
    FREEZE_DECISION_IDS.map((id) => [
      id,
      { state: "FORMALLY_FROZEN", value: { policy: `${id.toLowerCase()}-fixture` } },
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
