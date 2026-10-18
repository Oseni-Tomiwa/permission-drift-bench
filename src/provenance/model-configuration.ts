import { CANONICAL_HASH_CONTRACT_VERSION, canonicalJson, deepFreezeCanonical, sha256CanonicalJson } from "./canonical-json.js";
import type { CanonicalJsonValue } from "./canonical-json.js";

export const MODEL_CONFIGURATION_SCHEMA_VERSION = "model-configuration-v0.2";
export const CONTENT_HASH_ALGORITHM = "sha256";

export type SettingReasonCode =
  | "UNSUPPORTED_BY_PROVIDER"
  | "NOT_EXPOSED_BY_API"
  | "PROVIDER_CONTROLLED"
  | "INTENTIONALLY_OMITTED"
  | "INCOMPATIBLE_WITH_FROZEN_CONFIGURATION";

export type ProviderSetting =
  | Readonly<{ state: "VALUE"; value: CanonicalJsonValue }>
  | Readonly<{ state: "OMITTED"; reasonCode: SettingReasonCode }>
  | Readonly<{ state: "UNAVAILABLE"; reasonCode: SettingReasonCode }>
  | Readonly<{ state: "NOT_APPLICABLE" }>
  | Readonly<{ state: "UNRESOLVED" }>;

export interface ModelConfigurationIdentity {
  readonly provider: string;
  readonly providerBackend: string;
  readonly apiSurface: string;
  readonly requestedModel: string;
  readonly adapterName: string;
  readonly adapterVersion: string;
  readonly sdkPackage: string;
  readonly sdkVersion: string;
}

export interface ProviderSettings {
  readonly snapshotVersion: ProviderSetting;
  readonly reasoning: ProviderSetting;
  readonly thinkingMode: ProviderSetting;
  readonly temperature: ProviderSetting;
  readonly topP: ProviderSetting;
  readonly outputTokenLimit: ProviderSetting;
  readonly seed: ProviderSetting;
  readonly toolChoice: ProviderSetting;
  readonly parallelToolCalls: ProviderSetting;
  readonly providerStorage: ProviderSetting;
  readonly background: ProviderSetting;
  readonly providerSession: ProviderSetting;
  readonly continuationStrategy: ProviderSetting;
  readonly providerAddressableContinuationId: ProviderSetting;
  readonly automaticSdkRetries: ProviderSetting;
  readonly responseCapPerStep: ProviderSetting;
  readonly streaming: ProviderSetting;
  readonly endpoint: ProviderSetting;
  readonly backendMode: ProviderSetting;
  readonly apiVersion: ProviderSetting;
  readonly vertexBackend: ProviderSetting;
  readonly providerStateReplay: ProviderSetting;
  readonly reasoningStateInclusion: ProviderSetting;
}

export type ReturnedModelPolicy = "EXACT_REQUESTED_IF_PRESENT" | "OBSERVE_SEPARATELY";

export interface ModelConfigurationInput {
  readonly identity: ModelConfigurationIdentity;
  readonly settings: ProviderSettings;
  readonly returnedModelPolicy: ReturnedModelPolicy;
}

export interface ModelConfigurationRecord extends ModelConfigurationInput {
  readonly schemaVersion: typeof MODEL_CONFIGURATION_SCHEMA_VERSION;
  readonly hashAlgorithm: typeof CONTENT_HASH_ALGORITHM;
  readonly canonicalHashContractVersion: typeof CANONICAL_HASH_CONTRACT_VERSION;
  readonly modelConfigurationId: string;
  readonly modelConfigurationHash: string;
}

