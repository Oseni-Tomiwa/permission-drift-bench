import {
  CANONICAL_HASH_CONTRACT_VERSION,
  canonicalJson,
  deepFreezeCanonical,
  sha256CanonicalJson,
} from "./canonical-json.js";
import type { CanonicalJsonValue } from "./canonical-json.js";
import { verifyModelConfigurationRecord } from "./model-configuration.js";
import type { ModelConfigurationRecord, ProviderSetting } from "./model-configuration.js";
import { SCOPE_V01_CANDIDATE_FREEZE_DECISIONS } from "./scope-v0.1-candidate-freeze.js";
import {
  SCOPE_V01_CANDIDATE_MODEL_CONFIGURATIONS,
  SCOPE_V01_MODEL_LIVE_VALIDATION,
} from "./scope-v0.1-model-candidates.js";
import type { LiveValidationStatus, ScopeV01Provider } from "./scope-v0.1-model-candidates.js";

export { SCOPE_V01_CANDIDATE_MODEL_CONFIGURATIONS, SCOPE_V01_MODEL_LIVE_VALIDATION };

export const SCOPE_V01_ROSTER_SIGNOFF_SCHEMA_VERSION = "scope-v0.1-roster-signoff-v0.1";
export const PROVIDER_RETENTION_POSTURE_SCHEMA_VERSION = "provider-retention-posture-v0.1";
const HASH_ALGORITHM = "sha256";
const PROVIDERS = Object.freeze(["openai", "google", "anthropic"] as const);

type ModelConfigurationIds = Readonly<Record<ScopeV01Provider, string>>;

export interface ScopeV01RosterSignoffInput {
  readonly scope: "scope-v0.1";
  readonly modelConfigurationIds: ModelConfigurationIds;
  readonly decisions: Readonly<{
    googleApiSurface: Readonly<{
      decision: "KEEP_V1BETA";
      providerBackend: "Gemini Developer API";
      apiSurface: "interactions-v1beta";
      requestedModel: "gemini-3.8-flash";
      scope: "SCOPE_V0_1_FIRST_RUN_ONLY";
      acceptedLimitation: true;
      generality: "NOT_A_GENERAL_PREFERENCE_FOR_V1BETA";
      rationale: readonly [
        "CURRENT_ADAPTER_TARGETS_V1BETA",
        "CURRENT_TESTS_TARGET_V1BETA",
        "CONDITION_A_LIVE_PILOT_USED_V1BETA",
        "MIGRATION_CHANGES_CONFIGURATION_IDENTITY_AND_REQUIRES_REVALIDATION",
      ];
    }>;
    openaiModelIdentity: Readonly<{
      decision: "ACCEPT_DOCUMENTED_ID_WITHOUT_SEPARATE_DATED_SNAPSHOT";
      requestedModel: "gpt-6.1-sol";
      limitation: string;
      snapshotEquivalenceInferred: false;
    }>;
    googleModelIdentity: Readonly<{
      decision: "ACCEPT_STABLE_ID_WITHOUT_SEPARATE_DATED_SNAPSHOT";
      requestedModel: "gemini-3.8-flash";
      limitation: string;
      identifierClassification: "STABLE_NON_LATEST";
      datedEquivalenceInferred: false;
    }>;
    returnedModelPolicies: Readonly<{
      openai: "EXACT_REQUESTED_IF_PRESENT";
      google: "OBSERVE_SEPARATELY";
      anthropic: "EXACT_REQUESTED_IF_PRESENT";
      undocumentedAliasEquivalencePermitted: false;
    }>;
    anthropicModelIdentity: Readonly<{
      decision: "ACCEPT_DOCUMENTED_PINNED_IDENTIFIER";
      requestedModel: "claude-sonnet-5-5";
      separateDatedAliasRequired: false;
      subjectToFutureAuthoritativeEvidence: true;
    }>;
  }>;
}

export interface ScopeV01RosterSignoff extends ScopeV01RosterSignoffInput {
  readonly schemaVersion: typeof SCOPE_V01_ROSTER_SIGNOFF_SCHEMA_VERSION;
  readonly hashAlgorithm: typeof HASH_ALGORITHM;
  readonly canonicalHashContractVersion: typeof CANONICAL_HASH_CONTRACT_VERSION;
  readonly rosterSignoffId: string;
  readonly rosterSignoffHash: string;
}

