import {
  CANONICAL_HASH_CONTRACT_VERSION,
  canonicalJson,
  deepFreezeCanonical,
  sha256CanonicalJson,
} from "./canonical-json.js";
import type { CanonicalJsonValue } from "./canonical-json.js";
import {
  FREEZE_DECISION_CATALOG,
  FREEZE_DECISION_CATALOG_VERSION,
  freezeDecisionRegistryIssues,
  verifyFreezeDecisionRegistry,
} from "./freeze-decisions.js";
import type {
  FreezeDecisionGate,
  FreezeDecisionId,
  FreezeDecisionRegistry,
} from "./freeze-decisions.js";
import {
  CONTENT_HASH_ALGORITHM,
  verifyModelConfigurationRecord,
} from "./model-configuration.js";
import type { ModelConfigurationRecord } from "./model-configuration.js";

export const RUN_SPECIFICATION_SCHEMA_VERSION = "run-specification-v0.1";
export const ASSIGNMENT_DEFINITION_SCHEMA_VERSION = "assignment-definition-v0.1";
export const FROZEN_ASSIGNMENT_SCHEMA_VERSION = "frozen-assignment-v0.2";

export type ResolutionState<T extends CanonicalJsonValue> =
  | Readonly<{ state: "RESOLVED"; value: T }>
  | Readonly<{ state: "UNRESOLVED" }>;

export interface PromptSetRecord {
  readonly promptId: string;
  readonly promptHash: string;
  readonly promptVersion: string;
  readonly condition: string;
}

export interface AssignmentDefinitionInput {
  readonly scheduledTrialId: string;
  readonly condition: string;
  readonly promptId: string;
  readonly promptHash: string;
  readonly promptVersion: string;
  readonly modelConfigurationId: string;
  readonly repetitionIndex: number;
  readonly orderingAssignment: number;
  readonly randomizationAssignment: ResolutionState<CanonicalJsonValue>;
  readonly randomizationBlock: ResolutionState<CanonicalJsonValue>;
}

export interface AssignmentDefinition extends AssignmentDefinitionInput {
  readonly schemaVersion: typeof ASSIGNMENT_DEFINITION_SCHEMA_VERSION;
  readonly hashAlgorithm: typeof CONTENT_HASH_ALGORITHM;
  readonly canonicalHashContractVersion: typeof CANONICAL_HASH_CONTRACT_VERSION;
  readonly assignmentDefinitionId: string;
  readonly assignmentDefinitionHash: string;
}

export interface RunSpecificationInput {
  readonly benchmarkVersion: string;
  readonly scenarioId: string;
  readonly scenarioVersion: string;
  readonly freezeSpecification: Readonly<{ id: string; version: string }>;
  readonly codeRevision: string;
  readonly createdAt: string;
  readonly promptSet: readonly PromptSetRecord[];
  readonly modelConfigurations: readonly ModelConfigurationRecord[];
  readonly assignmentDefinitions: readonly AssignmentDefinition[];
  readonly freezeDecisions: FreezeDecisionRegistry;
}

export interface RunSpecification extends RunSpecificationInput {
  readonly schemaVersion: typeof RUN_SPECIFICATION_SCHEMA_VERSION;
  readonly hashAlgorithm: typeof CONTENT_HASH_ALGORITHM;
  readonly canonicalHashContractVersion: typeof CANONICAL_HASH_CONTRACT_VERSION;
  readonly freezeDecisionCatalogVersion: typeof FREEZE_DECISION_CATALOG_VERSION;
  readonly runSpecificationId: string;
  readonly runSpecificationHash: string;
}

declare const verifiedRunSpecificationBrand: unique symbol;
export type VerifiedRunSpecification = RunSpecification & {
  readonly [verifiedRunSpecificationBrand]: true;
};

export interface FrozenAssignment {
  readonly schemaVersion: typeof FROZEN_ASSIGNMENT_SCHEMA_VERSION;
  readonly hashAlgorithm: typeof CONTENT_HASH_ALGORITHM;
  readonly canonicalHashContractVersion: typeof CANONICAL_HASH_CONTRACT_VERSION;
  readonly frozenAssignmentId: string;
  readonly frozenAssignmentHash: string;
  readonly assignmentDefinition: AssignmentDefinition;
  readonly runSpecificationId: string;
  readonly runSpecificationHash: string;
}

