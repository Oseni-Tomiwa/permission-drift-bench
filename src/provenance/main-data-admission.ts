import {
  validateProvenanceCompleteness,
  type ObservedProvenanceMetadata,
  type ProvenanceCompletenessResult,
  type ProvenanceCompletenessState,
  type ProvenanceExpectation,
} from "./provenance-completeness.js";
import {
  validateMainCollectionReadiness,
  verifyFrozenAssignment,
  verifyRunSpecification,
  type FrozenAssignment,
} from "./run-specification.js";

export const MAIN_DATA_ADMISSION_POLICY_VERSION = "main-data-admission-v0.1.0";

export type ExecutionPurpose =
  | "MAIN_CANDIDATE"
  | "PILOT"
  | "SMOKE"
  | "ADAPTER_VALIDATION"
  | "DEBUG"
  | "PRE_FREEZE"
  | "EXPLORATORY";

export type DataClass = "MAIN" | "PILOT" | "EXCLUDED";
export type PreExecutionAdmissionStatus = "MAIN_AUTHORIZED" | "PILOT_ONLY" | "EXCLUDED";

export type MainDataAdmissionReasonCode =
  | "NON_MAIN_EXECUTION_PURPOSE"
  | "INVALID_POLICY"
  | "INVALID_RUN_SPECIFICATION"
  | "RUN_NOT_COLLECTION_READY"
  | "INVALID_FROZEN_ASSIGNMENT"
  | "POLICY_IDENTITY_MISMATCH"
  | "EXECUTION_BINDING_MISMATCH"
  | "ASSIGNMENT_CONTENT_MISMATCH"
  | "INVALID_TIMESTAMP"
  | "ADMISSION_NOT_BEFORE_PLANNED_START"
  | "PLANNED_START_BEFORE_MAIN_BOUNDARY"
  | "ACTUAL_START_BEFORE_ADMISSION"
  | "ACTUAL_START_BEFORE_MAIN_BOUNDARY"
  | "PROVENANCE_NOT_ACCEPTED";

export interface MainExecutionBinding {
  readonly runSpecificationId: string;
  readonly runSpecificationHash: string;
  readonly codeRevision: string;
  readonly scenarioId: string;
  readonly scenarioVersion: string;
  readonly modelConfigurationId: string;
  readonly promptId: string;
  readonly promptHash: string;
  readonly assignmentDefinitionId: string;
  readonly frozenAssignmentId: string;
  readonly frozenAssignmentHash: string;
}

export interface MainDataAdmissionPolicy extends MainExecutionBinding {
  readonly policyVersion: typeof MAIN_DATA_ADMISSION_POLICY_VERSION;
  readonly mainRunStartsAt: string;
  readonly acceptedProvenanceStates: readonly ProvenanceCompletenessState[];
  readonly optionalProviderFields: readonly string[];
  readonly optionalUnavailableReasonCodes: readonly string[];
}

export interface MainDataCandidate {
  readonly executionPurpose: ExecutionPurpose;
  readonly runSpecification: unknown;
  readonly frozenAssignment: unknown;
  readonly executionBinding: MainExecutionBinding;
  readonly admissionEvaluatedAt: string;
  readonly plannedTrialStartsAt: string;
}

export interface PreExecutionAdmission {
  readonly policyVersion: typeof MAIN_DATA_ADMISSION_POLICY_VERSION;
  readonly status: PreExecutionAdmissionStatus;
  readonly executionPurpose: ExecutionPurpose;
  readonly reasonCodes: readonly MainDataAdmissionReasonCode[];
  readonly admissionEvaluatedAt: string;
  readonly mainRunStartsAt: string;
  readonly acceptedProvenanceStates: readonly ProvenanceCompletenessState[];
  readonly provenanceExpectation: ProvenanceExpectation | null;
}

export interface DataClassification {
  readonly dataClass: DataClass;
  readonly reasonCodes: readonly MainDataAdmissionReasonCode[];
  readonly provenance: ProvenanceCompletenessResult | null;
}

const BINDING_FIELDS = Object.freeze([
  "runSpecificationId", "runSpecificationHash", "codeRevision", "scenarioId",
  "scenarioVersion", "modelConfigurationId", "promptId", "promptHash",
  "assignmentDefinitionId", "frozenAssignmentId", "frozenAssignmentHash",
] as const);

function canonicalTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

function frozenArray<T>(value: readonly T[]): readonly T[] {
  return Object.freeze([...value]);
}

function admission(
  policy: MainDataAdmissionPolicy,
  candidate: MainDataCandidate,
  status: PreExecutionAdmissionStatus,
  reasons: readonly MainDataAdmissionReasonCode[],
  expectation: ProvenanceExpectation | null,
): PreExecutionAdmission {
  return Object.freeze({
    policyVersion: MAIN_DATA_ADMISSION_POLICY_VERSION,
    status,
    executionPurpose: candidate.executionPurpose,
    reasonCodes: frozenArray(reasons),
    admissionEvaluatedAt: candidate.admissionEvaluatedAt,
    mainRunStartsAt: policy.mainRunStartsAt,
    acceptedProvenanceStates: frozenArray(policy.acceptedProvenanceStates),
    provenanceExpectation: expectation === null ? null : Object.freeze({
      ...expectation,
      optionalProviderFields: frozenArray(expectation.optionalProviderFields),
      optionalUnavailableReasonCodes: frozenArray(expectation.optionalUnavailableReasonCodes),
    }),
  });
}

function policyIsValid(policy: MainDataAdmissionPolicy): boolean {
  const accepted = new Set<ProvenanceCompletenessState>([
    "COMPLETE", "INCOMPLETE_OPTIONAL",
  ]);
  return policy.policyVersion === MAIN_DATA_ADMISSION_POLICY_VERSION &&
    canonicalTimestamp(policy.mainRunStartsAt) &&
    Array.isArray(policy.acceptedProvenanceStates) &&
    policy.acceptedProvenanceStates.length > 0 &&
    policy.acceptedProvenanceStates.every((state) => accepted.has(state)) &&
    new Set(policy.acceptedProvenanceStates).size === policy.acceptedProvenanceStates.length &&
    Array.isArray(policy.optionalProviderFields) &&
    policy.optionalProviderFields.every((field) => typeof field === "string" && field.length > 0) &&
    new Set(policy.optionalProviderFields).size === policy.optionalProviderFields.length &&
    Array.isArray(policy.optionalUnavailableReasonCodes) &&
    policy.optionalUnavailableReasonCodes.every((code) => typeof code === "string" && code.length > 0) &&
    BINDING_FIELDS.every((field) => typeof policy[field] === "string" && policy[field].length > 0);
}

