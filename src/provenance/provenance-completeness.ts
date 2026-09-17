export const PROVENANCE_COMPLETENESS_SCHEMA_VERSION = "provenance-completeness-v0.1";

export type ProvenanceCompletenessState =
  | "COMPLETE"
  | "INCOMPLETE_OPTIONAL"
  | "INTEGRITY_INVALID"
  | "REVIEW_REQUIRED";

export type ProvenanceCompletenessReasonCode =
  | "OPTIONAL_METADATA_UNAVAILABLE"
  | "OPTIONAL_METADATA_MISSING"
  | "MISSING_REQUIRED_EVIDENCE"
  | "AMBIGUOUS_REQUIRED_EVIDENCE"
  | "CONFLICTING_REQUIRED_EVIDENCE"
  | "CONFLICTING_OPTIONAL_METADATA"
  | "DUPLICATE_OPTIONAL_METADATA"
  | "INVALID_OPTIONAL_UNAVAILABLE_REASON"
  | "WRONG_RUN_SPECIFICATION"
  | "WRONG_CODE_REVISION"
  | "WRONG_SCHEDULED_TRIAL"
  | "WRONG_CONDITION"
  | "WRONG_PROMPT_ID"
  | "WRONG_PROMPT_HASH"
  | "WRONG_MODEL_CONFIGURATION"
  | "INVALID_ATTEMPT_LINKAGE"
  | "UNAPPROVED_OPTIONAL_METADATA";

export interface ProvenanceExpectation {
  readonly runSpecificationId: string;
  readonly runSpecificationHash: string;
  readonly codeRevision: string;
  readonly scheduledTrialId: string;
  readonly condition: string;
  readonly promptId: string;
  readonly promptHash: string;
  readonly modelConfigurationId: string;
  readonly optionalProviderFields: readonly string[];
  readonly optionalUnavailableReasonCodes: readonly string[];
}

export type RequiredEvidence<T> =
  | Readonly<{ state: "PRESENT"; value: T }>
  | Readonly<{ state: "MISSING" }>
  | Readonly<{ state: "AMBIGUOUS"; evidenceReferences: readonly string[] }>
  | Readonly<{
      state: "CONFLICTING";
      observedValues: readonly T[];
      evidenceReferences: readonly string[];
    }>;

export type OptionalMetadataEvidence =
  | Readonly<{ field: string; state: "PRESENT"; value: unknown }>
  | Readonly<{ field: string; state: "UNAVAILABLE"; reasonCode: string }>
  | Readonly<{ field: string; state: "MISSING" }>
  | Readonly<{ field: string; state: "CONFLICTING"; observedValues: readonly unknown[] }>;

export interface AttemptLinkEvidence {
  readonly trialAttemptId: string;
  readonly scheduledTrialId: string;
  readonly runSpecificationId: string;
  readonly runSpecificationHash: string;
  readonly attemptNumber: number;
  readonly replacementForAttemptId: string | null;
}

export interface AttemptChainEvidence {
  readonly currentTrialAttemptId: string;
  readonly attempts: readonly AttemptLinkEvidence[];
}

export interface ObservedProvenanceMetadata {
  readonly runSpecificationId: RequiredEvidence<string>;
  readonly runSpecificationHash: RequiredEvidence<string>;
  readonly codeRevision: RequiredEvidence<string>;
  readonly scheduledTrialId: RequiredEvidence<string>;
  readonly condition: RequiredEvidence<string>;
  readonly promptId: RequiredEvidence<string>;
  readonly promptHash: RequiredEvidence<string>;
  readonly modelConfigurationId: RequiredEvidence<string>;
  readonly attemptChain: AttemptChainEvidence;
  readonly optionalProviderMetadata: readonly OptionalMetadataEvidence[];
}

export interface ProvenanceCompletenessResult {
  readonly schemaVersion: typeof PROVENANCE_COMPLETENESS_SCHEMA_VERSION;
  readonly state: ProvenanceCompletenessState;
  readonly reasonCodes: readonly ProvenanceCompletenessReasonCode[];
}

function addUnique(
  reasons: ProvenanceCompletenessReasonCode[],
  reason: ProvenanceCompletenessReasonCode,
): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function compareEvidence(
  evidence: RequiredEvidence<string> | undefined,
  expected: string,
  mismatchReason: ProvenanceCompletenessReasonCode,
  invalid: ProvenanceCompletenessReasonCode[],
  review: ProvenanceCompletenessReasonCode[],
): void {
  if (evidence === undefined || evidence.state === "MISSING") {
    addUnique(invalid, "MISSING_REQUIRED_EVIDENCE");
  } else if (evidence.state === "AMBIGUOUS") {
    addUnique(review, "AMBIGUOUS_REQUIRED_EVIDENCE");
  } else if (evidence.state === "CONFLICTING") {
    addUnique(invalid, "CONFLICTING_REQUIRED_EVIDENCE");
  } else if (evidence.state === "PRESENT") {
    if (evidence.value !== expected) addUnique(invalid, mismatchReason);
  } else {
    addUnique(invalid, "MISSING_REQUIRED_EVIDENCE");
  }
}