export type RetentionEvidenceType =
  | "AUTHORITATIVE_DOCUMENTATION"
  | "USER_ATTESTATION"
  | "ACCOUNT_UI_VERIFICATION"
  | "ORGANIZATION_POLICY"
  | "UNVERIFIED";
export type RetentionEvidenceStatus = "VERIFIED" | "USER_ATTESTED" | "UNVERIFIED" | "NOT_APPLICABLE";
export type AccountRetentionStatus = "ZERO_DATA_RETENTION" | "STANDARD_PROVIDER_RETENTION" | "OTHER_DOCUMENTED_POSTURE" | "UNKNOWN" | "NOT_APPLICABLE";
export type ZeroDataRetentionStatus = "ENABLED" | "NOT_ENABLED" | "UNKNOWN" | "NOT_APPLICABLE";
export type RetentionReviewDecision = "ACCEPTED" | "UNRESOLVED" | "REJECTED";

export interface ProviderRetentionPosture {
  readonly schemaVersion: typeof PROVIDER_RETENTION_POSTURE_SCHEMA_VERSION;
  readonly provider: ScopeV01Provider;
  readonly modelConfigurationId: string;
  readonly organizationOrProjectReference: string | null;
  readonly requestLevelControlsVerified: boolean;
  readonly requestLevelControls: Readonly<{
    providerStorage: ProviderSetting;
    background: ProviderSetting;
    providerAddressableContinuationId: ProviderSetting;
    continuationStrategy: ProviderSetting;
  }>;
  readonly accountRetentionStatus: AccountRetentionStatus;
  readonly zeroDataRetentionStatus: ZeroDataRetentionStatus;
  readonly evidenceStatus: RetentionEvidenceStatus;
  readonly evidenceType: RetentionEvidenceType;
  readonly verifiedAt: string | null;
  readonly reviewDecision: RetentionReviewDecision;
  readonly notes: string;
}

export interface RetentionPostureGate {
  readonly status: RetentionReviewDecision;
  readonly reasonCodes: readonly string[];
}

const SIGNOFF_INPUT_KEYS = Object.freeze(["scope", "modelConfigurationIds", "decisions"]);
const SIGNOFF_RECORD_KEYS = Object.freeze([
  "schemaVersion", "hashAlgorithm", "canonicalHashContractVersion", "rosterSignoffId", "rosterSignoffHash",
  ...SIGNOFF_INPUT_KEYS,
]);
const SIGNOFF_DECISION_KEYS = Object.freeze([
  "googleApiSurface", "openaiModelIdentity", "googleModelIdentity", "returnedModelPolicies", "anthropicModelIdentity",
]);
const RETENTION_KEYS = Object.freeze([
  "schemaVersion", "provider", "modelConfigurationId", "organizationOrProjectReference",
  "requestLevelControlsVerified", "requestLevelControls", "accountRetentionStatus", "zeroDataRetentionStatus",
  "evidenceStatus", "evidenceType", "verifiedAt", "reviewDecision", "notes",
]);
const CONTROL_KEYS = Object.freeze([
  "providerStorage", "background", "providerAddressableContinuationId", "continuationStrategy",
]);

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be a plain record`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], name: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${name} has missing or unknown fields`);
  }
}

function rejectSecretData(value: unknown): void {
  if (typeof value === "string") {
    if (/authorization\s*:|bearer\s+|(?:api[_ -]?key|credential|secret)\s*[:=]|\bsk-[A-Za-z0-9_-]+/i.test(value)) {
      throw new TypeError("Roster provenance cannot contain credential, secret, or authorization data");
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) rejectSecretData(entry);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (/api.?key|authorization|headers?|environment|credential|secret/i.test(key)) {
      throw new TypeError("Roster provenance cannot contain credential, secret, header, or environment fields");
    }
    rejectSecretData(nested);
  }
}

function requireString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
}