export type ReadinessReasonCode =
  | "INVALID_RUN_SPECIFICATION"
  | "UNRESOLVED_MODEL_CONFIGURATION_SETTING"
  | "UNRESOLVED_ASSIGNMENT_RANDOMIZATION"
  | "UNRESOLVED_ASSIGNMENT_BLOCK"
  | `MISSING_FREEZE_DECISION:${FreezeDecisionId}`
  | `EXTRA_FREEZE_DECISION:${string}`
  | `INVALID_FREEZE_DECISION:${string}`
  | `INVALID_NOT_APPLICABLE:${FreezeDecisionId}`
  | `UNRESOLVED_FREEZE_DECISION:${FreezeDecisionId}`;

export interface ReadinessResult {
  readonly ready: boolean;
  readonly reasonCodes: readonly ReadinessReasonCode[];
}

const ASSIGNMENT_INPUT_KEYS = Object.freeze([
  "scheduledTrialId", "condition", "promptId", "promptHash", "promptVersion",
  "modelConfigurationId", "repetitionIndex", "orderingAssignment",
  "randomizationAssignment", "randomizationBlock",
]);
const ASSIGNMENT_RECORD_KEYS = Object.freeze([
  ...ASSIGNMENT_INPUT_KEYS,
  "schemaVersion", "hashAlgorithm", "canonicalHashContractVersion",
  "assignmentDefinitionId", "assignmentDefinitionHash",
]);
const RUN_INPUT_KEYS = Object.freeze([
  "benchmarkVersion", "scenarioId", "scenarioVersion", "freezeSpecification",
  "codeRevision", "createdAt", "promptSet", "modelConfigurations",
  "assignmentDefinitions", "freezeDecisions",
]);
const RUN_RECORD_KEYS = Object.freeze([
  ...RUN_INPUT_KEYS,
  "schemaVersion", "hashAlgorithm", "canonicalHashContractVersion",
  "freezeDecisionCatalogVersion", "runSpecificationId", "runSpecificationHash",
]);
const FROZEN_ASSIGNMENT_KEYS = Object.freeze([
  "schemaVersion", "hashAlgorithm", "canonicalHashContractVersion",
  "frozenAssignmentId", "frozenAssignmentHash", "assignmentDefinition",
  "runSpecificationId", "runSpecificationHash",
]);
const PROMPT_KEYS = Object.freeze(["promptId", "promptHash", "promptVersion", "condition"]);

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be a plain record`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], name: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${name} has missing or unknown fields`);
  }
}