function attemptChainIsValid(
  chain: AttemptChainEvidence | undefined,
  expected: ProvenanceExpectation,
): boolean {
  if (chain === undefined || !Array.isArray(chain.attempts) || chain.attempts.length === 0) return false;
  const ids = new Set<string>();
  for (let index = 0; index < chain.attempts.length; index += 1) {
    const attempt = chain.attempts[index];
    if (attempt === undefined || attempt.trialAttemptId.length === 0 || ids.has(attempt.trialAttemptId)) return false;
    ids.add(attempt.trialAttemptId);
    if (attempt.attemptNumber !== index + 1 || attempt.scheduledTrialId !== expected.scheduledTrialId ||
        attempt.runSpecificationId !== expected.runSpecificationId || attempt.runSpecificationHash !== expected.runSpecificationHash) return false;
    const previous = chain.attempts[index - 1];
    if (index === 0) {
      if (attempt.replacementForAttemptId !== null) return false;
    } else if (previous === undefined || attempt.replacementForAttemptId !== previous.trialAttemptId || attempt.replacementForAttemptId === attempt.trialAttemptId) {
      return false;
    }
  }
  return chain.currentTrialAttemptId === chain.attempts.at(-1)?.trialAttemptId;
}

function validateOptionalEvidence(
  expected: ProvenanceExpectation,
  observed: readonly OptionalMetadataEvidence[] | undefined,
  invalid: ProvenanceCompletenessReasonCode[],
  incomplete: ProvenanceCompletenessReasonCode[],
): void {
  const entries = Array.isArray(observed) ? observed : [];
  const expectedFields = new Set(expected.optionalProviderFields);
  const grouped = new Map<string, OptionalMetadataEvidence[]>();
  for (const entry of entries) {
    if (!expectedFields.has(entry.field)) {
      addUnique(invalid, "UNAPPROVED_OPTIONAL_METADATA");
      continue;
    }
    const values = grouped.get(entry.field) ?? [];
    values.push(entry);
    grouped.set(entry.field, values);
  }
  for (const field of expected.optionalProviderFields) {
    const values = grouped.get(field) ?? [];
    if (values.length === 0) {
      addUnique(incomplete, "OPTIONAL_METADATA_MISSING");
      continue;
    }
    if (values.length !== 1) {
      addUnique(invalid, "DUPLICATE_OPTIONAL_METADATA");
      continue;
    }
    const evidence = values[0] as OptionalMetadataEvidence;
    if (evidence.state === "MISSING") {
      addUnique(incomplete, "OPTIONAL_METADATA_MISSING");
    } else if (evidence.state === "UNAVAILABLE") {
      if (!expected.optionalUnavailableReasonCodes.includes(evidence.reasonCode)) {
        addUnique(invalid, "INVALID_OPTIONAL_UNAVAILABLE_REASON");
      } else {
        addUnique(incomplete, "OPTIONAL_METADATA_UNAVAILABLE");
      }
    } else if (evidence.state === "CONFLICTING") {
      addUnique(invalid, "CONFLICTING_OPTIONAL_METADATA");
    } else if (evidence.state !== "PRESENT") {
      addUnique(invalid, "CONFLICTING_OPTIONAL_METADATA");
    }
  }
}

export function validateProvenanceCompleteness(
  expected: ProvenanceExpectation,
  observed: ObservedProvenanceMetadata,
): ProvenanceCompletenessResult {
  const invalid: ProvenanceCompletenessReasonCode[] = [];
  const review: ProvenanceCompletenessReasonCode[] = [];
  const incomplete: ProvenanceCompletenessReasonCode[] = [];
  compareEvidence(observed?.runSpecificationId, expected.runSpecificationId, "WRONG_RUN_SPECIFICATION", invalid, review);
  compareEvidence(observed?.runSpecificationHash, expected.runSpecificationHash, "WRONG_RUN_SPECIFICATION", invalid, review);
  compareEvidence(observed?.codeRevision, expected.codeRevision, "WRONG_CODE_REVISION", invalid, review);
  compareEvidence(observed?.scheduledTrialId, expected.scheduledTrialId, "WRONG_SCHEDULED_TRIAL", invalid, review);
  compareEvidence(observed?.condition, expected.condition, "WRONG_CONDITION", invalid, review);
  compareEvidence(observed?.promptId, expected.promptId, "WRONG_PROMPT_ID", invalid, review);
  compareEvidence(observed?.promptHash, expected.promptHash, "WRONG_PROMPT_HASH", invalid, review);
  compareEvidence(observed?.modelConfigurationId, expected.modelConfigurationId, "WRONG_MODEL_CONFIGURATION", invalid, review);
  if (!attemptChainIsValid(observed?.attemptChain, expected)) addUnique(invalid, "INVALID_ATTEMPT_LINKAGE");
  validateOptionalEvidence(expected, observed?.optionalProviderMetadata, invalid, incomplete);

  const [state, reasons]: [ProvenanceCompletenessState, ProvenanceCompletenessReasonCode[]] =
    invalid.length > 0 ? ["INTEGRITY_INVALID", invalid] :
    review.length > 0 ? ["REVIEW_REQUIRED", review] :
    incomplete.length > 0 ? ["INCOMPLETE_OPTIONAL", incomplete] :
    ["COMPLETE", []];
  return Object.freeze({
    schemaVersion: PROVENANCE_COMPLETENESS_SCHEMA_VERSION,
    state,
    reasonCodes: Object.freeze(reasons),
  });
}
