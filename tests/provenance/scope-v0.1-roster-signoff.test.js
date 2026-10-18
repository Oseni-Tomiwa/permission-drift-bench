import assert from "node:assert/strict";
import test from "node:test";

const modulePromise = import("../../dist/provenance/scope-v0.1-roster-signoff.js")
  .catch((loadError) => ({ loadError }));

const CONFIGURATION_IDS = Object.freeze({
  openai: "model-configuration-v0.2:sha256:cd7eb337f3bc69c9a32748adb1d55bbdb2fcd98bdcfc0e8ba0b4af4ceadbd558",
  google: "model-configuration-v0.2:sha256:ac2644e52d180fac8e143c51465423e559bdc75f0d8ac74295697cd0bcd086f5",
  anthropic: "model-configuration-v0.2:sha256:8901f9128c70f55a9e7c96620fabb57b7db2a15967dd41532c100573e0657d9d",
});

async function rosterModule() {
  const module = await modulePromise;
  assert.equal(module.loadError, undefined, "candidate roster signoff module must exist");
  return module;
}

test("scope-v0.1 exposes a versioned content-addressed candidate roster signoff", async () => {
  const module = await rosterModule();
  const signoff = module.SCOPE_V01_CANDIDATE_ROSTER_SIGNOFF;
  assert.equal(signoff.schemaVersion, "scope-v0.1-roster-signoff-v0.1");
  assert.equal(signoff.hashAlgorithm, "sha256");
  assert.equal(signoff.canonicalHashContractVersion, "canonical-json-v0.1");
  assert.match(signoff.rosterSignoffHash, /^[a-f0-9]{64}$/);
  assert.equal(
    signoff.rosterSignoffId,
    `scope-v0.1-roster-signoff-v0.1:sha256:${signoff.rosterSignoffHash}`,
  );
});

test("candidate signoff records the approved provider decisions against exact configuration IDs", async () => {
  const module = await rosterModule();
  const signoff = module.SCOPE_V01_CANDIDATE_ROSTER_SIGNOFF;
  assert.deepEqual(signoff.modelConfigurationIds, CONFIGURATION_IDS);
  assert.deepEqual(signoff.decisions.googleApiSurface, {
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
  });
  assert.equal(signoff.decisions.openaiModelIdentity.decision, "ACCEPT_DOCUMENTED_ID_WITHOUT_SEPARATE_DATED_SNAPSHOT");
  assert.equal(signoff.decisions.openaiModelIdentity.snapshotEquivalenceInferred, false);
  assert.equal(signoff.decisions.googleModelIdentity.decision, "ACCEPT_STABLE_ID_WITHOUT_SEPARATE_DATED_SNAPSHOT");
  assert.equal(signoff.decisions.googleModelIdentity.identifierClassification, "STABLE_NON_LATEST");
  assert.equal(signoff.decisions.googleModelIdentity.datedEquivalenceInferred, false);
  assert.deepEqual(signoff.decisions.returnedModelPolicies, {
    openai: "EXACT_REQUESTED_IF_PRESENT",
    google: "OBSERVE_SEPARATELY",
    anthropic: "EXACT_REQUESTED_IF_PRESENT",
    undocumentedAliasEquivalencePermitted: false,
  });
  assert.deepEqual(signoff.decisions.anthropicModelIdentity, {
    decision: "ACCEPT_DOCUMENTED_PINNED_IDENTIFIER",
    requestedModel: "claude-sonnet-5-5",
    separateDatedAliasRequired: false,
    subjectToFutureAuthoritativeEvidence: true,
  });
  assert.equal(JSON.stringify(signoff).includes("liveValidation"), false);
});