function requireString(name: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a nonempty string`);
  }
}

function requireHash(name: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(`${name} must be a lowercase SHA-256 hash`);
  }
}

function validateResolutionState(name: string, value: unknown): ResolutionState<CanonicalJsonValue> {
  const state = asRecord(value, name);
  if (state.state === "UNRESOLVED") {
    exactKeys(state, ["state"], name);
  } else if (state.state === "RESOLVED") {
    exactKeys(state, ["state", "value"], name);
    canonicalJson(state.value as CanonicalJsonValue);
  } else {
    throw new TypeError(`${name} has an invalid state`);
  }
  return state as unknown as ResolutionState<CanonicalJsonValue>;
}

function assignmentInput(value: unknown): AssignmentDefinitionInput {
  const input = asRecord(value, "Assignment definition input");
  exactKeys(input, ASSIGNMENT_INPUT_KEYS, "Assignment definition input");
  for (const key of ["scheduledTrialId", "condition", "promptId", "promptVersion", "modelConfigurationId"] as const) {
    requireString(key, input[key]);
  }
  requireHash("promptHash", input.promptHash);
  if (!Number.isInteger(input.repetitionIndex) || (input.repetitionIndex as number) < 1) {
    throw new TypeError("repetitionIndex must be a positive integer");
  }
  if (!Number.isInteger(input.orderingAssignment) || (input.orderingAssignment as number) < 1) {
    throw new TypeError("orderingAssignment must be a positive integer");
  }
  validateResolutionState("randomizationAssignment", input.randomizationAssignment);
  validateResolutionState("randomizationBlock", input.randomizationBlock);
  return input as unknown as AssignmentDefinitionInput;
}

function assignmentHashContent(input: AssignmentDefinitionInput): CanonicalJsonValue {
  return {
    schemaVersion: ASSIGNMENT_DEFINITION_SCHEMA_VERSION,
    hashAlgorithm: CONTENT_HASH_ALGORITHM,
    canonicalHashContractVersion: CANONICAL_HASH_CONTRACT_VERSION,
    scheduledTrialId: input.scheduledTrialId,
    condition: input.condition,
    promptId: input.promptId,
    promptHash: input.promptHash,
    promptVersion: input.promptVersion,
    modelConfigurationId: input.modelConfigurationId,
    repetitionIndex: input.repetitionIndex,
    orderingAssignment: input.orderingAssignment,
    randomizationAssignment: input.randomizationAssignment,
    randomizationBlock: input.randomizationBlock,
  } as unknown as CanonicalJsonValue;
}

function assignmentId(hash: string): string {
  return `${ASSIGNMENT_DEFINITION_SCHEMA_VERSION}:${CONTENT_HASH_ALGORITHM}:${hash}`;
}

export function createAssignmentDefinition(value: AssignmentDefinitionInput): AssignmentDefinition {
  const input = assignmentInput(value);
  const content = assignmentHashContent(input);
  const assignmentDefinitionHash = sha256CanonicalJson(content);
  return deepFreezeCanonical({
    ...(content as Record<string, CanonicalJsonValue>),
    assignmentDefinitionId: assignmentId(assignmentDefinitionHash),
    assignmentDefinitionHash,
  }) as unknown as AssignmentDefinition;
}

export function verifyAssignmentDefinition(value: unknown): AssignmentDefinition {
  const record = asRecord(value, "Assignment definition");
  exactKeys(record, ASSIGNMENT_RECORD_KEYS, "Assignment definition");
  if (record.schemaVersion !== ASSIGNMENT_DEFINITION_SCHEMA_VERSION) throw new TypeError("Unsupported assignment definition schema");
  if (record.hashAlgorithm !== CONTENT_HASH_ALGORITHM) throw new TypeError("Unsupported assignment hash algorithm");
  if (record.canonicalHashContractVersion !== CANONICAL_HASH_CONTRACT_VERSION) throw new TypeError("Unsupported assignment canonical hash contract");
  const input = assignmentInput(Object.fromEntries(ASSIGNMENT_INPUT_KEYS.map((key) => [key, record[key]])));
  const expectedHash = sha256CanonicalJson(assignmentHashContent(input));
  if (record.assignmentDefinitionHash !== expectedHash) throw new TypeError("Assignment definition hash does not match content");
  if (record.assignmentDefinitionId !== assignmentId(expectedHash)) throw new TypeError("Assignment definition ID does not match verified hash");
  return deepFreezeCanonical(record as unknown as CanonicalJsonValue) as unknown as AssignmentDefinition;
}

function verifyPrompt(value: unknown): PromptSetRecord {
  const prompt = asRecord(value, "Prompt record");
  exactKeys(prompt, PROMPT_KEYS, "Prompt record");
  for (const key of ["promptId", "promptVersion", "condition"] as const) requireString(key, prompt[key]);
  requireHash("promptHash", prompt.promptHash);
  return deepFreezeCanonical(prompt as unknown as CanonicalJsonValue) as unknown as PromptSetRecord;
}

function normalizeRunInput(value: unknown, exact: boolean): RunSpecificationInput {
  const input = asRecord(value, "Run specification input");
  if (exact) exactKeys(input, RUN_INPUT_KEYS, "Run specification input");
  for (const key of ["benchmarkVersion", "scenarioId", "scenarioVersion", "codeRevision", "createdAt"] as const) requireString(key, input[key]);
  if (!/^[a-f0-9]{40}$/.test(input.codeRevision as string)) throw new TypeError("codeRevision must be a lowercase 40-character Git SHA");
  if (Number.isNaN(Date.parse(input.createdAt as string)) || new Date(input.createdAt as string).toISOString() !== input.createdAt) {
    throw new TypeError("createdAt must be a canonical UTC ISO timestamp");
  }
  const freezeSpecification = asRecord(input.freezeSpecification, "freezeSpecification");
  exactKeys(freezeSpecification, ["id", "version"], "freezeSpecification");
  requireString("freezeSpecification.id", freezeSpecification.id);
  requireString("freezeSpecification.version", freezeSpecification.version);
  if (!Array.isArray(input.promptSet) || input.promptSet.length === 0) throw new TypeError("promptSet must not be empty");
  if (!Array.isArray(input.modelConfigurations) || input.modelConfigurations.length === 0) throw new TypeError("modelConfigurations must not be empty");
  if (!Array.isArray(input.assignmentDefinitions) || input.assignmentDefinitions.length === 0) throw new TypeError("assignmentDefinitions must not be empty");

  const promptSet = input.promptSet.map(verifyPrompt);
  const modelConfigurations = input.modelConfigurations.map(verifyModelConfigurationRecord);
  const assignmentDefinitions = input.assignmentDefinitions.map(verifyAssignmentDefinition);
  const freezeDecisions = verifyFreezeDecisionRegistry(input.freezeDecisions);

  const promptIds = new Set<string>();
  for (const prompt of promptSet) {
    if (promptIds.has(prompt.promptId)) throw new TypeError("Duplicate or conflicting prompt ID");
    promptIds.add(prompt.promptId);
  }
  const modelIds = new Set<string>();
  for (const model of modelConfigurations) {
    if (modelIds.has(model.modelConfigurationId)) throw new TypeError("Duplicate model configuration ID");
    modelIds.add(model.modelConfigurationId);
  }
  const definitionIds = new Set<string>();
  const scheduledIds = new Set<string>();
  for (const definition of assignmentDefinitions) {
    if (definitionIds.has(definition.assignmentDefinitionId)) throw new TypeError("Duplicate assignment definition ID");
    if (scheduledIds.has(definition.scheduledTrialId)) throw new TypeError("Duplicate scheduledTrialId");
    definitionIds.add(definition.assignmentDefinitionId);
    scheduledIds.add(definition.scheduledTrialId);
    const prompts = promptSet.filter((prompt) => prompt.promptId === definition.promptId);
    if (prompts.length !== 1 || prompts[0]?.promptHash !== definition.promptHash || prompts[0]?.promptVersion !== definition.promptVersion || prompts[0]?.condition !== definition.condition) {
      throw new TypeError("Assignment definition prompt does not resolve to exactly one matching prompt");
    }
    if (!modelIds.has(definition.modelConfigurationId)) {
      throw new TypeError("Assignment definition model configuration is unresolved");
    }
  }
  return deepFreezeCanonical({
    benchmarkVersion: input.benchmarkVersion as string,
    scenarioId: input.scenarioId as string,
    scenarioVersion: input.scenarioVersion as string,
    freezeSpecification,
    codeRevision: input.codeRevision as string,
    createdAt: input.createdAt as string,
    promptSet,
    modelConfigurations,
    assignmentDefinitions,
    freezeDecisions,
  } as unknown as CanonicalJsonValue) as unknown as RunSpecificationInput;
}

function runHashContent(input: RunSpecificationInput): CanonicalJsonValue {
  return {
    schemaVersion: RUN_SPECIFICATION_SCHEMA_VERSION,
    hashAlgorithm: CONTENT_HASH_ALGORITHM,
    canonicalHashContractVersion: CANONICAL_HASH_CONTRACT_VERSION,
    freezeDecisionCatalogVersion: FREEZE_DECISION_CATALOG_VERSION,
    benchmarkVersion: input.benchmarkVersion,
    scenarioId: input.scenarioId,
    scenarioVersion: input.scenarioVersion,
    freezeSpecification: input.freezeSpecification,
    codeRevision: input.codeRevision,
    createdAt: input.createdAt,
    promptSet: input.promptSet,
    modelConfigurations: input.modelConfigurations,
    assignmentDefinitions: input.assignmentDefinitions,
    freezeDecisions: input.freezeDecisions,
  } as unknown as CanonicalJsonValue;
}

function runId(hash: string): string {
  return `${RUN_SPECIFICATION_SCHEMA_VERSION}:${CONTENT_HASH_ALGORITHM}:${hash}`;
}

export function recalculateRunSpecificationHash(value: RunSpecificationInput | RunSpecification): string {
  const input = normalizeRunInput(Object.fromEntries(RUN_INPUT_KEYS.map((key) => [key, (value as unknown as Record<string, unknown>)[key]])), true);
  return sha256CanonicalJson(runHashContent(input));
}

export function createRunSpecification(value: RunSpecificationInput): VerifiedRunSpecification {
  const input = normalizeRunInput(value, true);
  const hashContent = runHashContent(input);
  const runSpecificationHash = sha256CanonicalJson(hashContent);
  const record = deepFreezeCanonical({
    ...(hashContent as Record<string, CanonicalJsonValue>),
    runSpecificationId: runId(runSpecificationHash),
    runSpecificationHash,
  }) as unknown as RunSpecification;
  return verifyRunSpecification(record);
}

export function verifyRunSpecification(value: unknown): VerifiedRunSpecification {
  const record = asRecord(value, "Run specification");
  exactKeys(record, RUN_RECORD_KEYS, "Run specification");
  if (record.schemaVersion !== RUN_SPECIFICATION_SCHEMA_VERSION) throw new TypeError("Unsupported run specification schema");
  if (record.hashAlgorithm !== CONTENT_HASH_ALGORITHM) throw new TypeError("Unsupported run specification hash algorithm");
  if (record.canonicalHashContractVersion !== CANONICAL_HASH_CONTRACT_VERSION) throw new TypeError("Unsupported run canonical hash contract");
  if (record.freezeDecisionCatalogVersion !== FREEZE_DECISION_CATALOG_VERSION) throw new TypeError("Unsupported freeze decision catalog version");
  const input = normalizeRunInput(Object.fromEntries(RUN_INPUT_KEYS.map((key) => [key, record[key]])), true);
  const expectedHash = sha256CanonicalJson(runHashContent(input));
  if (record.runSpecificationHash !== expectedHash) throw new TypeError("Run specification hash does not match content");
  if (record.runSpecificationId !== runId(expectedHash)) throw new TypeError("Run specification ID does not match verified hash");
  return deepFreezeCanonical(record as unknown as CanonicalJsonValue) as unknown as VerifiedRunSpecification;
}

function frozenAssignmentHashContent(
  definition: AssignmentDefinition,
  run: VerifiedRunSpecification,
): CanonicalJsonValue {
  return {
    schemaVersion: FROZEN_ASSIGNMENT_SCHEMA_VERSION,
    hashAlgorithm: CONTENT_HASH_ALGORITHM,
    canonicalHashContractVersion: CANONICAL_HASH_CONTRACT_VERSION,
    assignmentDefinition: definition,
    runSpecificationId: run.runSpecificationId,
    runSpecificationHash: run.runSpecificationHash,
  } as unknown as CanonicalJsonValue;
}

function frozenAssignmentId(hash: string): string {
  return `${FROZEN_ASSIGNMENT_SCHEMA_VERSION}:${CONTENT_HASH_ALGORITHM}:${hash}`;
}

export function materializeFrozenAssignment(
  value: VerifiedRunSpecification,
  assignmentDefinitionId: string,
): FrozenAssignment {
  const run = verifyRunSpecification(value);
  const matches = run.assignmentDefinitions.filter((definition) => definition.assignmentDefinitionId === assignmentDefinitionId);
  if (matches.length !== 1) throw new TypeError("Assignment definition is not uniquely present in verified run specification");
  const definition = matches[0] as AssignmentDefinition;
  const content = frozenAssignmentHashContent(definition, run);
  const frozenAssignmentHash = sha256CanonicalJson(content);
  return deepFreezeCanonical({
    ...(content as Record<string, CanonicalJsonValue>),
    frozenAssignmentId: frozenAssignmentId(frozenAssignmentHash),
    frozenAssignmentHash,
  }) as unknown as FrozenAssignment;
}

export function verifyFrozenAssignment(
  value: unknown,
  parent: unknown,
): FrozenAssignment {
  const run = verifyRunSpecification(parent);
  const record = asRecord(value, "Frozen assignment");
  exactKeys(record, FROZEN_ASSIGNMENT_KEYS, "Frozen assignment");
  if (record.schemaVersion !== FROZEN_ASSIGNMENT_SCHEMA_VERSION) throw new TypeError("Unsupported frozen assignment schema");
  if (record.hashAlgorithm !== CONTENT_HASH_ALGORITHM) throw new TypeError("Unsupported frozen assignment hash algorithm");
  if (record.canonicalHashContractVersion !== CANONICAL_HASH_CONTRACT_VERSION) throw new TypeError("Unsupported frozen assignment canonical hash contract");
  const definition = verifyAssignmentDefinition(record.assignmentDefinition);
  const matches = run.assignmentDefinitions.filter((candidate) => candidate.assignmentDefinitionId === definition.assignmentDefinitionId);
  if (matches.length !== 1 || canonicalJson(matches[0] as unknown as CanonicalJsonValue) !== canonicalJson(definition as unknown as CanonicalJsonValue)) {
    throw new TypeError("Frozen assignment definition does not match parent run specification");
  }
  if (record.runSpecificationId !== run.runSpecificationId || record.runSpecificationHash !== run.runSpecificationHash) {
    throw new TypeError("Frozen assignment parent run specification does not match");
  }
  const expectedHash = sha256CanonicalJson(frozenAssignmentHashContent(definition, run));
  if (record.frozenAssignmentHash !== expectedHash) throw new TypeError("Frozen assignment hash does not match binding content");
  if (record.frozenAssignmentId !== frozenAssignmentId(expectedHash)) throw new TypeError("Frozen assignment ID does not match verified hash");
  return deepFreezeCanonical(record as unknown as CanonicalJsonValue) as unknown as FrozenAssignment;
}

const gateRank: Readonly<Record<FreezeDecisionGate, number>> = Object.freeze({ ASSIGNMENT: 1, COLLECTION: 2, ANALYSIS: 3 });

function validateReadiness(value: unknown, maximumGate: FreezeDecisionGate): ReadinessResult {
  const reasons: ReadinessReasonCode[] = [];
  const raw = value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
  for (const issue of freezeDecisionRegistryIssues(raw.freezeDecisions)) {
    reasons.push(`${issue.code}:${issue.decisionId}` as ReadinessReasonCode);
  }
  let run: VerifiedRunSpecification | null = null;
  try {
    run = verifyRunSpecification(value);
  } catch {
    reasons.push("INVALID_RUN_SPECIFICATION");
  }
  if (run !== null) {
    for (const id of Object.keys(FREEZE_DECISION_CATALOG) as FreezeDecisionId[]) {
      const entry = FREEZE_DECISION_CATALOG[id];
      if (gateRank[entry.gate] <= gateRank[maximumGate] && run.freezeDecisions[id].state === "UNRESOLVED") {
        reasons.push(`UNRESOLVED_FREEZE_DECISION:${id}`);
      }
    }
    if (gateRank[maximumGate] >= gateRank.ASSIGNMENT) {
      if (run.modelConfigurations.some((configuration) => Object.values(configuration.settings).some((setting) => setting.state === "UNRESOLVED"))) {
        reasons.push("UNRESOLVED_MODEL_CONFIGURATION_SETTING");
      }
      if (run.assignmentDefinitions.some((definition) => definition.randomizationAssignment.state === "UNRESOLVED")) {
        reasons.push("UNRESOLVED_ASSIGNMENT_RANDOMIZATION");
      }
      if (run.assignmentDefinitions.some((definition) => definition.randomizationBlock.state === "UNRESOLVED")) {
        reasons.push("UNRESOLVED_ASSIGNMENT_BLOCK");
      }
    }
  }
  return Object.freeze({ ready: reasons.length === 0, reasonCodes: Object.freeze([...new Set(reasons)]) });
}

export const validateAssignmentReadiness = (value: unknown): ReadinessResult => validateReadiness(value, "ASSIGNMENT");
export const validateMainCollectionReadiness = (value: unknown): ReadinessResult => validateReadiness(value, "COLLECTION");
export const validateAnalysisReadiness = (value: unknown): ReadinessResult => validateReadiness(value, "ANALYSIS");
export const validateMainDataReadiness = validateMainCollectionReadiness;
