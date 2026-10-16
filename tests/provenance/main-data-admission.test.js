import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizePreExecution,
  classifyRecordedTrial,
} from "../../dist/provenance/main-data-admission.js";
import {
  materializeFrozenAssignment,
} from "../../dist/provenance/run-specification.js";
import {
  formallyFrozenFreezeDecisions,
  verifiedRun,
} from "../helpers/provenance-fixtures.js";

const completeEvidence = (policy, assignment) => ({
  runSpecificationId: { state: "PRESENT", value: policy.runSpecificationId },
  runSpecificationHash: { state: "PRESENT", value: policy.runSpecificationHash },
  codeRevision: { state: "PRESENT", value: policy.codeRevision },
  scheduledTrialId: { state: "PRESENT", value: assignment.assignmentDefinition.scheduledTrialId },
  condition: { state: "PRESENT", value: assignment.assignmentDefinition.condition },
  promptId: { state: "PRESENT", value: policy.promptId },
  promptHash: { state: "PRESENT", value: policy.promptHash },
  modelConfigurationId: { state: "PRESENT", value: policy.modelConfigurationId },
  attemptChain: {
    currentTrialAttemptId: "attempt-1",
    attempts: [{
      trialAttemptId: "attempt-1",
      scheduledTrialId: assignment.assignmentDefinition.scheduledTrialId,
      runSpecificationId: policy.runSpecificationId,
      runSpecificationHash: policy.runSpecificationHash,
      attemptNumber: 1,
      replacementForAttemptId: null,
    }],
  },
  optionalProviderMetadata: [{
    field: "returnedModel",
    state: "UNAVAILABLE",
    reasonCode: "NOT_RETURNED",
  }],
});

const setup = () => {
  const run = verifiedRun({ freezeDecisions: formallyFrozenFreezeDecisions() });
  const definition = run.assignmentDefinitions[0];
  const assignment = materializeFrozenAssignment(run, definition.assignmentDefinitionId);
  const prompt = run.promptSet[0];
  const policy = {
    policyVersion: "main-data-admission-v0.1.0",
    runSpecificationId: run.runSpecificationId,
    runSpecificationHash: run.runSpecificationHash,
    codeRevision: run.codeRevision,
    scenarioId: run.scenarioId,
    scenarioVersion: run.scenarioVersion,
    modelConfigurationId: definition.modelConfigurationId,
    promptId: prompt.promptId,
    promptHash: prompt.promptHash,
    assignmentDefinitionId: definition.assignmentDefinitionId,
    frozenAssignmentId: assignment.frozenAssignmentId,
    frozenAssignmentHash: assignment.frozenAssignmentHash,
    mainRunStartsAt: "2026-10-20T12:00:00.000Z",
    acceptedProvenanceStates: ["COMPLETE", "INCOMPLETE_OPTIONAL"],
    optionalProviderFields: ["returnedModel"],
    optionalUnavailableReasonCodes: ["NOT_RETURNED"],
  };
  const executionBinding = {
    runSpecificationId: policy.runSpecificationId,
    runSpecificationHash: policy.runSpecificationHash,
    codeRevision: policy.codeRevision,
    scenarioId: policy.scenarioId,
    scenarioVersion: policy.scenarioVersion,
    modelConfigurationId: policy.modelConfigurationId,
    promptId: policy.promptId,
    promptHash: policy.promptHash,
    assignmentDefinitionId: policy.assignmentDefinitionId,
    frozenAssignmentId: policy.frozenAssignmentId,
    frozenAssignmentHash: policy.frozenAssignmentHash,
  };
  const candidate = {
    executionPurpose: "MAIN_CANDIDATE",
    runSpecification: run,
    frozenAssignment: assignment,
    executionBinding,
    admissionEvaluatedAt: "2026-10-20T11:59:58.000Z",
    plannedTrialStartsAt: "2026-10-20T12:00:00.000Z",
  };
  return { run, assignment, policy, candidate };
};

test("exact formally frozen MAIN candidate is authorized before execution", () => {
  const { policy, candidate } = setup();
  const admission = authorizePreExecution(policy, candidate);
  assert.equal(admission.status, "MAIN_AUTHORIZED");
  assert.deepEqual(admission.reasonCodes, []);
  assert.equal(Object.isFrozen(admission), true);
});

test("pilot remains PILOT and all other non-main purposes remain EXCLUDED", () => {
  for (const purpose of ["PILOT", "SMOKE", "ADAPTER_VALIDATION", "DEBUG", "PRE_FREEZE", "EXPLORATORY"]) {
    const { policy, candidate, assignment } = setup();
    const admission = authorizePreExecution(policy, { ...candidate, executionPurpose: purpose });
    const classification = classifyRecordedTrial(
      admission,
      "2026-10-20T12:00:01.000Z",
      completeEvidence(policy, assignment),
    );
    assert.equal(admission.status, purpose === "PILOT" ? "PILOT_ONLY" : "EXCLUDED");
    assert.equal(classification.dataClass, purpose === "PILOT" ? "PILOT" : "EXCLUDED");
    assert.equal(classification.provenance, null);
  }
});

test("every exact frozen identity mismatch fails closed", () => {
  const fields = [
    "runSpecificationId", "runSpecificationHash", "codeRevision", "scenarioId",
    "scenarioVersion", "modelConfigurationId", "promptId", "promptHash",
    "assignmentDefinitionId", "frozenAssignmentId", "frozenAssignmentHash",
  ];
  for (const field of fields) {
    const { policy, candidate } = setup();
    const executionBinding = { ...candidate.executionBinding, [field]: `${candidate.executionBinding[field]}-wrong` };
    const admission = authorizePreExecution(policy, { ...candidate, executionBinding });
    assert.equal(admission.status, "EXCLUDED", field);
    assert.ok(admission.reasonCodes.includes("EXECUTION_BINDING_MISMATCH"), field);
  }
});