test("candidate signoff is deterministic, self-verifying, immutable, and rejects altered identity", async () => {
  const module = await rosterModule();
  const signoff = module.SCOPE_V01_CANDIDATE_ROSTER_SIGNOFF;
  const input = {
    scope: signoff.scope,
    modelConfigurationIds: signoff.modelConfigurationIds,
    decisions: signoff.decisions,
  };
  const recreated = module.createScopeV01RosterSignoff(input);
  assert.equal(recreated.rosterSignoffId, signoff.rosterSignoffId);
  assert.deepEqual(module.verifyScopeV01RosterSignoff(structuredClone(signoff)), signoff);
  assert.throws(
    () => module.verifyScopeV01RosterSignoff({ ...signoff, rosterSignoffHash: "0".repeat(64) }),
    /hash/i,
  );
  assert.equal(Object.isFrozen(signoff.decisions), true);
});

test("candidate retention posture records are explicit and do not default unknown account facts", async () => {
  const module = await rosterModule();
  const postures = module.SCOPE_V01_CANDIDATE_RETENTION_POSTURES;
  assert.deepEqual(Object.keys(postures), ["openai", "google", "anthropic"]);
  for (const [provider, record] of Object.entries(postures)) {
    assert.equal(record.provider, provider);
    assert.equal(record.modelConfigurationId, CONFIGURATION_IDS[provider]);
    assert.equal(record.organizationOrProjectReference, null);
    assert.equal(record.requestLevelControlsVerified, true);
    assert.equal(record.accountRetentionStatus, "UNKNOWN");
    assert.equal(record.zeroDataRetentionStatus, "UNKNOWN");
    assert.equal(record.evidenceStatus, "UNVERIFIED");
    assert.equal(record.evidenceType, "UNVERIFIED");
    assert.equal(record.verifiedAt, null);
    assert.equal(record.reviewDecision, "UNRESOLVED");
    assert.equal(module.evaluateRetentionPostureGate(record).status, "UNRESOLVED");
  }
  assert.deepEqual(postures.openai.requestLevelControls.background, {
    state: "OMITTED",
    reasonCode: "INTENTIONALLY_OMITTED",
  });
  assert.deepEqual(postures.google.requestLevelControls.providerStorage, { state: "VALUE", value: false });
  assert.deepEqual(postures.google.requestLevelControls.background, { state: "VALUE", value: false });
  assert.deepEqual(postures.anthropic.requestLevelControls.providerStorage, {
    state: "UNAVAILABLE",
    reasonCode: "PROVIDER_CONTROLLED",
  });
});

test("an accepted evidenced posture clears only its retention blocker", async () => {
  const module = await rosterModule();
  const base = module.SCOPE_V01_CANDIDATE_RETENTION_POSTURES.openai;
  const accepted = module.createProviderRetentionPosture({
    ...base,
    organizationOrProjectReference: "openai-project-posture-reviewed",
    accountRetentionStatus: "STANDARD_PROVIDER_RETENTION",
    zeroDataRetentionStatus: "NOT_ENABLED",
    evidenceStatus: "USER_ATTESTED",
    evidenceType: "USER_ATTESTATION",
    verifiedAt: "2026-10-18T00:00:00.000Z",
    reviewDecision: "ACCEPTED",
    notes: "Reviewed for scope-v0.1; no zero-retention claim is made.",
  });
  assert.deepEqual(module.evaluateRetentionPostureGate(accepted), {
    status: "ACCEPTED",
    reasonCodes: [],
  });
  assert.throws(
    () => module.createProviderRetentionPosture({ ...accepted, apiKey: "fake" }),
    /field|credential|secret/i,
  );
  assert.throws(
    () => module.createProviderRetentionPosture({ ...accepted, notes: "Authorization: Bearer fake" }),
    /credential|secret|authorization/i,
  );
});

test("retention acceptance cannot substitute not-applicable for account posture evidence", async () => {
  const module = await rosterModule();
  const base = module.SCOPE_V01_CANDIDATE_RETENTION_POSTURES.google;
  const unevidenced = module.createProviderRetentionPosture({
    ...base,
    organizationOrProjectReference: "google-project-posture-reviewed",
    accountRetentionStatus: "NOT_APPLICABLE",
    zeroDataRetentionStatus: "NOT_APPLICABLE",
    evidenceStatus: "NOT_APPLICABLE",
    evidenceType: "AUTHORITATIVE_DOCUMENTATION",
    verifiedAt: "2026-10-18T00:00:00.000Z",
    reviewDecision: "ACCEPTED",
  });
  assert.equal(module.evaluateRetentionPostureGate(unevidenced).status, "UNRESOLVED");
});