export function authorizePreExecution(
  policy: MainDataAdmissionPolicy,
  candidate: MainDataCandidate,
): PreExecutionAdmission {
  if (candidate.executionPurpose === "PILOT") {
    return admission(policy, candidate, "PILOT_ONLY", ["NON_MAIN_EXECUTION_PURPOSE"], null);
  }
  if (candidate.executionPurpose !== "MAIN_CANDIDATE") {
    return admission(policy, candidate, "EXCLUDED", ["NON_MAIN_EXECUTION_PURPOSE"], null);
  }

  const reasons: MainDataAdmissionReasonCode[] = [];
  if (!policyIsValid(policy)) reasons.push("INVALID_POLICY");
  if (!canonicalTimestamp(candidate.admissionEvaluatedAt) ||
      !canonicalTimestamp(candidate.plannedTrialStartsAt)) {
    reasons.push("INVALID_TIMESTAMP");
  } else {
    if (Date.parse(candidate.admissionEvaluatedAt) >= Date.parse(candidate.plannedTrialStartsAt)) {
      reasons.push("ADMISSION_NOT_BEFORE_PLANNED_START");
    }
    if (canonicalTimestamp(policy.mainRunStartsAt) &&
        Date.parse(candidate.plannedTrialStartsAt) < Date.parse(policy.mainRunStartsAt)) {
      reasons.push("PLANNED_START_BEFORE_MAIN_BOUNDARY");
    }
  }

  let run: ReturnType<typeof verifyRunSpecification> | null = null;
  try {
    run = verifyRunSpecification(candidate.runSpecification);
  } catch {
    reasons.push("INVALID_RUN_SPECIFICATION");
  }
  let assignment: FrozenAssignment | null = null;
  if (run !== null) {
    if (!validateMainCollectionReadiness(run).ready) reasons.push("RUN_NOT_COLLECTION_READY");
    try {
      assignment = verifyFrozenAssignment(candidate.frozenAssignment, run);
    } catch {
      reasons.push("INVALID_FROZEN_ASSIGNMENT");
    }
    const policyMatchesRun = policy.runSpecificationId === run.runSpecificationId &&
      policy.runSpecificationHash === run.runSpecificationHash &&
      policy.codeRevision === run.codeRevision &&
      policy.scenarioId === run.scenarioId &&
      policy.scenarioVersion === run.scenarioVersion;
    if (!policyMatchesRun) reasons.push("POLICY_IDENTITY_MISMATCH");
  }

  if (!BINDING_FIELDS.every((field) => candidate.executionBinding[field] === policy[field])) {
    reasons.push("EXECUTION_BINDING_MISMATCH");
  }

  let expectation: ProvenanceExpectation | null = null;
  if (run !== null && assignment !== null) {
    const definition = assignment.assignmentDefinition;
    const matchingPrompt = run.promptSet.filter((prompt) =>
      prompt.promptId === definition.promptId &&
      prompt.promptHash === definition.promptHash &&
      prompt.condition === definition.condition);
    const contentMatches = policy.assignmentDefinitionId === definition.assignmentDefinitionId &&
      policy.frozenAssignmentId === assignment.frozenAssignmentId &&
      policy.frozenAssignmentHash === assignment.frozenAssignmentHash &&
      policy.modelConfigurationId === definition.modelConfigurationId &&
      policy.promptId === definition.promptId &&
      policy.promptHash === definition.promptHash &&
      matchingPrompt.length === 1;
    if (!contentMatches) reasons.push("ASSIGNMENT_CONTENT_MISMATCH");
    expectation = {
      runSpecificationId: run.runSpecificationId,
      runSpecificationHash: run.runSpecificationHash,
      codeRevision: run.codeRevision,
      scheduledTrialId: definition.scheduledTrialId,
      condition: definition.condition,
      promptId: definition.promptId,
      promptHash: definition.promptHash,
      modelConfigurationId: definition.modelConfigurationId,
      optionalProviderFields: frozenArray(policy.optionalProviderFields),
      optionalUnavailableReasonCodes: frozenArray(policy.optionalUnavailableReasonCodes),
    };
  }

  return admission(
    policy,
    candidate,
    reasons.length === 0 ? "MAIN_AUTHORIZED" : "EXCLUDED",
    reasons,
    expectation,
  );
}

export function classifyRecordedTrial(
  admissionRecord: PreExecutionAdmission,
  actualStartedAt: string,
  observedProvenance: ObservedProvenanceMetadata,
): DataClassification {
  const provenance = admissionRecord.provenanceExpectation === null
    ? null
    : validateProvenanceCompleteness(admissionRecord.provenanceExpectation, observedProvenance);
  const reasons = [...admissionRecord.reasonCodes];

  if (admissionRecord.status === "PILOT_ONLY") {
    return Object.freeze({ dataClass: "PILOT", reasonCodes: frozenArray(reasons), provenance });
  }
  if (admissionRecord.status !== "MAIN_AUTHORIZED") {
    return Object.freeze({ dataClass: "EXCLUDED", reasonCodes: frozenArray(reasons), provenance });
  }
  if (!canonicalTimestamp(actualStartedAt) || !canonicalTimestamp(admissionRecord.admissionEvaluatedAt)) {
    reasons.push("INVALID_TIMESTAMP");
  } else {
    if (Date.parse(actualStartedAt) <= Date.parse(admissionRecord.admissionEvaluatedAt)) {
      reasons.push("ACTUAL_START_BEFORE_ADMISSION");
    }
    if (Date.parse(actualStartedAt) < Date.parse(admissionRecord.mainRunStartsAt)) {
      reasons.push("ACTUAL_START_BEFORE_MAIN_BOUNDARY");
    }
  }
  if (provenance === null || !admissionRecord.acceptedProvenanceStates.includes(provenance.state)) {
    reasons.push("PROVENANCE_NOT_ACCEPTED");
  }
  return Object.freeze({
    dataClass: reasons.length === 0 ? "MAIN" : "EXCLUDED",
    reasonCodes: frozenArray(reasons),
    provenance,
  });
}