test("forged run, wrong assignment binding, and non-ready run are excluded", () => {
  {
    const { policy, candidate } = setup();
    const forged = { ...candidate.runSpecification, runSpecificationHash: "f".repeat(64) };
    assert.equal(authorizePreExecution(policy, { ...candidate, runSpecification: forged }).status, "EXCLUDED");
  }
  {
    const { policy, candidate } = setup();
    const forged = { ...candidate.frozenAssignment, frozenAssignmentHash: "f".repeat(64) };
    assert.equal(authorizePreExecution(policy, { ...candidate, frozenAssignment: forged }).status, "EXCLUDED");
  }
  {
    const { policy, candidate } = setup();
    const run = verifiedRun();
    const assignment = materializeFrozenAssignment(run, run.assignmentDefinitions[0].assignmentDefinitionId);
    assert.equal(authorizePreExecution(policy, {
      ...candidate,
      runSpecification: run,
      frozenAssignment: assignment,
    }).status, "EXCLUDED");
  }
});

test("admission must precede planned start and boundary", () => {
  const { policy, candidate } = setup();
  assert.equal(authorizePreExecution(policy, {
    ...candidate,
    admissionEvaluatedAt: candidate.plannedTrialStartsAt,
  }).status, "EXCLUDED");
  assert.equal(authorizePreExecution(policy, {
    ...candidate,
    plannedTrialStartsAt: "2026-10-20T11:59:59.000Z",
  }).status, "EXCLUDED");
  assert.equal(authorizePreExecution(policy, {
    ...candidate,
    admissionEvaluatedAt: "not-a-timestamp",
  }).status, "EXCLUDED");
});

test("post-execution provenance may retain or demote but never promote", () => {
  const { policy, candidate, assignment } = setup();
  const admission = authorizePreExecution(policy, candidate);
  const complete = completeEvidence(policy, assignment);
  assert.equal(classifyRecordedTrial(admission, "2026-10-20T12:00:01.000Z", complete).dataClass, "MAIN");

  const invalid = { ...complete, promptHash: { state: "PRESENT", value: "f".repeat(64) } };
  const demoted = classifyRecordedTrial(admission, "2026-10-20T12:00:01.000Z", invalid);
  assert.equal(demoted.dataClass, "EXCLUDED");
  assert.equal(demoted.provenance.state, "INTEGRITY_INVALID");

  const pilot = authorizePreExecution(policy, { ...candidate, executionPurpose: "PILOT" });
  assert.equal(classifyRecordedTrial(pilot, "2026-10-20T12:00:01.000Z", complete).dataClass, "PILOT");
});

test("optional incompleteness is accepted only when the policy allowlists it", () => {
  const { policy, candidate, assignment } = setup();
  const admission = authorizePreExecution(policy, candidate);
  const evidence = completeEvidence(policy, assignment);
  evidence.optionalProviderMetadata = [{ field: "returnedModel", state: "MISSING" }];
  const accepted = classifyRecordedTrial(admission, "2026-10-20T12:00:01.000Z", evidence);
  assert.equal(accepted.provenance.state, "INCOMPLETE_OPTIONAL");
  assert.equal(accepted.dataClass, "MAIN");

  const strictPolicy = { ...policy, acceptedProvenanceStates: ["COMPLETE"] };
  const strictAdmission = authorizePreExecution(strictPolicy, candidate);
  assert.equal(classifyRecordedTrial(strictAdmission, "2026-10-20T12:00:01.000Z", evidence).dataClass, "EXCLUDED");
});

test("ambiguous, conflicting, and integrity-invalid provenance cannot be admitted", () => {
  const { policy, candidate, assignment } = setup();
  const admission = authorizePreExecution(policy, candidate);
  const complete = completeEvidence(policy, assignment);
  const ambiguous = {
    ...complete,
    promptHash: { state: "AMBIGUOUS", evidenceReferences: ["trace-a", "trace-b"] },
  };
  const conflicting = {
    ...complete,
    promptHash: {
      state: "CONFLICTING",
      observedValues: [policy.promptHash, "f".repeat(64)],
      evidenceReferences: ["trace-a", "trace-b"],
    },
  };
  assert.equal(classifyRecordedTrial(admission, "2026-10-20T12:00:01.000Z", ambiguous).dataClass, "EXCLUDED");
  assert.equal(classifyRecordedTrial(admission, "2026-10-20T12:00:01.000Z", conflicting).dataClass, "EXCLUDED");

  for (const invalidState of ["INTEGRITY_INVALID", "REVIEW_REQUIRED"]) {
    const invalidPolicy = { ...policy, acceptedProvenanceStates: [invalidState] };
    const result = authorizePreExecution(invalidPolicy, candidate);
    assert.equal(result.status, "EXCLUDED");
    assert.ok(result.reasonCodes.includes("INVALID_POLICY"));
  }
});

test("classification is outcome-blind and actual start cannot precede authorization", () => {
  const { policy, candidate, assignment } = setup();
  const admission = authorizePreExecution(policy, candidate);
  const evidence = { ...completeEvidence(policy, assignment), behavioralOutcome: "UNAUTHORIZED_ATTEMPT" };
  assert.equal(classifyRecordedTrial(admission, "2026-10-20T12:00:01.000Z", evidence).dataClass, "MAIN");
  assert.equal(classifyRecordedTrial(admission, "2026-10-20T11:59:57.000Z", evidence).dataClass, "EXCLUDED");
});
