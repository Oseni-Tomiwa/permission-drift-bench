# Permission Drift Bench — Scope v0.1 Provider Verification

## Status

Pre-freeze evidence review, completed 2026-10-18 and reconciled with the two approved candidate-record corrections. This document describes the current `model-configuration-v0.2` candidate records against provider documentation and repository implementation. It does not freeze the roster, authorize main-data collection, or reinterpret pilot observations as research evidence.

## Classification Key

- `VERIFIED_AUTHORITATIVE`: supported by current first-party provider documentation.
- `VERIFIED_IMPLEMENTATION_ONLY`: verified from repository code, tests, lockfile, or a local pilot integration artifact, but not asserted as an external provider contract.
- `UNRESOLVED_EXTERNAL`: current authoritative documentation does not establish the needed guarantee.
- `CANDIDATE_CHANGE_REQUIRES_APPROVAL`: authoritative documentation conflicts with, or materially refines, a candidate record; changing the content-addressed record requires explicit approval.
- `NOT_APPLICABLE`: the field does not apply to the selected provider/API path.

Provider documentation was accessed on 2026-10-18. Repository implementation observations are not external claims.

## Authoritative Sources

### OpenAI

- [GPT-6.1 Sol model page](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
- [Create a model response](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [Conversation state](https://developers.openai.com/api/docs/guides/conversation-state)
- [Reasoning models](https://developers.openai.com/api/docs/guides/reasoning)
- [Programmatic Tool Calling](https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling)
- [Background mode](https://developers.openai.com/api/docs/guides/background)
- [Data controls in the OpenAI platform](https://developers.openai.com/api/docs/guides/your-data)

### Google

- [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)
- [Models and model version name patterns](https://ai.google.dev/gemini-api/docs/models)
- [Interactions API overview](https://ai.google.dev/gemini-api/docs/interactions-overview)
- [Interactions API v1beta reference](https://ai.google.dev/api/interactions-api)
- [Interactions API v1 reference](https://ai.google.dev/api/interactions-api-v1)
- [Function calling](https://ai.google.dev/gemini-api/docs/function-calling)
- [Gemini thinking](https://ai.google.dev/gemini-api/docs/thinking)
- [Zero data retention in the Gemini Developer API](https://ai.google.dev/gemini-api/docs/zdr)

### Anthropic

- [Claude Sonnet 5.5 overview](https://platform.claude.com/docs/en/models/sonnet-5-5/overview)
- [Model IDs and versioning](https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions)
- [Messages API reference](https://platform.claude.com/docs/en/api/http/messages)
- [Effort](https://platform.claude.com/docs/en/build-with-claude/effort)
- [Parallel tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/parallel-tool-use)
- [Streaming messages](https://platform.claude.com/docs/en/build-with-claude/streaming)
- [TypeScript SDK](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript)
- [API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)

## External Verification Matrix

### OpenAI Candidate

The requested identity remains `gpt-6.1-sol` on the OpenAI Responses API. The approved background-state correction changes only the content-addressed candidate record, not the requested model or adapter request behavior.

| Candidate field | Current value | Classification | Reconciliation |
| --- | --- | --- | --- |
| `identity.provider` | `openai` | `VERIFIED_AUTHORITATIVE` | The selected provider is OpenAI. |
| `identity.providerBackend` | `OpenAI Responses API` | `VERIFIED_AUTHORITATIVE` | GPT-6.1 Sol is documented for tool calling through Responses. |
| `identity.apiSurface` | `responses-v1` | `VERIFIED_AUTHORITATIVE` | The documented endpoint is `/v1/responses`. |
| `identity.requestedModel` | `gpt-6.1-sol` | `VERIFIED_AUTHORITATIVE` | The exact ID is documented and currently available. |
| `identity.adapterName`, `identity.adapterVersion` | repository values | `VERIFIED_IMPLEMENTATION_ONLY` | These are benchmark implementation identities. |
| `identity.sdkPackage`, `identity.sdkVersion` | `openai@7.15.0` | `VERIFIED_IMPLEMENTATION_ONLY` | Pinned locally; not a provider model guarantee. |
| `settings.snapshotVersion` | unavailable | `UNRESOLVED_EXTERNAL` | The model page lists only `gpt-6.1-sol` under snapshots. It does not document a dated ID or an immutability guarantee for that name. |
| `settings.temperature`, `settings.topP` | omitted | `VERIFIED_IMPLEMENTATION_ONLY` | The adapter deliberately omits both. This review makes no cross-provider equivalence claim. |
| `settings.reasoning` | effort `medium` | `VERIFIED_AUTHORITATIVE` | GPT-6.1 Sol supports `medium`. |
| `settings.thinkingMode` | not applicable | `NOT_APPLICABLE` | OpenAI exposes the selected control as reasoning effort, not the benchmark's separate `thinkingMode` field. |
| `settings.outputTokenLimit` | `32768` | `VERIFIED_AUTHORITATIVE` | It is below the documented 128K model maximum and maps to `max_output_tokens`. |
| `settings.seed` | omitted | `VERIFIED_AUTHORITATIVE` | The current Responses create schema does not expose a seed parameter. |
| `settings.toolChoice` | `auto` | `VERIFIED_AUTHORITATIVE` | Responses documents `tool_choice`; the authored bundle supplies `auto`. |
| `settings.parallelToolCalls` | `false` | `VERIFIED_AUTHORITATIVE` | Responses documents `parallel_tool_calls` as an optional Boolean. |
| `settings.providerStorage` | `false` | `VERIFIED_AUTHORITATIVE` | `store:false` disables Response-object persistence; it is not a provider-wide ZDR guarantee. |
| `settings.background` | omitted intentionally | `VERIFIED_AUTHORITATIVE` | Responses supports optional `background`; the benchmark omits it and remains on the existing foreground path. The adapter request behavior is unchanged. |
| `settings.providerSession` | `NONE` | `VERIFIED_AUTHORITATIVE` | The benchmark does not create a Conversation object and uses client-managed state. |
| `settings.continuationStrategy` | local stateless transcript reconstruction | `VERIFIED_AUTHORITATIVE` | OpenAI documents replaying complete prior output with `store:false`. |
| `settings.providerAddressableContinuationId` | omitted | `VERIFIED_AUTHORITATIVE` | `previous_response_id` is optional and is not used for this stateless path. |
| `settings.automaticSdkRetries` | `0` | `VERIFIED_IMPLEMENTATION_ONLY` | Set by benchmark smoke-client construction. |
| `settings.responseCapPerStep` | `4` | `VERIFIED_IMPLEMENTATION_ONLY` | Benchmark execution guardrail, not a provider field. |
| `settings.streaming` | `false` | `VERIFIED_IMPLEMENTATION_ONLY` | The adapter calls the non-streaming create method. |
| `settings.endpoint` | `OPENAI_SDK_DEFAULT` | `VERIFIED_IMPLEMENTATION_ONLY` | The repository does not override the SDK endpoint. |
| `settings.backendMode` | `RESPONSES_API` | `VERIFIED_AUTHORITATIVE` | Matches the selected API. |
| `settings.apiVersion` | not applicable | `NOT_APPLICABLE` | The version is already represented by `/v1/responses` and `responses-v1`. |
| `settings.vertexBackend` | not applicable | `NOT_APPLICABLE` | Vertex is not part of this provider path. |
| `settings.providerStateReplay` | `OUTPUT_ITEMS` | `VERIFIED_AUTHORITATIVE` | Complete response output items are the documented stateless replay unit. |
| `settings.reasoningStateInclusion` | `reasoning.encrypted_content` | `VERIFIED_AUTHORITATIVE` | The include value remains accepted for compatibility, although current stateless Responses return encrypted reasoning by default. |
| `returnedModelPolicy` | `EXACT_REQUESTED_IF_PRESENT` | `UNRESOLVED_EXTERNAL` | The response `model` field is documented as the model ID used. The docs do not separately promise string equality after all routing/normalization. The conservative fail-closed policy is retained pending sign-off. |

Provider classification: `BLOCKED`.

Exact blockers are explicit acceptance of the absence of a separately documented fixed snapshot and explicit acceptance of the conservative returned-model policy.

### Google Candidate

Candidate identity remains `gemini-3.8-flash` on Gemini Developer API `interactions-v1beta`. No migration is performed by this review.

| Candidate field | Current value | Classification | Reconciliation |
| --- | --- | --- | --- |
| `identity.provider` | `google` | `VERIFIED_AUTHORITATIVE` | The selected provider is Google. |
| `identity.providerBackend` | `Gemini Developer API` | `VERIFIED_AUTHORITATIVE` | The adapter targets the Developer API, not Vertex AI. |
| `identity.apiSurface` | `interactions-v1beta` | `VERIFIED_AUTHORITATIVE` | The official beta reference documents `/v1beta/interactions`; stable v1 also exists. |
| `identity.requestedModel` | `gemini-3.8-flash` | `VERIFIED_AUTHORITATIVE` | The model is documented as stable and as supported by Interactions/function calling. |
| `identity.adapterName`, `identity.adapterVersion` | repository values | `VERIFIED_IMPLEMENTATION_ONLY` | These are benchmark implementation identities. |
| `identity.sdkPackage`, `identity.sdkVersion` | `@google/genai@2.29.1` | `VERIFIED_IMPLEMENTATION_ONLY` | Pinned locally; not a provider model guarantee. |
| `settings.snapshotVersion` | unavailable | `UNRESOLVED_EXTERNAL` | Google calls the ID stable and says stable IDs usually do not change, but no dated `gemini-3.8-flash` snapshot is documented. |
| `settings.temperature`, `settings.topP` | omitted | `VERIFIED_AUTHORITATIVE` | Current Gemini 3.8 migration guidance says to remove these sampling parameters. |
| `settings.reasoning` | effort `medium` | `VERIFIED_AUTHORITATIVE` | `gemini-3.8-flash` supports `medium` thinking. |
| `settings.thinkingMode` | `THINKING_LEVEL_MEDIUM` | `VERIFIED_AUTHORITATIVE` | Maps to documented `generation_config.thinking_level`. |
| `settings.outputTokenLimit` | `32768` | `VERIFIED_AUTHORITATIVE` | It is below the documented 65,536-token maximum and maps to `max_output_tokens`. |
| `settings.seed` | omitted | `VERIFIED_AUTHORITATIVE` | Interactions v1 documents an optional seed; the benchmark intentionally does not send it. |
| `settings.toolChoice` | `auto` | `VERIFIED_AUTHORITATIVE` | Interactions documents `auto` tool choice. |
| `settings.parallelToolCalls` | unavailable | `VERIFIED_AUTHORITATIVE` | The current Interactions request schema does not document an equivalent parallel-call suppression field. |
| `settings.providerStorage` | `false` | `VERIFIED_AUTHORITATIVE` | Interactions documents `store:false` for stateless operation; it does not by itself establish project-wide ZDR. |
| `settings.background` | `false` | `VERIFIED_AUTHORITATIVE` | Interactions documents foreground/background control. |
| `settings.providerSession` | `NONE` | `VERIFIED_AUTHORITATIVE` | The benchmark uses no provider-managed chat/session abstraction. |
| `settings.continuationStrategy` | local stateless interaction reconstruction | `VERIFIED_AUTHORITATIVE` | Official function-calling guidance requires full history in stateless mode. |
| `settings.providerAddressableContinuationId` | omitted | `VERIFIED_AUTHORITATIVE` | `previous_interaction_id` is optional and is not used. |
| `settings.automaticSdkRetries` | `0` | `VERIFIED_IMPLEMENTATION_ONLY` | Set by benchmark smoke-client construction. |
| `settings.responseCapPerStep` | `4` | `VERIFIED_IMPLEMENTATION_ONLY` | Benchmark execution guardrail, not a provider field. |
| `settings.streaming` | `false` | `VERIFIED_IMPLEMENTATION_ONLY` | The adapter uses non-streaming `interactions.create`. |
| `settings.endpoint` | `https://generativelanguage.googleapis.com/` | `VERIFIED_AUTHORITATIVE` | This is the documented Gemini Developer API host. |
| `settings.backendMode` | `GEMINI_DEVELOPER_API` | `VERIFIED_AUTHORITATIVE` | Matches the selected provider backend. |
| `settings.apiVersion` | `v1beta` | `VERIFIED_AUTHORITATIVE` | Matches the currently tested endpoint. Moving to v1 is a candidate change. |
| `settings.vertexBackend` | `false` | `VERIFIED_AUTHORITATIVE` | The selected backend is not Vertex AI. |
| `settings.providerStateReplay` | `THOUGHT_AND_SIGNATURE_STEPS` | `VERIFIED_AUTHORITATIVE` | Stateless mode requires exact replay of thought and model-generated steps/signatures. |
| `settings.reasoningStateInclusion` | not applicable | `NOT_APPLICABLE` | Google state is represented by replayed Interactions steps rather than an OpenAI-style include selector. |
| `returnedModelPolicy` | `OBSERVE_SEPARATELY` | `VERIFIED_AUTHORITATIVE` | The API returns a separate `model` field but does not document alias-equivalence rules. Observation without inferred equivalence remains appropriate. |

Provider classification: `BLOCKED`.

Exact blockers are explicit sign-off to keep v1beta or approve a separately validated v1 candidate, plus explicit acceptance of the stable-but-not-dated model identity limitation.

### Anthropic Candidate

Candidate identity remains `claude-sonnet-5-5` on the Anthropic Messages API. Live adapter validation remains `PENDING_CREDENTIALS`; this is not a model failure.

| Candidate field | Current value | Classification | Reconciliation |
| --- | --- | --- | --- |
| `identity.provider` | `anthropic` | `VERIFIED_AUTHORITATIVE` | The selected provider is Anthropic. |
| `identity.providerBackend` | `Anthropic Messages API` | `VERIFIED_AUTHORITATIVE` | The official API exposes Claude Sonnet 5.5 through `/v1/messages`. |
| `identity.apiSurface` | `messages-v1` | `VERIFIED_AUTHORITATIVE` | Matches the documented API path. |
| `identity.requestedModel` | `claude-sonnet-5-5` | `VERIFIED_AUTHORITATIVE` | The exact ID is documented and currently available. |
| `identity.adapterName`, `identity.adapterVersion` | repository values | `VERIFIED_IMPLEMENTATION_ONLY` | These are benchmark implementation identities. |
| `identity.sdkPackage`, `identity.sdkVersion` | `@anthropic-ai/sdk@0.133.0` | `VERIFIED_IMPLEMENTATION_ONLY` | Pinned locally; not a provider model guarantee. |
| `settings.snapshotVersion` | `claude-sonnet-5-5` | `VERIFIED_AUTHORITATIVE` | Anthropic documents post-4.6 dateless IDs as canonical pinned snapshots. The candidate now records the requested identifier itself as the fixed snapshot identity; no dated alias is invented. |
| `settings.temperature`, `settings.topP` | omitted as incompatible | `VERIFIED_AUTHORITATIVE` | Non-default sampling values return an error on Claude Sonnet 5.5; omission is documented. |
| `settings.reasoning` | effort `medium` | `VERIFIED_AUTHORITATIVE` | Sonnet 5.5 supports `medium`; Anthropic recommends it for well-specified multistep tool use. |
| `settings.thinkingMode` | `adaptive` | `VERIFIED_AUTHORITATIVE` | Adaptive thinking is supported and on by default; the adapter sends it explicitly. |
| `settings.outputTokenLimit` | `32768` | `VERIFIED_AUTHORITATIVE` | It is below the documented 128K maximum and maps to `max_tokens`. |
| `settings.seed` | unavailable | `VERIFIED_AUTHORITATIVE` | The current Messages request schema exposes no seed control. |
| `settings.toolChoice` | `auto` | `VERIFIED_AUTHORITATIVE` | Messages supports automatic tool choice. |
| `settings.parallelToolCalls` | `false` | `VERIFIED_AUTHORITATIVE` | `disable_parallel_tool_use:true` under auto tool choice limits a response to at most one tool call. |
| `settings.providerStorage` | provider controlled/unavailable | `VERIFIED_AUTHORITATIVE` | Messages exposes no request-level `store` field. Organization retention arrangements are separate. |
| `settings.background` | not applicable | `NOT_APPLICABLE` | The selected Messages request path is not a provider background-job API. |
| `settings.providerSession` | `NONE` | `VERIFIED_AUTHORITATIVE` | Messages is stateless and requires full conversational history. |
| `settings.continuationStrategy` | local full Messages replay | `VERIFIED_AUTHORITATIVE` | Matches documented stateless multi-turn use. |
| `settings.providerAddressableContinuationId` | omitted | `NOT_APPLICABLE` | Messages has no `previous_response_id`/`previous_interaction_id` analogue on this path. |
| `settings.automaticSdkRetries` | `0` | `VERIFIED_IMPLEMENTATION_ONLY` | Set by benchmark smoke-client construction; the SDK default would otherwise retry some errors. |
| `settings.responseCapPerStep` | `4` | `VERIFIED_IMPLEMENTATION_ONLY` | Benchmark execution guardrail, not a provider field. |
| `settings.streaming` | `true` | `VERIFIED_AUTHORITATIVE` | Anthropic recommends streaming for large `max_tokens`; the TypeScript helper accumulates a complete final Message. |
| `settings.endpoint` | `ANTHROPIC_SDK_DEFAULT` | `VERIFIED_IMPLEMENTATION_ONLY` | The repository does not override the SDK endpoint. |
| `settings.backendMode` | `MESSAGES_API` | `VERIFIED_AUTHORITATIVE` | Matches the selected API. |
| `settings.apiVersion` | not applicable | `NOT_APPLICABLE` | The API surface is already represented by `/v1/messages` and `messages-v1`. |
| `settings.vertexBackend` | not applicable | `NOT_APPLICABLE` | The candidate is first-party Claude API, not Google Cloud. |
| `settings.providerStateReplay` | thinking and redacted-thinking blocks | `VERIFIED_AUTHORITATIVE` | Thinking blocks are conversation-bound and must be passed back unchanged. |
| `settings.reasoningStateInclusion` | not applicable | `NOT_APPLICABLE` | Messages returns thinking blocks directly; no separate include selector is used. |
| `returnedModelPolicy` | `EXACT_REQUESTED_IF_PRESENT` | `UNRESOLVED_EXTERNAL` | The requested ID is a pinned snapshot and the response has a `model` field, but the documentation does not separately guarantee response-string equality. The conservative fail-closed policy is retained pending sign-off. |

Provider classification: `BLOCKED`.

Exact blockers are `PENDING_CREDENTIALS` live Condition-A integration validation and explicit acceptance of the conservative returned-model policy.

## Google v1beta Versus v1 Decision Memo

### `KEEP_V1BETA`

- Matches the current content-addressed candidate, adapter, tests, and successful Condition-A pilot integration.
- The exact request semantics used by the benchmark are already exercised on this surface.
- Retains beta-surface change risk.
- Avoids treating generic stable-v1 availability as proof that every `gemini-3.8-flash` detail has identical behavior there.

### `MIGRATE_TO_V1_BEFORE_FREEZE`

- Uses the stable endpoint and reduces dependence on a beta API contract.
- The stable v1 reference documents the required structural features: custom function calls/results, `store`, `background`, optional `previous_interaction_id`, `thinking_level`, tool choice, and thought/signature step types.
- The current v1 reference's enumerated model list does not yet explicitly list `gemini-3.8-flash`, while separate official model and Interactions pages do. That documentation gap prevents claiming exact v1 model compatibility as fully verified.
- Requires a new candidate identity/hash, adapter and test changes, and a new Condition-A integration validation. Existing v1beta pilot validation cannot validate v1.

### Recommendation

Recommend `KEEP_V1BETA` for the scope-v0.1 first run, subject to explicit sign-off. The recommendation is bounded to this run: it prioritizes the tested surface over an unvalidated migration, while recording beta-surface change risk. Moving to v1 remains `CANDIDATE_CHANGE_REQUIRES_APPROVAL` and should be reconsidered when the v1 reference explicitly confirms `gemini-3.8-flash` or a separately approved v1 candidate is tested.

## Snapshot and Name Mutability Findings

| Provider | Candidate ID | Finding |
| --- | --- | --- |
| OpenAI | `gpt-6.1-sol` | Exact ID and availability are documented. The model page lists only that ID under snapshots; no dated ID or explicit immutability promise was found. Reproducibility must therefore preserve requested and returned model fields and acknowledge the limitation. |
| Google | `gemini-3.8-flash` | Documented as a stable ID. Google says stable IDs point to a specific stable model and usually do not change, but no dated 3.8 Flash ID is documented. This is stronger than a `-latest` alias but not a strict immutability guarantee. |
| Anthropic | `claude-sonnet-5-5` | Documented as a canonical pinned snapshot under the post-4.6 naming scheme. No separate dated form is needed or documented for this generation. Serving infrastructure may still change around fixed weights/configuration. |

No undocumented alias or snapshot equivalence is inferred.

## Returned-Model Policy Findings

- OpenAI `EXACT_REQUESTED_IF_PRESENT`: retained. Official documentation identifies `response.model` as the model ID used but does not establish a separate alias-equivalence contract. The current policy is conservative and fail-closed, not an externally proven equivalence rule.
- Anthropic `EXACT_REQUESTED_IF_PRESENT`: retained. The requested ID is documented as pinned, but exact response-string echo semantics are not separately guaranteed.
- Google `OBSERVE_SEPARATELY`: retained. The API returns `interaction.model`; no authoritative alias-equivalence rule supports a stricter policy.

Any returned value must continue to be preserved separately from the requested model. No policy should normalize an undocumented alias.

## Retention and Storage Findings

### Request-Level Benchmark Controls

- OpenAI sends `store:false`, omits `previous_response_id`, and uses client-managed replay. This disables Response-object application-state storage but does not disable abuse-monitoring retention or all caching behavior. The candidate should describe foreground mode as an omission, not as non-applicability.
- Google sends `store:false` and `background:false`, omits `previous_interaction_id`, and replays full local state. This opts out of Interactions object storage for the request.
- Anthropic Messages has no request-level `store` switch. The API is stateless and the benchmark replays full local history.

### Provider-Wide Organization or Project Policy

- OpenAI default abuse-monitoring logs may retain customer content for up to 30 days. ZDR or Modified Abuse Monitoring requires provider approval and organization/project configuration. `store:false` is not equivalent to that approval.
- Google ZDR requires the documented account/project conditions and, for abuse-monitoring prompt logging, approval. `store:false` addresses Interactions state but is not by itself proof of project-wide ZDR.
- Anthropic ZDR is a separate organization-level arrangement enabled by Anthropic. It is not created by using stateless Messages. Claude Sonnet 5.5 is not listed among the documented models that necessarily require 30-day retention, but actual organization status still must be verified operationally.

The final run specification must record the applicable organization/project retention posture separately from model configuration. It must not infer that a request-level switch guarantees zero provider retention.

## Candidate Roster Sign-off and Retention Gate

The approved non-live roster decisions are recorded in the immutable candidate record `scope-v0.1-roster-signoff-v0.1:sha256:2298a36e7c7134a19185590f63c0fbbf9f808dd76390785f66419c9eb0b7652c`. It binds the exact OpenAI, Google, and Anthropic candidate configuration IDs to the bounded `KEEP_V1BETA` decision, accepted OpenAI/Google snapshot limitations, the three returned-model policies, and Anthropic's documented pinned identifier. It contains no live-validation or account-retention state and is not formal freeze acceptance.

Separate `provider-retention-posture-v0.1` records reproduce the relevant request controls from each candidate configuration and distinguish them from account facts. Their evidence types are limited to `AUTHORITATIVE_DOCUMENTATION`, `USER_ATTESTATION`, `ACCOUNT_UI_VERIFICATION`, `ORGANIZATION_POLICY`, or `UNVERIFIED`. All three candidate records currently leave organization/project reference, account-retention posture, zero-data-retention status, verification time, and review decision unresolved because those facts have not been supplied. No account ID, credential, or secret is required in these records.

The pre-main-run retention gate is fail-closed. Its result is `ACCEPTED`, `UNRESOLVED`, or `REJECTED`. `ACCEPTED` requires request controls matching the candidate configuration plus a known, evidenced, reviewed organization/project posture. Zero data retention is not universally required, but a record may not imply it without evidence. The deterministic roster-readiness evaluator also checks candidate hashes/schema, candidate sign-off, live validation, blocking provider ambiguity, and formal acceptance; it reports blockers without changing `MODEL_ROSTER_CONFIGURATIONS`.

## Remaining Roster Blockers

1. Record and approve the actual organization/project retention posture for OpenAI, Google, and Anthropic. Each current posture gate is `UNRESOLVED`; request-level switches do not settle account-level retention.
2. Anthropic live integration remains `PENDING_CREDENTIALS`. It must not be recorded as a provider/model failure.
3. Explicitly accept the final roster and resolve `MODEL_ROSTER_CONFIGURATIONS` only after the preceding evidence is complete.
4. Complete formal freeze acceptance separately. The candidate roster sign-off does not perform that action.

`MODEL_ROSTER_CONFIGURATIONS` cannot yet be resolved.
