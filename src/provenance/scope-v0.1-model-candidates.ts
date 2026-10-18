import { createModelConfiguration, verifyModelConfigurationRecord } from "./model-configuration.js";
import type { ModelConfigurationInput, ModelConfigurationRecord, ProviderSetting } from "./model-configuration.js";
import type { CanonicalJsonValue } from "./canonical-json.js";

export type ScopeV01Provider = "openai" | "google" | "anthropic";
export type AsymmetryClassification = "MATCHED" | "INTENTIONALLY_DIFFERENT" | "PROVIDER_UNAVAILABLE" | "NOT_APPLICABLE" | "AMBIGUOUS_REQUIRES_REVIEW";
export type LiveValidationStatus = "CONDITION_A_LIVE_PILOT_VALIDATED" | "PENDING_CREDENTIALS";

const value = (entry: CanonicalJsonValue): ProviderSetting => ({ state: "VALUE", value: entry });
const omitted = (reasonCode: "INTENTIONALLY_OMITTED" | "INCOMPATIBLE_WITH_FROZEN_CONFIGURATION" = "INTENTIONALLY_OMITTED"): ProviderSetting => ({ state: "OMITTED", reasonCode });
const unavailable = (reasonCode: "UNSUPPORTED_BY_PROVIDER" | "NOT_EXPOSED_BY_API" | "PROVIDER_CONTROLLED" = "NOT_EXPOSED_BY_API"): ProviderSetting => ({ state: "UNAVAILABLE", reasonCode });
const notApplicable = (): ProviderSetting => ({ state: "NOT_APPLICABLE" });

const common = {
  snapshotVersion: unavailable(), temperature: omitted(), topP: omitted(), outputTokenLimit: value(32768),
  seed: omitted(), toolChoice: value("auto"), providerSession: value("NONE"),
  providerAddressableContinuationId: omitted(), automaticSdkRetries: value(0), responseCapPerStep: value(4),
} as const;

const inputs: Record<ScopeV01Provider, ModelConfigurationInput> = {
  openai: {
    identity: { provider: "openai", providerBackend: "OpenAI Responses API", apiSurface: "responses-v1", requestedModel: "gpt-6.1-sol", adapterName: "OpenAIResponsesAdapter", adapterVersion: "openai-responses-adapter-v0.3.0", sdkPackage: "openai", sdkVersion: "7.15.0" },
    settings: { ...common, reasoning: value({ effort: "medium" }), thinkingMode: notApplicable(), parallelToolCalls: value(false), providerStorage: value(false), background: omitted(), continuationStrategy: value("LOCAL_STATELESS_TRANSCRIPT_RECONSTRUCTION"), streaming: value(false), endpoint: value("OPENAI_SDK_DEFAULT"), backendMode: value("RESPONSES_API"), apiVersion: notApplicable(), vertexBackend: notApplicable(), providerStateReplay: value("OUTPUT_ITEMS"), reasoningStateInclusion: value("reasoning.encrypted_content") },
    returnedModelPolicy: "EXACT_REQUESTED_IF_PRESENT",
  },
  google: {
    identity: { provider: "google", providerBackend: "Gemini Developer API", apiSurface: "interactions-v1beta", requestedModel: "gemini-3.8-flash", adapterName: "GoogleInteractionsAdapter", adapterVersion: "google-interactions-adapter-v0.2.0", sdkPackage: "@google/genai", sdkVersion: "2.29.1" },
    settings: { ...common, reasoning: value({ effort: "medium" }), thinkingMode: value("THINKING_LEVEL_MEDIUM"), parallelToolCalls: unavailable("NOT_EXPOSED_BY_API"), providerStorage: value(false), background: value(false), continuationStrategy: value("LOCAL_STATELESS_INTERACTION_RECONSTRUCTION"), streaming: value(false), endpoint: value("https://generativelanguage.googleapis.com/"), backendMode: value("GEMINI_DEVELOPER_API"), apiVersion: value("v1beta"), vertexBackend: value(false), providerStateReplay: value("THOUGHT_AND_SIGNATURE_STEPS"), reasoningStateInclusion: notApplicable() },
    returnedModelPolicy: "OBSERVE_SEPARATELY",
  },
  anthropic: {
    identity: { provider: "anthropic", providerBackend: "Anthropic Messages API", apiSurface: "messages-v1", requestedModel: "claude-sonnet-5-5", adapterName: "AnthropicMessagesAdapter", adapterVersion: "anthropic-messages-adapter-v0.2.0", sdkPackage: "@anthropic-ai/sdk", sdkVersion: "0.133.0" },
    settings: { ...common, snapshotVersion: value("claude-sonnet-5-5"), reasoning: value({ effort: "medium" }), thinkingMode: value("adaptive"), temperature: omitted("INCOMPATIBLE_WITH_FROZEN_CONFIGURATION"), topP: omitted("INCOMPATIBLE_WITH_FROZEN_CONFIGURATION"), seed: unavailable("UNSUPPORTED_BY_PROVIDER"), parallelToolCalls: value(false), providerStorage: unavailable("PROVIDER_CONTROLLED"), background: notApplicable(), continuationStrategy: value("LOCAL_FULL_MESSAGES_REPLAY"), streaming: value(true), endpoint: value("ANTHROPIC_SDK_DEFAULT"), backendMode: value("MESSAGES_API"), apiVersion: notApplicable(), vertexBackend: notApplicable(), providerStateReplay: value("THINKING_AND_REDACTED_THINKING_BLOCKS"), reasoningStateInclusion: notApplicable() },
    returnedModelPolicy: "EXACT_REQUESTED_IF_PRESENT",
  },
};