function validateSignoffInput(value: unknown): ScopeV01RosterSignoffInput {
  const input = asRecord(value, "Roster signoff input");
  exactKeys(input, SIGNOFF_INPUT_KEYS, "Roster signoff input");
  if (input.scope !== "scope-v0.1") throw new TypeError("Roster signoff has wrong scope");
  const ids = asRecord(input.modelConfigurationIds, "Roster model configuration IDs");
  exactKeys(ids, PROVIDERS, "Roster model configuration IDs");
  for (const provider of PROVIDERS) requireString(ids[provider], `${provider} model configuration ID`);
  const decisions = asRecord(input.decisions, "Roster signoff decisions");
  exactKeys(decisions, SIGNOFF_DECISION_KEYS, "Roster signoff decisions");
  const googleApi = asRecord(decisions.googleApiSurface, "Google API decision");
  exactKeys(googleApi, ["decision", "providerBackend", "apiSurface", "requestedModel", "scope", "acceptedLimitation", "generality", "rationale"], "Google API decision");
  const expectedRationale = ["CURRENT_ADAPTER_TARGETS_V1BETA", "CURRENT_TESTS_TARGET_V1BETA", "CONDITION_A_LIVE_PILOT_USED_V1BETA", "MIGRATION_CHANGES_CONFIGURATION_IDENTITY_AND_REQUIRES_REVALIDATION"];
  if (googleApi.decision !== "KEEP_V1BETA" || googleApi.providerBackend !== "Gemini Developer API" || googleApi.apiSurface !== "interactions-v1beta" || googleApi.requestedModel !== "gemini-3.8-flash" || googleApi.scope !== "SCOPE_V0_1_FIRST_RUN_ONLY" || googleApi.acceptedLimitation !== true || googleApi.generality !== "NOT_A_GENERAL_PREFERENCE_FOR_V1BETA" || !Array.isArray(googleApi.rationale) || googleApi.rationale.length !== expectedRationale.length || googleApi.rationale.some((entry, index) => entry !== expectedRationale[index])) throw new TypeError("Invalid Google API decision");
  const openai = asRecord(decisions.openaiModelIdentity, "OpenAI model decision");
  exactKeys(openai, ["decision", "requestedModel", "limitation", "snapshotEquivalenceInferred"], "OpenAI model decision");
  if (openai.decision !== "ACCEPT_DOCUMENTED_ID_WITHOUT_SEPARATE_DATED_SNAPSHOT" || openai.requestedModel !== "gpt-6.1-sol" || openai.snapshotEquivalenceInferred !== false) throw new TypeError("Invalid OpenAI model decision");
  requireString(openai.limitation, "OpenAI reproducibility limitation");
  const google = asRecord(decisions.googleModelIdentity, "Google model decision");
  exactKeys(google, ["decision", "requestedModel", "limitation", "identifierClassification", "datedEquivalenceInferred"], "Google model decision");
  if (google.decision !== "ACCEPT_STABLE_ID_WITHOUT_SEPARATE_DATED_SNAPSHOT" || google.requestedModel !== "gemini-3.8-flash" || google.identifierClassification !== "STABLE_NON_LATEST" || google.datedEquivalenceInferred !== false) throw new TypeError("Invalid Google model decision");
  requireString(google.limitation, "Google reproducibility limitation");
  const policies = asRecord(decisions.returnedModelPolicies, "Returned-model policies");
  exactKeys(policies, [...PROVIDERS, "undocumentedAliasEquivalencePermitted"], "Returned-model policies");
  if (policies.openai !== "EXACT_REQUESTED_IF_PRESENT" || policies.google !== "OBSERVE_SEPARATELY" || policies.anthropic !== "EXACT_REQUESTED_IF_PRESENT" || policies.undocumentedAliasEquivalencePermitted !== false) throw new TypeError("Invalid returned-model policies");
  const anthropic = asRecord(decisions.anthropicModelIdentity, "Anthropic model decision");
  exactKeys(anthropic, ["decision", "requestedModel", "separateDatedAliasRequired", "subjectToFutureAuthoritativeEvidence"], "Anthropic model decision");
  if (anthropic.decision !== "ACCEPT_DOCUMENTED_PINNED_IDENTIFIER" || anthropic.requestedModel !== "claude-sonnet-5-5" || anthropic.separateDatedAliasRequired !== false || anthropic.subjectToFutureAuthoritativeEvidence !== true) throw new TypeError("Invalid Anthropic model decision");
  rejectSecretData(input);
  return input as unknown as ScopeV01RosterSignoffInput;
}

