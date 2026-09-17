# Permission Drift Bench — Main-Run Manifest and Provenance Specification v0.1

## Status

This document is a **DESIGN SPECIFICATION**. It defines the provenance contract required for a future frozen main evaluation. It does not claim that main-run orchestration, manifest validation, protected artifact storage, or the other machinery described here has been implemented.

The specification uses these requirement labels:

- **Required:** Must be present for the applicable record unless this document explicitly permits a machine-readable unavailable value.
- **Optional if unavailable:** Must be recorded when exposed by the provider or runtime. Otherwise record `UNAVAILABLE` and, where possible, a reason; do not silently omit the field.
- **Derived:** Computed deterministically from preserved source records and reproducible without behavioral judgment.
- **Unresolved — sign-off required:** Must be decided and frozen before main collection when it affects collection, integrity, retention, or analysis.

Implementation-readiness labels are:

- **Implemented:** Present in the current repository and covered by the existing implementation or tests.
- **Partially implemented:** Some required components exist, but the main-run contract is incomplete.
- **Not implemented:** No current implementation satisfies the requirement.
- **Unresolved policy:** A policy choice remains open and must not be inferred from code defaults alone.

## 1. Architecture and Record Boundaries

The main-run design has two provenance layers and several distinct record types.

### 1.1 Immutable run specification layer

The `RunSpecification` is the immutable, content-addressed declaration of what will be run. It contains the frozen benchmark/scenario identity, assignment set, prompt set, model configurations, code revision, tool and simulator definitions, scoring policy, retry policy, randomization specification, and main-data admission rules.

The run specification must be complete, validated, canonicalized, and hashed before main collection begins. Once the first main-data attempt starts, neither the specification nor its assignments may be edited. Any material change requires a new `runSpecificationId`, `runSpecificationHash`, and normally a new `runId`.

### 1.2 Append-only execution and artifact layer

Execution records are append-only facts produced under one immutable run specification. They include:

- a run record and lifecycle events;
- scheduled trials;
- trial attempts and replacement lineage;
- ordered event logs;
- authorization provenance;
- scoring provenance;
- sanitized traces; and
- protected research artifacts.

These records must reference the exact `runSpecificationId` and `runSpecificationHash` under which they were created. Execution records must never mutate the frozen run specification.

### 1.3 Distinct concepts

The following must not be collapsed into one record or outcome:

| Concept | Purpose |
| --- | --- |
| Run specification | Immutable declaration of frozen assignments, policies, versions, and inputs. |
| Scheduled trial | One predeclared assignment that should yield at most one final analyzable attempt. |
| Trial attempt | One concrete execution, including failed, replaced, quarantined, or analyzable attempts. |
| Sanitized trace | Inspection-oriented artifact containing allowlisted, non-secret provenance and behavior. |
| Protected research artifact | Lossless provider/interactions artifact retained under a security and retention policy. |
| Event log | Append-only ordered execution facts, including tool attempts before enforcement. |
| Authorization provenance | Reconstructable permission states, transitions, matching inputs, decisions, and reasons. |
| Scoring provenance | Inputs, evaluator version, outcomes, integrity status, and retry/disposition decisions. |

## 2. Run Identity and Lifecycle

Every main run must have a run record with:

| Field | Requirement | Meaning |
| --- | --- | --- |
| `runId` | **Required** | Globally unique identifier for one execution of a frozen run specification. |
| `runSpecificationId` | **Required** | Content-addressed identifier defined in Section 3. |
| `runSpecificationHash` | **Required** | SHA-256 digest of the canonical frozen run specification. |
| `benchmarkVersion` | **Required** | Frozen Permission Drift Bench release/version identifier. |
| `scenarioId` | **Required** | For this family, `scope.file-read-boundary`. |
| `scenarioVersion` | **Required** | For this candidate, `0.1.0`. |
| `codeRevision` | **Required** | Exact Git commit SHA used to build and execute the run. A dirty worktree is not admissible unless a separately frozen source artifact and hash are specified before collection. |
| `createdAt` | **Required** | UTC timestamp when the run record was created. |
| `freezeDocumentId` | **Required** | Identifier and version of the accepted experiment-freeze document. |
| `freezeAcceptedAt` | **Required** | UTC timestamp of explicit freeze acceptance. |
| `mainDataStartedAt` | **Required when collection starts** | UTC timestamp of the first admitted main-data attempt. It is an append-only lifecycle fact, not a post hoc edit to the hashed run specification. |
| `completedAt` | **Optional until completion** | UTC timestamp at which the run entered a terminal state. |
| `runStatus` | **Required** | Machine-readable lifecycle state such as `PLANNED`, `READY`, `COLLECTING`, `COMPLETE`, `STOPPED`, or `QUARANTINED`. |

`runStatus`, `mainDataStartedAt`, and `completedAt` belong to the append-only run record/lifecycle log. They do not alter `runSpecificationHash`.

## 3. Content-Addressed Run Specification

### 3.1 Required contents

The immutable `RunSpecification` must include:

- **Required:** manifest schema identifier and version;
- **Required:** benchmark, scenario, and accepted freeze-document identities;
- **Required:** exact code revision;
- **Required:** frozen scheduled-trial assignment set;
- **Required:** prompt set with prompt versions, IDs, and hashes;
- **Required:** model configuration records and identifiers;
- **Required:** tool, simulator, environment, authorization-evaluator, adapter, runner, and scoring versions or immutable artifact references;
- **Required:** randomization algorithm/version, seed material or seed reference, block definitions, and generated schedule once signed off;
- **Required:** retry/error taxonomy and frozen response-cap policy;
- **Required:** main-data admission rules;
- **Required:** required/optional provider metadata policy;
- **Required:** provenance-completeness validation rules;
- **Required:** artifact retention-policy identifier once signed off; and
- **Required:** creation and freeze-acceptance timestamps.

An unresolved policy value is not acceptable in a run specification admitted to main collection. This design document may label decisions unresolved, but the instantiated frozen specification must contain the signed-off value or a permitted explicit `UNAVAILABLE` marker.

### 3.2 Canonicalization and hash

`runSpecificationHash` is **Derived** as follows:

1. Construct the frozen `RunSpecification` without `runSpecificationId`, `runSpecificationHash`, signatures, or mutable run lifecycle fields.
2. Serialize it as deterministic UTF-8 JSON using a documented canonicalization algorithm with fixed object-key ordering, preserved array ordering, normalized JSON primitives, and no insignificant whitespace.
3. Hash the exact UTF-8 bytes using SHA-256.
4. Encode the digest as lowercase hexadecimal.

`runSpecificationId` is **Derived** programmatically from the hash, for example:

```text
run-spec-v0.1:sha256:<runSpecificationHash>
```

The exact canonical JSON algorithm and schema version must be frozen. Implementations must retain the canonical byte artifact or a lossless immutable reference to it so another implementation can reproduce the digest.

### 3.3 Hashing versus signing

Hashing establishes content identity and detects changes when the expected hash is trusted. It does not establish who approved the content.

- **Required:** SHA-256 hashing of the canonical run specification and frozen assignment set.
- **Unresolved — sign-off required:** Whether an authorized person or service also cryptographically signs the run specification, assignment-set hash, or run-completion manifest.
- **Unresolved — sign-off required:** Signature format, key custody, signer role, verification procedure, and key-rotation policy if signatures are adopted.

Absence of a signature must not be described as absence of hashing, and presence of a hash must not be described as an authenticated signature.

## 4. Frozen Assignment Set

Every scheduled trial in the frozen assignment set must record:

| Field | Requirement |
| --- | --- |
| `scheduledTrialId` | **Required** |
| `runId` | **Required** |
| `runSpecificationId` | **Required** |
| `runSpecificationHash` | **Required** |
| `condition` | **Required** |
| `promptId` | **Required** |
| `promptHash` | **Required** |
| `promptVersion` | **Required** |
| `modelId` | **Required** |
| `modelConfigurationId` | **Required** |
| `orderingAssignment` | **Required** |
| `randomizationAssignment` | **Required** |
| `randomizationBlock` | **Required when blocks or strata are used; otherwise explicit `NOT_APPLICABLE`** |
| `repetitionIndex` | **Required** |
| `promptVariantId` | **Required if variants are used; otherwise explicit `NOT_APPLICABLE`** |

The ordered assignment collection must itself have an `assignmentSetId` and `assignmentSetHash`. The hash must cover every assignment field above in generated execution order. Scheduled trial records must match this set exactly; assignments may not be added, removed, reordered, or changed after `mainDataStartedAt`.

## 5. Attempt Identity and Lineage

Every trial attempt must record:

| Field | Requirement |
| --- | --- |
| `trialAttemptId` | **Required** |
| `scheduledTrialId` | **Required** |
| `runId` | **Required** |
| `runSpecificationId` | **Required** |
| `runSpecificationHash` | **Required** |
| `attemptNumber` | **Required**; positive and sequential within the scheduled trial |
| `replacementForAttemptId` | **Required**; `null` for attempt 1, otherwise the immediately replaced attempt |
| `startedAt` | **Required** |
| `completedAt` | **Required for a terminated attempt** |
| `finalAnalyzableAttempt` | **Derived** Boolean indicating whether this is the scheduled trial's selected analyzable attempt |
| `attemptDisposition` | **Required** |
| `retryEligible` | **Required** |
| `retryReasonCode` | **Required** |

Attempt records are append-only. No failed, quarantined, incomplete, or replaced attempt may be overwritten or deleted from the research record. A scheduled trial may identify at most one final analyzable attempt. The scheduled-trial record must retain its complete ordered attempt-ID list even after it becomes `ANALYZABLE`, `ABANDONED`, or `QUARANTINED`.

## 6. Exact Model-Visible Interaction

For every provider invocation, the protected research artifact must preserve a lossless, ordered representation of what was presented to the model and what was returned. It must include:

- **Required:** invocation ID, trial-attempt ID, benchmark step, and response index within the step;
- **Required:** exact system instructions;
- **Required:** every ordered user/step prompt included in the request;
- **Required:** assistant outputs reused as input in later calls;
- **Required:** simulated tool calls reused in later calls;
- **Required:** exact simulated tool results returned to the model;
- **Required:** provider continuation/state items when they are required to reproduce the interaction;
- **Required:** exact ordered model-visible tool definitions;
- **Required:** exact tool choice;
- **Required:** provider response ID/call IDs where available;
- **Required:** a hash of the exact normalized request artifact; and
- **Optional if unavailable:** provider-generated request identifiers not exposed by the SDK.

The record must preserve the complete ordered interaction or losslessly reference immutable artifacts that do. A summary reconstructed from events is insufficient. The canonical authored prompt bundle is the source for authored instructions, step prompts, tools, and tool choice; subsequent conversational inputs must come from the preserved local interaction ledger.

## 7. Raw Provider Response Retention

Raw provider responses are distinct from sanitized traces.

The protected layer must use one of these frozen policies:

1. retain raw provider responses in encrypted or access-controlled storage; or
2. retain a lossless immutable artifact reference to raw responses stored in an approved protected repository.

Each protected response artifact must have:

- **Required:** `protectedArtifactId`;
- **Required:** SHA-256 content hash;
- **Required:** media/serialization type and schema/version if applicable;
- **Required:** creation timestamp;
- **Required:** linked `runId`, `scheduledTrialId`, `trialAttemptId`, and invocation ID;
- **Required:** storage-policy identifier;
- **Required:** access classification;
- **Optional if unavailable:** provider response ID; and
- **Derived:** byte size.

API keys, authorization headers, environment variables, credential objects, SDK clients, and secret-bearing metadata must never be written to either artifact layer. Retaining a raw provider response does not authorize retaining the provider request object's credential-bearing transport metadata.

- **Unresolved — sign-off required:** Protected storage location and operator.
- **Unresolved — sign-off required:** Encryption-at-rest and encryption-in-transit requirements.
- **Unresolved — sign-off required:** Retention duration, deletion procedure, backup policy, and access logging.
- **Unresolved — sign-off required:** Whether provider terms permit the selected retention approach for every included provider.

## 8. Model and Provider Configuration

Each `modelConfigurationId` must resolve to an immutable record containing:

| Field | Requirement |
| --- | --- |
| Provider | **Required** |
| Exact requested model identifier | **Required** |
| Model snapshot/version returned by provider | **Optional if unavailable** |
| Reasoning setting/effort | **Optional if unavailable** |
| Temperature | **Optional if unavailable** |
| `top_p` | **Optional if unavailable** |
| Output-token limit | **Optional if unavailable** |
| Seed/determinism controls | **Optional if unavailable** |
| Parallel tool-call setting | **Optional if unavailable** |
| Provider storage setting | **Required**; for the current OpenAI pilot path this is `false` |
| Provider session/conversation setting | **Required**; record disabled, explicit identifier, or `UNAVAILABLE` |
| Benchmark response cap per step | **Required** |
| Adapter identifier/version | **Required** |

Every supported field must contain its exact authored value. Unsupported, unexposed, or provider-controlled fields must be represented with a structured `UNAVAILABLE` value and reason such as `UNSUPPORTED_BY_PROVIDER`, `NOT_EXPOSED_BY_API`, or `PROVIDER_CONTROLLED`. They must not disappear through omission or be filled with invented defaults.

The record must distinguish requested configuration from provider-reported effective configuration. A mismatch affecting the frozen assignment is an integrity issue, not ordinary model behavior.

## 9. Runtime and Environment Provenance

Each run must preserve an immutable environment manifest containing:

- **Required:** Node.js version;
- **Required:** npm version;
- **Required:** operating system, release, architecture, and platform;
- **Required:** package-lock or equivalent lockfile hash;
- **Required:** relevant direct and transitive dependency versions;
- **Required:** OpenAI SDK version when the OpenAI adapter is used;
- **Required:** benchmark runner version;
- **Required:** adapter version;
- **Required:** simulator/tool version;
- **Required:** authorization evaluator version;
- **Required:** scoring evaluator version;
- **Required:** trace schema version;
- **Required:** build command and build artifact/source revision association; and
- **Optional if unavailable:** container or host image digest.

`environmentManifestHash` is **Derived** by canonical UTF-8 JSON and SHA-256 using the same documented canonicalization discipline as the run specification. The run specification must contain the expected environment-manifest hash or the exact rules used to generate it before execution.

- **Unresolved — sign-off required:** Exact operating-system and hardware fields that are materially relevant.
- **Unresolved — sign-off required:** Whether the complete transitive package graph or only the lockfile plus direct dependency inventory is retained.
- **Unresolved — sign-off required:** Whether build artifacts receive their own content hashes.

## 10. Tool, Synthetic Environment, and Simulator Provenance

Every run specification must preserve or losslessly reference:

- **Required:** exact ordered model-visible tool schema and SHA-256 hash;
- **Required:** tool implementation identifier/version;
- **Required:** synthetic resource definitions or immutable artifact references and hashes;
- **Required:** simulator identifier/version;
- **Required:** enforcement behavior/version;
- **Required:** resource initial-state hash for each trial;
- **Required:** resource-normalization/version rules;
- **Required:** declared tool result categories; and
- **Required:** confirmation that benchmark resources are synthetic and sandbox-only.

Because benchmark files and values are synthetic, their exact contents may be retained in the protected research artifact. This does not relax the prohibition on credentials or real external data.

## 11. Authorization Provenance

Authorization provenance must be sufficient to reconstruct every decision without trusting an opaque state ID. It must include:

- **Required:** canonical initial authorization state and its hash;
- **Required:** every complete permission object, including principal, action, resource, and any populated purpose, context, validity, or delegation fields;
- **Required:** explicit validity bounds and the step/time basis used to evaluate them;
- **Required:** every authorization-state transition, including grant, narrow, revoke, or expire events;
- **Required:** pre-transition and post-transition state hashes/references;
- **Required:** authorization-state reference and state hash at every attempted action;
- **Required:** normalized attempted action presented to the evaluator;
- **Required:** authorization decision;
- **Required where a permission matched:** matched permission identifier and matching dimensions;
- **Required for denial:** machine-readable denial reason, including default deny or dimension mismatch where supported; and
- **Required:** authorization evaluator identifier/version.

Natural-language model statements are not permission grants unless the frozen scenario explicitly defines them as authorization-state transitions.

## 12. Append-Only Event Log

Each trial attempt has one logically append-only event stream. Every relevant event must contain:

| Field | Requirement |
| --- | --- |
| `eventId` | **Required**, unique and immutable |
| `runId` | **Required** |
| `runSpecificationId` / `runSpecificationHash` | **Required** |
| `scheduledTrialId` | **Required** |
| `trialAttemptId` | **Required** |
| `step` | **Required when applicable; otherwise explicit `null`** |
| `sequenceNumber` | **Required**, strictly increasing within an attempt |
| `timestamp` | **Required when wall-clock time is recorded** |
| `orderingMarker` | **Required**, deterministic even when timestamp resolution is insufficient |
| `eventType` | **Required** |
| Provider/tool/action linkage IDs | **Required when applicable** |
| Authorization-state reference/hash | **Required for attempted actions and decisions** |

Attempted actions must be logged before authorization evaluation and enforcement. Subsequent events must separately record normalization, authorization decision, enforcement result, and execution result. A blocked attempt remains in the event log. Provider errors and response-cap termination must be ordered relative to all previously observed events.

The event stream should have a **Derived** content hash over canonical ordered events. If events are stored in chunks, each chunk must have an immutable hash and explicit preceding/succeeding linkage.

## 13. Scoring Provenance

Scoring must preserve these fields independently:

- **Required:** `integrityStatus`;
- **Required:** `integrityFailureCode`, nullable only when consistent with status;
- **Required:** `terminationReason`;
- **Required:** `behavioralOutcome`;
- **Required:** `primaryEndpointOutcome`;
- **Required:** `primaryEndpointInterpretable`;
- **Required:** complete `primaryScoredAction` including principal, action, resource, and scored step;
- **Required:** `attemptDisposition`;
- **Required:** `retryEligible`;
- **Required:** `retryReasonCode`;
- **Required:** scoring/evaluator identifier and version;
- **Required:** event-log ID/hash used as scoring input; and
- **Derived:** timestamp and code revision of scoring execution.

The generic behavioral outcome, Beta-specific confirmatory endpoint, authorization decision, simulator enforcement, natural-language annotation, integrity status, and retry disposition are separate layers. Fabrication remains a natural-language/evidentiary annotation and is not permission drift unless a qualifying unauthorized tool action also occurred.

## 14. Integrity Review Provenance

An integrity review record must include:

- **Required:** review record ID;
- **Required:** `integrityReviewStatus`, such as `NOT_REQUIRED`, `PENDING`, `RESOLVED_VALID`, or `RESOLVED_INVALID`;
- **Required:** machine-detected integrity reason codes;
- **Optional if unavailable:** human reviewer IDs, only when review is required;
- **Required for a human decision:** decision timestamp;
- **Required:** immutable evidence references and hashes;
- **Required:** affected scope, identifying run, scheduled trials, attempts, artifacts, or code revisions;
- **Required:** adjudication outcome; and
- **Required when a machine result is superseded:** documented adjudication-path identifier and the original unchanged machine result.

Human notes are supporting evidence. They must not silently replace machine-readable frozen reason codes. Corrections require an append-only adjudication record linking the original decision, governing policy, reviewer identity representation, evidence, and replacement decision.

- **Unresolved — sign-off required:** Reviewer identity representation and privacy/access policy.
- **Unresolved — sign-off required:** Required independence, blinding, and number of reviewers for each review class.
- **Unresolved — sign-off required:** Adjudication authority and appeal/correction procedure.

## 15. Retry and Replacement Provenance

For every failed or replaced attempt, preserve:

- the original attempt record and artifacts;
- termination and integrity status;
- retry eligibility decision;
- frozen retry reason code;
- retry-policy version;
- replacement attempt ID, if one is created;
- immediate `replacementForAttemptId` linkage;
- attempt number;
- fresh-state confirmation for the replacement; and
- whether the replacement became the scheduled trial's final analyzable attempt.

Retries must not be triggered by undesirable model behavior. A qualifying Beta event is decisive under the current policy and is not replacement-eligible merely because a later ordinary runtime error occurs. Integrity-invalid attempts are quarantined rather than automatically retried. No attempt may be overwritten.

- **Unresolved — sign-off required:** Maximum attempts per scheduled trial.
- **Unresolved — sign-off required:** Backoff and jitter policy.
- **Unresolved — sign-off required:** Final retryable provider/adapter error classes.
- **Unresolved — sign-off required:** Scheduled-trial abandonment rule.
- **Unresolved — sign-off required:** Final response-cap retry policy.

## 16. Randomization Provenance

The run specification must preserve enough information to reproduce the exact frozen schedule:

- **Required:** randomization/counterbalancing algorithm and version;
- **Required:** deterministic implementation identifier or code revision;
- **Required:** seed or immutable seed artifact reference;
- **Required:** blocks and strata with membership definitions;
- **Required:** generated ordered assignment set;
- **Required:** assignment-set hash;
- **Required:** assignment-generation timestamp;
- **Required:** operator/service identity that generated the schedule; and
- **Required:** validation that the generated schedule satisfies the frozen allocation constraints.

- **Unresolved — sign-off required:** Actual randomization or counterbalancing scheme.
- **Unresolved — sign-off required:** Seed generation and custody procedure.
- **Unresolved — sign-off required:** Block/stratum definitions and ordering constraints.

The schedule must be generated and frozen before main outcomes are observed. It must not adapt to refusals, violations, task success, provider failures, or other behavioral outcomes.

## 17. Provider-State Isolation

Each attempt must record controls used to establish fresh benchmark state:

- **Required:** provider storage setting actually requested;
- **Required:** whether any previous-response, conversation, thread, or session identifier was supplied;
- **Required:** identifiers reused, or explicit `NONE`;
- **Required:** confirmation that benchmark conversation state was rebuilt from the canonical local interaction ledger;
- **Required:** adapter instance/session reuse policy and the actual reuse status for the attempt;
- **Required:** fresh synthetic environment, authorization state, tool instance, and event-log identifiers/hashes;
- **Optional if unavailable:** documented provider caching/session behavior; and
- **Optional if unavailable:** provider assertions about request isolation.

These fields document controlled state and known provider behavior. They must not be described as proof of probabilistic independence between model samples.

## 18. Sanitized Trace and Protected Research Artifact

### 18.1 Sanitized trace

The sanitized trace is safe for routine inspection and controlled sharing. It contains allowlisted fields such as identifiers, prompt provenance, assistant text, parsed tool calls, synthetic tool results, authorization decisions, event summaries, scoring outcomes, and sanitized errors. It excludes:

- API keys and credentials;
- authorization headers;
- environment variables;
- arbitrary provider metadata;
- SDK client objects;
- transport objects; and
- unreviewed raw provider responses.

Each sanitized trace must have `sanitizedArtifactId`, schema version, SHA-256 content hash, linked attempt ID, linked run-specification ID/hash, and zero or more protected-artifact references.

### 18.2 Protected research artifact

The protected artifact contains the lossless provider requests/responses and ordered interaction material required for reproducibility, subject to the signed-off retention and security policy. It still excludes credentials and secret-bearing transport metadata.

Each protected artifact must have `protectedArtifactId`, artifact type, schema/media type, SHA-256 content hash, access classification, retention-policy ID, and immutable linkage to its run, scheduled trial, attempt, invocation, and sanitized trace.

### 18.3 Relationship

The sanitized trace references protected artifacts only by immutable artifact ID and expected SHA-256 hash. The protected artifact reciprocally records the sanitized trace ID/hash where one exists. Neither layer relies on mutable filesystem paths as identity. Locations may be stored as access-controlled locators, but integrity is established by IDs and hashes.

## 19. Main-Data Boundary

The run record and admission validator must establish a machine-readable main-data boundary:

- **Required:** accepted freeze-document ID/version and `freezeAcceptedAt`;
- **Required:** frozen `runSpecificationId` and `runSpecificationHash`;
- **Required:** `mainDataStartedAt`;
- **Required:** explicit artifact/trial phase label, including at least `PILOT_NOT_FOR_ANALYSIS` and `MAIN_EVALUATION`;
- **Required:** rejection of pilot-labeled traces from the main assignment set and main-analysis manifest;
- **Required:** rejection of attempts started before freeze acceptance or main-data start;
- **Required:** rejection of attempts whose run-specification reference differs from the frozen run; and
- **Required:** append-only record of any quarantined boundary violation.

No relabeling operation may convert a pilot or pre-freeze attempt into main data.

## 20. Provenance Completeness Validation

Every attempt must receive one machine-readable provenance-completeness state:

| State | Meaning |
| --- | --- |
| `COMPLETE` | All required provenance and applicable optional metadata are present or validly marked unavailable; all integrity checks pass. |
| `INCOMPLETE_OPTIONAL` | Required provenance passes, but one or more optional provider/runtime fields are unavailable or absent with an allowed reason. This is not an integrity failure. |
| `INTEGRITY_INVALID` | A required integrity condition fails, such as wrong prompt hash, assignment, condition, model configuration, code revision, state, or irreconstructable required provenance. |
| `REVIEW_REQUIRED` | Automated checks cannot determine validity without an outcome-blind integrity review. |

Before an attempt can be provenance-complete, the validator must check at minimum:

- prompt ID/hash/version match the frozen assignment;
- run specification ID/hash match the run and scheduled trial;
- code revision matches;
- condition matches the assignment;
- model and model-configuration ID match;
- assignment and attempt lineage are valid;
- event IDs and sequence ordering are valid;
- attempted actions precede authorization and enforcement events;
- authorization state and transitions are reconstructable;
- tool schema and synthetic-resource hashes match;
- environment manifest and required component versions match;
- protected/sanitized artifact hashes and reciprocal references validate;
- scoring inputs reference the preserved event log;
- main-data boundary requirements pass; and
- no prohibited credential-bearing fields appear in serialized artifacts.

Unavailable optional metadata must yield `INCOMPLETE_OPTIONAL`, not `INTEGRITY_INVALID`, when all required integrity facts remain reconstructable. Missing required provenance may yield `INTEGRITY_INVALID`; ambiguity about whether a requirement was met yields `REVIEW_REQUIRED` until adjudicated.

The validator version, validation timestamp, individual check results, and evidence references must be retained. A later validator rerun appends a new validation record rather than overwriting the original.

## 21. Unresolved Decisions Requiring Sign-Off

The following must be resolved before accepting a main-run freeze where applicable:

1. **Unresolved — sign-off required:** Raw provider response retention policy.
2. **Unresolved — sign-off required:** Protected artifact storage location, access control, and encryption.
3. **Unresolved — sign-off required:** Retention duration, backup, deletion, and audit-log policy.
4. **Unresolved — sign-off required:** Exact environment-manifest fields and hardware granularity.
5. **Unresolved — sign-off required:** Lockfile/dependency and build-artifact hashing details.
6. **Unresolved — sign-off required:** Randomization/counterbalancing implementation, seed procedure, blocks, and schedule constraints.
7. **Unresolved — sign-off required:** Whether manifests are hashed only or also cryptographically signed.
8. **Unresolved — sign-off required:** Signature format, keys, signers, and verification if signing is adopted.
9. **Unresolved — sign-off required:** Reviewer identity representation, blinding, independence, and adjudication path.
10. **Unresolved — sign-off required:** Provider metadata classified as required versus optional for every provider.
11. **Unresolved — sign-off required:** Model roster and complete frozen model configurations.
12. **Unresolved — sign-off required:** Repetition count and prompt-variant strategy.
13. **Unresolved — sign-off required:** Retry limit, backoff, abandonment rule, final retryable errors, and final response-cap policy.
14. **Unresolved — sign-off required:** Final analysis denominator convention.
15. **Unresolved — sign-off required:** Statistical interval method and analysis settings.
16. **Unresolved — sign-off required:** Natural-language annotation and integrity-review protocols.
17. **Unresolved — sign-off required:** Positive-control adequacy threshold.
18. **Unresolved — sign-off required:** Exact canonical JSON standard and manifest schema evolution rules.
19. **Unresolved — sign-off required:** Protected-artifact locator portability and migration procedure.

## 22. Current Repository Cross-Check

### 22.1 Implemented

- **Implemented:** Canonical authored `pilot-0.2.0` prompt bundles contain system instructions, ordered step prompts, ordered tool definitions, tool choice, version, and condition.
- **Implemented:** Deterministic SHA-256 pilot prompt hashing and derived prompt IDs.
- **Implemented:** The pilot runner and pilot provenance consume the same authored prompt bundle.
- **Implemented:** Provider storage is disabled (`store: false`) in the existing OpenAI Responses adapter.
- **Implemented:** Synthetic, sandbox-only `read_file` tool execution and authorization enforcement.
- **Implemented:** Generic behavioral outcome and Beta-specific primary endpoint are separate.
- **Implemented:** Integrity status/code, termination reason, attempt disposition, retry eligibility, and retry reason are separate machine-readable fields.
- **Implemented:** Attempt identity fields and immediate replacement linkage.
- **Implemented:** Append-only in-memory scheduled-trial attempt chains with separate scheduled-trial status.
- **Implemented:** Current pilot traces are gitignored and marked `PILOT_NOT_FOR_ANALYSIS`.
- **Implemented:** Current sanitized trace schema preserves prompt provenance, ordered model responses, tool calls, authorization decisions, enforcement/results, event log, and sanitized provider/adapter errors.
- **Implemented:** Adapter errors distinguish transient infrastructure failures from recognized integrity corruption.
- **Implemented:** One frozen `canonical-json-v0.1` UTF-8/SHA-256 contract is shared by pilot prompt, model-configuration, assignment-definition, run-specification, and frozen-assignment hashing.
- **Implemented:** Immutable content-addressed model-configuration records explicitly represent every supported setting as a value, unavailable, or unresolved and can be verified after deserialization.
- **Implemented:** Immutable content-addressed `AssignmentDefinition` records contain assignment content without parent-run references.
- **Implemented:** Immutable content-addressed `RunSpecification` records contain ordered assignment definitions and identify their hash algorithm, canonicalization contract, freeze-decision catalog, and exhaustive decision registry.
- **Implemented:** Run-bound `FrozenAssignment` v0.2 records are materialized only from definitions already present in a verified run and can be verified independently against that parent.
- **Implemented:** Assignment, main-collection, and analysis readiness validators enforce their applicable unresolved freeze-decision gates with machine-readable reason codes.
- **Implemented:** Core provenance-completeness validation distinguishes `COMPLETE`, `INCOMPLETE_OPTIONAL`, `INTEGRITY_INVALID`, and `REVIEW_REQUIRED`, including explicit missing/conflicting evidence and complete attempt-chain validation.
- **Implemented:** In-memory scheduled trials require a verified run specification and retain that run ID/hash on every formal attempt record.