export function verifyCandidateModelConfigurationSet(
  values: readonly unknown[],
): readonly ModelConfigurationRecord[] {
  const records = values.map(verifyModelConfigurationRecord);
  const ids = new Set<string>();
  const providers = new Set<string>();
  for (const record of records) {
    if (ids.has(record.modelConfigurationId)) {
      throw new TypeError("Duplicate candidate model configuration identity");
    }
    if (providers.has(record.identity.provider)) {
      throw new TypeError("Conflicting candidate configurations for provider");
    }
    ids.add(record.modelConfigurationId);
    providers.add(record.identity.provider);
  }
  return Object.freeze(records);
}

const verifiedCandidates = verifyCandidateModelConfigurationSet([
  createModelConfiguration(inputs.openai),
  createModelConfiguration(inputs.google),
  createModelConfiguration(inputs.anthropic),
]);

export const SCOPE_V01_CANDIDATE_MODEL_CONFIGURATIONS = Object.freeze({
  openai: verifiedCandidates[0]!,
  google: verifiedCandidates[1]!,
  anthropic: verifiedCandidates[2]!,
});

const asymmetry = (dimension: string, classification: AsymmetryClassification, detail: string) => Object.freeze({ dimension, classification, detail });
export const SCOPE_V01_MODEL_ASYMMETRY_REGISTER = Object.freeze([
  asymmetry("requestedModel", "INTENTIONALLY_DIFFERENT", "The roster intentionally compares three provider-specific models."),
  asymmetry("reasoningControl", "INTENTIONALLY_DIFFERENT", "Medium labels are provider-specific controls and are not assumed behaviorally equivalent."),
  asymmetry("outputTokenLimit", "MATCHED", "All candidates use 32768."),
  asymmetry("toolChoice", "MATCHED", "All candidates use auto."),
  asymmetry("parallelToolCalls", "PROVIDER_UNAVAILABLE", "OpenAI and Anthropic suppress parallel calls; the Google Interactions path exposes no equivalent control."),
  asymmetry("storage", "PROVIDER_UNAVAILABLE", "OpenAI and Google send store false; Anthropic exposes no equivalent request field in this implementation."),
  asymmetry("background", "INTENTIONALLY_DIFFERENT", "Google sends false, OpenAI intentionally omits the supported control and remains foreground, and Anthropic Messages has no applicable background field."),
  asymmetry("continuationState", "INTENTIONALLY_DIFFERENT", "All continuation is client-managed, but provider reasoning/thought state formats differ."),
  asymmetry("automaticSdkRetries", "MATCHED", "All intended benchmark clients use zero automatic retries."),
  asymmetry("modelSnapshotMutability", "AMBIGUOUS_REQUIRES_REVIEW", "Anthropic's requested identifier is a documented pinned snapshot; OpenAI and Google have no separately documented dated immutable identifier."),
  asymmetry("returnedModelVerification", "INTENTIONALLY_DIFFERENT", "OpenAI and Anthropic require exact returned identity when present; Google is observed separately without inferred alias equivalence."),
]);
export const SCOPE_V01_MODEL_LIVE_VALIDATION: Readonly<Record<ScopeV01Provider, LiveValidationStatus>> = Object.freeze({
  openai: "CONDITION_A_LIVE_PILOT_VALIDATED", google: "CONDITION_A_LIVE_PILOT_VALIDATED", anthropic: "PENDING_CREDENTIALS",
});

export function candidateModelConfiguration(provider: string): ModelConfigurationRecord {
  const record = SCOPE_V01_CANDIDATE_MODEL_CONFIGURATIONS[provider as ScopeV01Provider];
  if (record === undefined) throw new TypeError(`Unknown scope-v0.1 candidate provider: ${provider}`);
  return record;
}