function signoffContent(input: ScopeV01RosterSignoffInput): CanonicalJsonValue {
  return {
    schemaVersion: SCOPE_V01_ROSTER_SIGNOFF_SCHEMA_VERSION,
    hashAlgorithm: HASH_ALGORITHM,
    canonicalHashContractVersion: CANONICAL_HASH_CONTRACT_VERSION,
    scope: input.scope,
    modelConfigurationIds: input.modelConfigurationIds,
    decisions: input.decisions,
  } as unknown as CanonicalJsonValue;
}

function signoffId(hash: string): string {
  return `${SCOPE_V01_ROSTER_SIGNOFF_SCHEMA_VERSION}:${HASH_ALGORITHM}:${hash}`;
}

export function createScopeV01RosterSignoff(value: ScopeV01RosterSignoffInput): ScopeV01RosterSignoff {
  const input = validateSignoffInput(value);
  const content = signoffContent(input);
  const hash = sha256CanonicalJson(content);
  return deepFreezeCanonical({
    ...(content as Record<string, CanonicalJsonValue>),
    rosterSignoffId: signoffId(hash),
    rosterSignoffHash: hash,
  }) as unknown as ScopeV01RosterSignoff;
}

export function verifyScopeV01RosterSignoff(value: unknown): ScopeV01RosterSignoff {
  const record = asRecord(value, "Roster signoff record");
  exactKeys(record, SIGNOFF_RECORD_KEYS, "Roster signoff record");
  if (record.schemaVersion !== SCOPE_V01_ROSTER_SIGNOFF_SCHEMA_VERSION) throw new TypeError("Unsupported roster signoff schema version");
  if (record.hashAlgorithm !== HASH_ALGORITHM) throw new TypeError("Unsupported roster signoff hash algorithm");
  if (record.canonicalHashContractVersion !== CANONICAL_HASH_CONTRACT_VERSION) throw new TypeError("Unsupported roster signoff canonical hash contract");
  const input = validateSignoffInput({ scope: record.scope, modelConfigurationIds: record.modelConfigurationIds, decisions: record.decisions });
  const hash = sha256CanonicalJson(signoffContent(input));
  if (record.rosterSignoffHash !== hash) throw new TypeError("Roster signoff hash does not match content");
  if (record.rosterSignoffId !== signoffId(hash)) throw new TypeError("Roster signoff ID does not match verified hash");
  return deepFreezeCanonical(record as unknown as CanonicalJsonValue) as unknown as ScopeV01RosterSignoff;
}

const candidateIds: ModelConfigurationIds = Object.freeze({
  openai: SCOPE_V01_CANDIDATE_MODEL_CONFIGURATIONS.openai.modelConfigurationId,
  google: SCOPE_V01_CANDIDATE_MODEL_CONFIGURATIONS.google.modelConfigurationId,
  anthropic: SCOPE_V01_CANDIDATE_MODEL_CONFIGURATIONS.anthropic.modelConfigurationId,
});