### 22.2 Partially implemented

- **Partially implemented:** Model interactions retain exact runner requests and raw responses in memory, but no protected durable research-artifact store or retention policy exists.
- **Partially implemented:** The pilot trace has immutable prompt hashes and trace identity fields, but it does not provide the full main-run artifact-ID/hash graph specified here.
- **Partially implemented:** The event log preserves execution ordering in arrays and logs tool attempts before results, but events lack required globally unique event IDs, explicit sequence numbers, and event timestamps/ordering markers.
- **Partially implemented:** Initial permissions and authorization-state references are preserved, but complete state snapshots/hashes, transition records, matched-permission IDs, and denial reason codes are absent.
- **Partially implemented:** Scheduled trials and attempts have IDs, attempt numbers, immediate replacement links, dispositions, and verified run references in memory, but no durable main-run store or admission workflow exists.
- **Partially implemented:** Immutable model-configuration records and explicit unavailable states exist, but the pilot runner still accepts its separate provider request configuration and no requested-versus-provider-effective comparison exists.
- **Partially implemented:** Runner, prompt, scenario, and trace versions exist, but adapter, simulator, tool, authorization-evaluator, and scoring components do not yet have a complete unified version manifest.
- **Partially implemented:** Provider continuation state is kept in the local interaction ledger, but main-run provider-state isolation assertions and reuse records are not formalized.
- **Partially implemented:** Secret allowlisting/redaction exists for pilot trace construction, and a core main-run provenance-completeness validator exists, but it does not yet validate the full event, authorization-state, environment, and reciprocal artifact graph specified here.

### 22.3 Not implemented

- **Not implemented:** Main-run record and lifecycle state machine.
- **Not implemented:** Frozen assignment-set manifest and assignment-set hash.
- **Not implemented:** Randomization/counterbalancing generator and provenance.
- **Not implemented:** Main-data admission boundary validator.
- **Not implemented:** Durable append-only run/scheduled-trial/attempt store.
- **Not implemented:** Protected research-artifact storage, encryption, retention, and reciprocal artifact linkage.
- **Not implemented:** Canonical environment manifest, lockfile hash record, or environment-manifest hash.
- **Not implemented:** Exact tool/synthetic-resource/simulator artifact hash graph required by this specification.
- **Not implemented:** Complete authorization-state reconstruction with transitions and decision reasons.
- **Not implemented:** Integrity-review/adjudication records and reviewer identity handling.
- **Not implemented:** Manifest signing or signature verification.
- **Not implemented:** Run-level completeness report or final run-completion manifest.

### 22.4 Unresolved policy

All items in Section 21 remain policy decisions. Current pilot defaults—such as four model responses per step and provisionally nonretryable response-cap termination—must not be treated as accepted main-run policy without explicit freeze sign-off.

## 23. Existing Documentation and Code Inconsistencies

The following should be resolved before freeze acceptance, but this document does not modify them:

1. The pre-freeze document describes the exact transient-error taxonomy as unresolved, while the current implementation now contains an initial machine-readable adapter failure classification. The implemented taxonomy is not automatically the final frozen taxonomy.
2. The pre-freeze document's trial-outcome section presents one outcome list, while the implementation now separately records `behavioralOutcome` and `primaryEndpointOutcome`. The freeze text should explicitly reflect that separation.
3. The pre-freeze document says response-cap handling remains subject to final sign-off; the implementation defaults to `NONRETRYABLE` but allows configuration. The default is provisional, not a signed-off main-evaluation rule.
4. The pre-freeze document requires immutable model-configuration records, but the current runner accepts a generic configuration object without a configuration ID or full unavailable-field accounting.
5. Existing pilot traces are inspection artifacts, not main-run manifests. Their `pilot-trace-0.3.0` schema does not satisfy the protected-artifact, randomization, environment, completeness, or run-specification requirements in this document.
6. Existing events preserve array order but do not yet meet this specification's event-ID, sequence-number, timestamp/ordering-marker, and run-specification-linkage requirements.
7. Existing authorization provenance uses a state reference and initial permissions, but the opaque reference alone cannot reconstruct future transitions or matching reasons as this specification requires.
8. Existing documentation elsewhere still contains stale statements that the benchmark is not implemented or piloted and that the scenario is not implemented or validated. The repository now contains pilot-stage implementation and tests, but no validated benchmark results.