const IDENTITY_KEYS = Object.freeze(["provider", "providerBackend", "apiSurface", "requestedModel", "adapterName", "adapterVersion", "sdkPackage", "sdkVersion"] as const);
const SETTING_KEYS = Object.freeze([
  "snapshotVersion", "reasoning", "thinkingMode", "temperature", "topP", "outputTokenLimit", "seed",
  "toolChoice", "parallelToolCalls", "providerStorage", "background", "providerSession", "continuationStrategy",
  "providerAddressableContinuationId", "automaticSdkRetries", "responseCapPerStep", "streaming", "endpoint",
  "backendMode", "apiVersion", "vertexBackend", "providerStateReplay", "reasoningStateInclusion",
] as const);
const INPUT_KEYS = Object.freeze(["identity", "settings", "returnedModelPolicy"]);
const RECORD_KEYS = Object.freeze(["schemaVersion", "hashAlgorithm", "canonicalHashContractVersion", "modelConfigurationId", "modelConfigurationHash", ...INPUT_KEYS]);
const REASONS = new Set<SettingReasonCode>(["UNSUPPORTED_BY_PROVIDER", "NOT_EXPOSED_BY_API", "PROVIDER_CONTROLLED", "INTENTIONALLY_OMITTED", "INCOMPATIBLE_WITH_FROZEN_CONFIGURATION"]);
const RETURNED_POLICIES = new Set<ReturnedModelPolicy>(["EXACT_REQUESTED_IF_PRESENT", "OBSERVE_SEPARATELY"]);

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be a plain record`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], name: string): void {
  const actual = Object.keys(value).sort(); const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) throw new TypeError(`${name} has missing or unknown fields`);
}

function rejectSecretShapedData(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) rejectSecretShapedData(item);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (/api.?key|authorization|headers?|environment|credential|secret/i.test(key)) {
      throw new TypeError("Model configuration cannot contain credential, secret, header, or environment data");
    }
    rejectSecretShapedData(nested);
  }
}

function validateSetting(name: string, value: unknown): ProviderSetting {
  const setting = asRecord(value, `Model configuration setting ${name}`);
  if (setting.state === "VALUE") {
    exactKeys(setting, ["state", "value"], `Model configuration setting ${name}`);
    canonicalJson(setting.value as CanonicalJsonValue);
    rejectSecretShapedData(setting.value);
  } else if (setting.state === "OMITTED" || setting.state === "UNAVAILABLE") {
    exactKeys(setting, ["state", "reasonCode"], `Model configuration setting ${name}`);
    if (!REASONS.has(setting.reasonCode as SettingReasonCode)) throw new TypeError(`Model configuration setting ${name} has an invalid reason`);
  } else if (setting.state === "NOT_APPLICABLE" || setting.state === "UNRESOLVED") {
    exactKeys(setting, ["state"], `Model configuration setting ${name}`);
  } else throw new TypeError(`Model configuration setting ${name} has invalid state`);
  return setting as unknown as ProviderSetting;
}

function validateInput(value: unknown): ModelConfigurationInput {
  const input = asRecord(value, "Model configuration input"); exactKeys(input, INPUT_KEYS, "Model configuration input");
  const identity = asRecord(input.identity, "Model configuration identity"); exactKeys(identity, IDENTITY_KEYS, "Model configuration identity");
  for (const key of IDENTITY_KEYS) if (typeof identity[key] !== "string" || identity[key].length === 0) throw new TypeError(`Model configuration identity ${key} must be non-empty`);
  const settings = asRecord(input.settings, "Model configuration settings"); exactKeys(settings, SETTING_KEYS, "Model configuration settings");
  for (const key of SETTING_KEYS) validateSetting(key, settings[key]);
  if (!RETURNED_POLICIES.has(input.returnedModelPolicy as ReturnedModelPolicy)) throw new TypeError("Invalid returned model policy");
  return input as unknown as ModelConfigurationInput;
}

function content(input: ModelConfigurationInput): CanonicalJsonValue {
  return { schemaVersion: MODEL_CONFIGURATION_SCHEMA_VERSION, hashAlgorithm: CONTENT_HASH_ALGORITHM, canonicalHashContractVersion: CANONICAL_HASH_CONTRACT_VERSION, identity: input.identity, settings: input.settings, returnedModelPolicy: input.returnedModelPolicy } as unknown as CanonicalJsonValue;
}

const derivedId = (hash: string) => `${MODEL_CONFIGURATION_SCHEMA_VERSION}:${CONTENT_HASH_ALGORITHM}:${hash}`;

export function createModelConfiguration(value: ModelConfigurationInput): ModelConfigurationRecord {
  const hashContent = content(validateInput(value)); const hash = sha256CanonicalJson(hashContent);
  return deepFreezeCanonical({ ...(hashContent as Record<string, CanonicalJsonValue>), modelConfigurationId: derivedId(hash), modelConfigurationHash: hash }) as unknown as ModelConfigurationRecord;
}

export function verifyModelConfigurationRecord(value: unknown): ModelConfigurationRecord {
  const record = asRecord(value, "Model configuration record"); exactKeys(record, RECORD_KEYS, "Model configuration record");
  if (record.schemaVersion !== MODEL_CONFIGURATION_SCHEMA_VERSION) throw new TypeError("Unsupported model configuration schema version");
  if (record.hashAlgorithm !== CONTENT_HASH_ALGORITHM) throw new TypeError("Unsupported model configuration hash algorithm");
  if (record.canonicalHashContractVersion !== CANONICAL_HASH_CONTRACT_VERSION) throw new TypeError("Unsupported model configuration canonical hash contract");
  const input = validateInput({ identity: record.identity, settings: record.settings, returnedModelPolicy: record.returnedModelPolicy });
  const hash = sha256CanonicalJson(content(input));
  if (record.modelConfigurationHash !== hash) throw new TypeError("Model configuration hash does not match content");
  if (record.modelConfigurationId !== derivedId(hash)) throw new TypeError("Model configuration ID does not match verified hash");
  return deepFreezeCanonical(record as unknown as CanonicalJsonValue) as unknown as ModelConfigurationRecord;
}