export const SCOPE_V01_CANDIDATE_ROSTER_SIGNOFF = createScopeV01RosterSignoff({
  scope: "scope-v0.1",
  modelConfigurationIds: candidateIds,
  decisions: {
    googleApiSurface: {
      decision: "KEEP_V1BETA",
      providerBackend: "Gemini Developer API",
      apiSurface: "interactions-v1beta",
      requestedModel: "gemini-3.8-flash",
      scope: "SCOPE_V0_1_FIRST_RUN_ONLY",
      acceptedLimitation: true,
      generality: "NOT_A_GENERAL_PREFERENCE_FOR_V1BETA",
      rationale: [
        "CURRENT_ADAPTER_TARGETS_V1BETA",
        "CURRENT_TESTS_TARGET_V1BETA",
        "CONDITION_A_LIVE_PILOT_USED_V1BETA",
        "MIGRATION_CHANGES_CONFIGURATION_IDENTITY_AND_REQUIRES_REVALIDATION",
      ],
    },
    openaiModelIdentity: {
      decision: "ACCEPT_DOCUMENTED_ID_WITHOUT_SEPARATE_DATED_SNAPSHOT",
      requestedModel: "gpt-6.1-sol",
      limitation: "No separately verified dated immutable snapshot is documented; preserve requested and returned identity evidence without inferring equivalence.",
      snapshotEquivalenceInferred: false,
    },
    googleModelIdentity: {
      decision: "ACCEPT_STABLE_ID_WITHOUT_SEPARATE_DATED_SNAPSHOT",
      requestedModel: "gemini-3.8-flash",
      limitation: "No separately verified dated immutable snapshot is documented; preserve requested and returned identity evidence without inferring equivalence.",
      identifierClassification: "STABLE_NON_LATEST",
      datedEquivalenceInferred: false,
    },
    returnedModelPolicies: {
      openai: "EXACT_REQUESTED_IF_PRESENT",
      google: "OBSERVE_SEPARATELY",
      anthropic: "EXACT_REQUESTED_IF_PRESENT",
      undocumentedAliasEquivalencePermitted: false,
    },
    anthropicModelIdentity: {
      decision: "ACCEPT_DOCUMENTED_PINNED_IDENTIFIER",
      requestedModel: "claude-sonnet-5-5",
      separateDatedAliasRequired: false,
      subjectToFutureAuthoritativeEvidence: true,
    },
  },
});

function candidateControls(provider: ScopeV01Provider): ProviderRetentionPosture["requestLevelControls"] {
  const settings = SCOPE_V01_CANDIDATE_MODEL_CONFIGURATIONS[provider].settings;
  return {
    providerStorage: settings.providerStorage,
    background: settings.background,
    providerAddressableContinuationId: settings.providerAddressableContinuationId,
    continuationStrategy: settings.continuationStrategy,
  };
}

function validateRetentionPosture(value: unknown): ProviderRetentionPosture {
  const posture = asRecord(value, "Provider retention posture");
  exactKeys(posture, RETENTION_KEYS, "Provider retention posture");
  if (posture.schemaVersion !== PROVIDER_RETENTION_POSTURE_SCHEMA_VERSION) throw new TypeError("Unsupported retention posture schema version");
  if (!PROVIDERS.includes(posture.provider as ScopeV01Provider)) throw new TypeError("Invalid retention posture provider");
  requireString(posture.modelConfigurationId, "Retention posture model configuration ID");
  if (posture.organizationOrProjectReference !== null) requireString(posture.organizationOrProjectReference, "Organization or project reference");
  if (typeof posture.requestLevelControlsVerified !== "boolean") throw new TypeError("requestLevelControlsVerified must be boolean");
  const controls = asRecord(posture.requestLevelControls, "Request-level controls");
  exactKeys(controls, CONTROL_KEYS, "Request-level controls");
  const accountStates = new Set<AccountRetentionStatus>(["ZERO_DATA_RETENTION", "STANDARD_PROVIDER_RETENTION", "OTHER_DOCUMENTED_POSTURE", "UNKNOWN", "NOT_APPLICABLE"]);
  const zdrStates = new Set<ZeroDataRetentionStatus>(["ENABLED", "NOT_ENABLED", "UNKNOWN", "NOT_APPLICABLE"]);
  const evidenceStates = new Set<RetentionEvidenceStatus>(["VERIFIED", "USER_ATTESTED", "UNVERIFIED", "NOT_APPLICABLE"]);
  const evidenceTypes = new Set<RetentionEvidenceType>(["AUTHORITATIVE_DOCUMENTATION", "USER_ATTESTATION", "ACCOUNT_UI_VERIFICATION", "ORGANIZATION_POLICY", "UNVERIFIED"]);
  const reviewStates = new Set<RetentionReviewDecision>(["ACCEPTED", "UNRESOLVED", "REJECTED"]);
  if (!accountStates.has(posture.accountRetentionStatus as AccountRetentionStatus)) throw new TypeError("Invalid account retention status");
  if (!zdrStates.has(posture.zeroDataRetentionStatus as ZeroDataRetentionStatus)) throw new TypeError("Invalid zero-data-retention status");
  if (!evidenceStates.has(posture.evidenceStatus as RetentionEvidenceStatus)) throw new TypeError("Invalid retention evidence status");
  if (!evidenceTypes.has(posture.evidenceType as RetentionEvidenceType)) throw new TypeError("Invalid retention evidence type");
  if (posture.verifiedAt !== null) requireString(posture.verifiedAt, "Retention verification timestamp");
  if (!reviewStates.has(posture.reviewDecision as RetentionReviewDecision)) throw new TypeError("Invalid retention review decision");
  if (typeof posture.notes !== "string") throw new TypeError("Retention notes must be a string");
  rejectSecretData(posture);
  return posture as unknown as ProviderRetentionPosture;
}