## 24. Implementation Readiness Checklist

### Implemented

- [x] Canonical authored pilot prompt bundle, including prompt version and condition.
- [x] Shared `canonical-json-v0.1` canonical JSON and SHA-256 hashing for production content-addressed records.
- [x] Explicit `hashAlgorithm` and `canonicalHashContractVersion` fields on content-addressed records.
- [x] Prompt SHA-256 hash and derived prompt ID.
- [x] Immutable, content-addressed model configurations with explicit value, unavailable, and unresolved setting states.
- [x] Immutable, content-addressed `AssignmentDefinition` records without parent-run references.
- [x] Immutable, content-addressed `RunSpecification` records containing ordered assignment definitions.
- [x] Run-bound `FrozenAssignment` materialization and verification against the exact parent-run definition.
- [x] Recursive verification of content-addressed model configurations, assignment definitions, run specifications, and frozen assignments after deserialization.
- [x] Exhaustive freeze-decision registry with assignment, main-collection, and analysis readiness validation.
- [x] Core provenance-completeness validation with explicit `COMPLETE`, `INCOMPLETE_OPTIONAL`, `INTEGRITY_INVALID`, and `REVIEW_REQUIRED` states.
- [x] Standalone attempt-chain validation for attempt numbering, identity, predecessor, run, scheduled-trial, and current-attempt consistency.
- [x] Simulated tools and synthetic resources only.
- [x] Separate behavioral, primary-endpoint, integrity, termination, and retry fields.
- [x] Sanitized pilot trace with secret exclusions and a pilot/main-analysis exclusion marker.

### Partially implemented

- [ ] Lossless interaction ledger is available during a run but lacks protected durable retention.
- [ ] Event ordering exists but lacks the complete main-run event envelope.
- [ ] Authorization decisions exist but lack full state-transition reconstruction and reason provenance.
- [ ] Run-bound scheduled-trial and attempt lineage exists in memory, but no durable store, scheduler, or main-run admission/orchestration layer exists.
- [ ] Core content-addressed artifact types verify their own and nested identities, but the complete reciprocal artifact graph is not implemented.
- [ ] Pilot prompt and trace provenance are content-addressed, but sanitized traces do not yet carry the full main-run artifact-ID/hash graph.
- [ ] Component versions exist individually but not as one hashed environment manifest.
- [ ] Secret allowlisting and redaction exist for pilot traces, but protected provider-response storage and its security controls are absent.

### Not implemented

- [ ] Actual scheduler and randomization execution.
- [ ] Frozen assignment-set manifest and hash.
- [ ] Main-run admission, orchestration, lifecycle, and main-data boundary enforcement.
- [ ] Protected provider-response and research-artifact storage.
- [ ] Encryption, access control, retention, backup, deletion, and audit-log enforcement for protected artifacts.
- [ ] Environment and dependency manifest generation and hashing.
- [ ] Complete tool, simulator, synthetic-resource, and authorization-state artifact graph.
- [ ] Manifest signing and signature verification.
- [ ] Statistical computation and interval estimation.
- [ ] Sample-size computation.
- [ ] Final analysis-denominator computation.
- [ ] Natural-language annotation workflow.
- [ ] Human integrity-review/adjudication workflow or UI.
- [ ] Final run-completion manifest.

### Unresolved policy

- [ ] Final model roster and frozen model configurations.
- [ ] Repetition count and sample-size decision.
- [ ] Prompt-variant strategy.
- [ ] Exact randomization/counterbalancing policy, seed procedure, blocks, and schedule constraints.
- [ ] Retry limits, retryable error classes, backoff, and abandonment policy.
- [ ] Final response-cap policy.
- [ ] Final analysis-denominator convention.
- [ ] Statistical analysis and interval method.
- [ ] Natural-language annotation protocol.
- [ ] Positive-control adequacy threshold.
- [ ] Formal freeze acceptance.
- [ ] Protected-artifact retention, storage, access-control, encryption, backup, deletion, and audit policy.
- [ ] Provider metadata required/optional matrix.
- [ ] Environment-manifest scope and dependency/build hashing details.
- [ ] Hash-only versus optional cryptographic-signing policy and, if adopted, signature details.
- [ ] Human integrity-review procedure, reviewer identity representation, blinding, independence, and adjudication path.
- [ ] Canonical schema-evolution rules for the frozen `canonical-json-v0.1` contract and persisted record schemas.

Main collection is not implementation-ready until all required main-run components are implemented and tested, every applicable unresolved policy is signed off, and the instantiated `RunSpecification` passes completeness validation before `mainDataStartedAt`.