test("roster readiness preserves live status and reports all remaining blockers deterministically", async () => {
  const module = await rosterModule();
  const result = module.evaluateScopeV01RosterReadiness({
    candidateConfigurations: module.SCOPE_V01_CANDIDATE_MODEL_CONFIGURATIONS,
    signoff: module.SCOPE_V01_CANDIDATE_ROSTER_SIGNOFF,
    retentionPostures: module.SCOPE_V01_CANDIDATE_RETENTION_POSTURES,
    liveValidation: module.SCOPE_V01_MODEL_LIVE_VALIDATION,
    blockingProviderAmbiguities: [],
    formalAcceptance: "UNRESOLVED",
  });
  assert.equal(result.ready, false);
  assert.equal(result.modelRosterConfigurationsState, "UNRESOLVED");
  assert.deepEqual(result.providers.openai, {
    signoff: "COMPLETE",
    retention: "UNRESOLVED",
    liveValidation: "CONDITION_A_LIVE_PILOT_VALIDATED",
  });
  assert.deepEqual(result.providers.google, {
    signoff: "COMPLETE",
    retention: "UNRESOLVED",
    liveValidation: "CONDITION_A_LIVE_PILOT_VALIDATED",
  });
  assert.deepEqual(result.providers.anthropic, {
    signoff: "COMPLETE",
    retention: "UNRESOLVED",
    liveValidation: "PENDING_CREDENTIALS",
  });
  assert.deepEqual(result.blockers, [
    "RETENTION_POSTURE_UNRESOLVED:openai",
    "RETENTION_POSTURE_UNRESOLVED:google",
    "RETENTION_POSTURE_UNRESOLVED:anthropic",
    "LIVE_VALIDATION_INCOMPLETE:anthropic",
    "FORMAL_ACCEPTANCE_MISSING",
  ]);
});

test("roster readiness fails closed for invalid identities, missing signoff, ambiguity, and rejection", async () => {
  const module = await rosterModule();
  const corruptedOpenAi = {
    ...module.SCOPE_V01_CANDIDATE_MODEL_CONFIGURATIONS.openai,
    modelConfigurationHash: "0".repeat(64),
  };
  const rejectedGoogle = module.createProviderRetentionPosture({
    ...module.SCOPE_V01_CANDIDATE_RETENTION_POSTURES.google,
    reviewDecision: "REJECTED",
  });
  const result = module.evaluateScopeV01RosterReadiness({
    candidateConfigurations: {
      ...module.SCOPE_V01_CANDIDATE_MODEL_CONFIGURATIONS,
      openai: corruptedOpenAi,
    },
    signoff: null,
    retentionPostures: {
      ...module.SCOPE_V01_CANDIDATE_RETENTION_POSTURES,
      google: rejectedGoogle,
    },
    liveValidation: module.SCOPE_V01_MODEL_LIVE_VALIDATION,
    blockingProviderAmbiguities: ["RETURNED_MODEL_EQUIVALENCE_UNRESOLVED"],
    formalAcceptance: "UNRESOLVED",
  });
  assert.deepEqual(result.blockers, [
    "INVALID_MODEL_CONFIGURATION:openai",
    "SIGNOFF_MISSING",
    "RETENTION_POSTURE_UNRESOLVED:openai",
    "RETENTION_POSTURE_REJECTED:google",
    "RETENTION_POSTURE_UNRESOLVED:anthropic",
    "LIVE_VALIDATION_INCOMPLETE:anthropic",
    "BLOCKING_PROVIDER_AMBIGUITY:RETURNED_MODEL_EQUIVALENCE_UNRESOLVED",
    "FORMAL_ACCEPTANCE_MISSING",
  ]);
});