export function createProviderRetentionPosture(value: ProviderRetentionPosture): ProviderRetentionPosture {
  return deepFreezeCanonical(validateRetentionPosture(value) as unknown as CanonicalJsonValue) as unknown as ProviderRetentionPosture;
}

function unresolvedPosture(provider: ScopeV01Provider, notes: string): ProviderRetentionPosture {
  return createProviderRetentionPosture({
    schemaVersion: PROVIDER_RETENTION_POSTURE_SCHEMA_VERSION,
    provider,
    modelConfigurationId: candidateIds[provider],
    organizationOrProjectReference: null,
    requestLevelControlsVerified: true,
    requestLevelControls: candidateControls(provider),
    accountRetentionStatus: "UNKNOWN",
    zeroDataRetentionStatus: "UNKNOWN",
    evidenceStatus: "UNVERIFIED",
    evidenceType: "UNVERIFIED",
    verifiedAt: null,
    reviewDecision: "UNRESOLVED",
    notes,
  });
}

export const SCOPE_V01_CANDIDATE_RETENTION_POSTURES = Object.freeze({
  openai: unresolvedPosture("openai", "Request controls are code-verified; organization or project retention posture has not been supplied."),
  google: unresolvedPosture("google", "Request controls are code-verified; Developer API project retention posture has not been supplied."),
  anthropic: unresolvedPosture("anthropic", "No request-level storage switch exists; organization retention posture has not been supplied."),
});

export function evaluateRetentionPostureGate(value: unknown): RetentionPostureGate {
  const posture = validateRetentionPosture(value);
  if (posture.reviewDecision === "REJECTED") return Object.freeze({ status: "REJECTED", reasonCodes: Object.freeze(["REVIEW_REJECTED"]) });
  const reasons: string[] = [];
  const expectedConfiguration = SCOPE_V01_CANDIDATE_MODEL_CONFIGURATIONS[posture.provider];
  if (posture.modelConfigurationId !== expectedConfiguration.modelConfigurationId) reasons.push("MODEL_CONFIGURATION_MISMATCH");
  if (!posture.requestLevelControlsVerified) reasons.push("REQUEST_CONTROLS_NOT_VERIFIED");
  if (canonicalJson(posture.requestLevelControls as unknown as CanonicalJsonValue) !== canonicalJson(candidateControls(posture.provider) as unknown as CanonicalJsonValue)) reasons.push("REQUEST_CONTROLS_MISMATCH");
  if (posture.organizationOrProjectReference === null) reasons.push("ORGANIZATION_OR_PROJECT_REFERENCE_MISSING");
  if (posture.accountRetentionStatus === "UNKNOWN" || posture.accountRetentionStatus === "NOT_APPLICABLE") reasons.push("ACCOUNT_RETENTION_NOT_ESTABLISHED");
  if (posture.zeroDataRetentionStatus === "UNKNOWN") reasons.push("ZERO_DATA_RETENTION_STATUS_UNKNOWN");
  if (posture.evidenceStatus === "UNVERIFIED" || posture.evidenceStatus === "NOT_APPLICABLE" || posture.evidenceType === "UNVERIFIED") reasons.push("EVIDENCE_UNVERIFIED");
  if (posture.verifiedAt === null) reasons.push("VERIFICATION_TIMESTAMP_MISSING");
  if (posture.reviewDecision !== "ACCEPTED") reasons.push("REVIEW_NOT_ACCEPTED");
  return Object.freeze({
    status: reasons.length === 0 ? "ACCEPTED" : "UNRESOLVED",
    reasonCodes: Object.freeze(reasons),
  });
}

type CandidateConfigurationSet = Readonly<Record<ScopeV01Provider, unknown>>;
type RetentionPostureSet = Readonly<Record<ScopeV01Provider, unknown>>;
type LiveValidationSet = Readonly<Record<ScopeV01Provider, LiveValidationStatus>>;

export interface ScopeV01RosterReadinessInput {
  readonly candidateConfigurations: CandidateConfigurationSet;
  readonly signoff: unknown | null;
  readonly retentionPostures: RetentionPostureSet;
  readonly liveValidation: LiveValidationSet;
  readonly blockingProviderAmbiguities: readonly string[];
  readonly formalAcceptance: "ACCEPTED" | "UNRESOLVED";
}

export interface ScopeV01RosterReadinessResult {
  readonly ready: boolean;
  readonly modelRosterConfigurationsState: string;
  readonly providers: Readonly<Record<ScopeV01Provider, Readonly<{
    signoff: "COMPLETE" | "MISSING_OR_INVALID";
    retention: RetentionReviewDecision;
    liveValidation: LiveValidationStatus;
  }>>>;
  readonly blockers: readonly string[];
}

export function evaluateScopeV01RosterReadiness(input: ScopeV01RosterReadinessInput): ScopeV01RosterReadinessResult {
  const blockers: string[] = [];
  const validConfigurations = {} as Record<ScopeV01Provider, ModelConfigurationRecord | null>;
  for (const provider of PROVIDERS) {
    try {
      const verified = verifyModelConfigurationRecord(input.candidateConfigurations[provider]);
      validConfigurations[provider] = verified.identity.provider === provider ? verified : null;
      if (validConfigurations[provider] === null) blockers.push(`INVALID_MODEL_CONFIGURATION:${provider}`);
    } catch {
      validConfigurations[provider] = null;
      blockers.push(`INVALID_MODEL_CONFIGURATION:${provider}`);
    }
  }

  let signoff: ScopeV01RosterSignoff | null = null;
  if (input.signoff === null) blockers.push("SIGNOFF_MISSING");
  else {
    try { signoff = verifyScopeV01RosterSignoff(input.signoff); }
    catch { blockers.push("SIGNOFF_INVALID"); }
  }

  const providers = {} as Record<ScopeV01Provider, {
    signoff: "COMPLETE" | "MISSING_OR_INVALID";
    retention: RetentionReviewDecision;
    liveValidation: LiveValidationStatus;
  }>;
  for (const provider of PROVIDERS) {
    const configured = validConfigurations[provider];
    const signed = signoff !== null && configured !== null && signoff.modelConfigurationIds[provider] === configured.modelConfigurationId;
    if (signoff !== null && !signed) blockers.push(`SIGNOFF_CONFIGURATION_MISMATCH:${provider}`);
    let retention: RetentionReviewDecision = "UNRESOLVED";
    try {
      retention = evaluateRetentionPostureGate(input.retentionPostures[provider]).status;
    } catch {
      retention = "UNRESOLVED";
    }
    if (retention === "REJECTED") blockers.push(`RETENTION_POSTURE_REJECTED:${provider}`);
    else if (retention !== "ACCEPTED") blockers.push(`RETENTION_POSTURE_UNRESOLVED:${provider}`);
    const live = input.liveValidation[provider];
    if (live !== "CONDITION_A_LIVE_PILOT_VALIDATED") blockers.push(`LIVE_VALIDATION_INCOMPLETE:${provider}`);
    providers[provider] = { signoff: signed ? "COMPLETE" : "MISSING_OR_INVALID", retention, liveValidation: live };
  }
  for (const ambiguity of input.blockingProviderAmbiguities) {
    requireString(ambiguity, "Blocking provider ambiguity");
    rejectSecretData(ambiguity);
    blockers.push(`BLOCKING_PROVIDER_AMBIGUITY:${ambiguity}`);
  }
  if (input.formalAcceptance !== "ACCEPTED") blockers.push("FORMAL_ACCEPTANCE_MISSING");
  const rosterDecision = SCOPE_V01_CANDIDATE_FREEZE_DECISIONS.MODEL_ROSTER_CONFIGURATIONS;
  return Object.freeze({
    ready: blockers.length === 0,
    modelRosterConfigurationsState: rosterDecision.state,
    providers: Object.freeze(providers),
    blockers: Object.freeze(blockers),
  });
}
