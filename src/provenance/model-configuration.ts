import {
  CANONICAL_HASH_CONTRACT_VERSION,
  canonicalJson,
  deepFreezeCanonical,
  sha256CanonicalJson,
} from "./canonical-json.js";
import type { CanonicalJsonValue } from "./canonical-json.js";

export const MODEL_CONFIGURATION_SCHEMA_VERSION = "model-configuration-v0.1";
export const CONTENT_HASH_ALGORITHM = "sha256";

export type UnavailableReasonCode =
  | "UNSUPPORTED_BY_PROVIDER"
  | "NOT_EXPOSED_BY_API"
  | "PROVIDER_CONTROLLED";

export type ProviderSetting =
  | Readonly<{ state: "VALUE"; value: CanonicalJsonValue }>
  | Readonly<{ state: "UNAVAILABLE"; reasonCode: UnavailableReasonCode }>
  | Readonly<{ state: "UNRESOLVED" }>;

export interface ProviderSettings {
  readonly snapshotVersion: ProviderSetting;
  readonly reasoning: ProviderSetting;
  readonly temperature: ProviderSetting;
  readonly topP: ProviderSetting;
  readonly outputTokenLimit: ProviderSetting;
  readonly seed: ProviderSetting;
  readonly parallelToolCalls: ProviderSetting;
  readonly providerStorage: ProviderSetting;
  readonly providerSession: ProviderSetting;
  readonly responseCapPerStep: ProviderSetting;
}

export interface ModelConfigurationInput {
  readonly provider: string;
  readonly modelIdentifier: string;
  readonly settings: ProviderSettings;
}

export interface ModelConfigurationRecord extends ModelConfigurationInput {
  readonly schemaVersion: typeof MODEL_CONFIGURATION_SCHEMA_VERSION;
  readonly hashAlgorithm: typeof CONTENT_HASH_ALGORITHM;
  readonly canonicalHashContractVersion: typeof CANONICAL_HASH_CONTRACT_VERSION;
  readonly modelConfigurationId: string;
  readonly modelConfigurationHash: string;
}

const SETTING_KEYS = Object.freeze([
  "snapshotVersion", "reasoning", "temperature", "topP",
  "outputTokenLimit", "seed", "parallelToolCalls", "providerStorage",
  "providerSession", "responseCapPerStep",
] as const);
const INPUT_KEYS = Object.freeze(["provider", "modelIdentifier", "settings"]);
const RECORD_KEYS = Object.freeze([
  "schemaVersion", "hashAlgorithm", "canonicalHashContractVersion",
  "modelConfigurationId", "modelConfigurationHash",
  "provider", "modelIdentifier", "settings",
]);
const UNAVAILABLE_REASONS = new Set<UnavailableReasonCode>([
  "UNSUPPORTED_BY_PROVIDER", "NOT_EXPOSED_BY_API", "PROVIDER_CONTROLLED",
]);

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be a plain record`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  name: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${name} has missing or unknown fields`);
  }
}

function validateSetting(name: string, value: unknown): ProviderSetting {
  const setting = asRecord(value, `Model configuration setting ${name}`);
  if (setting.state === "VALUE") {
    requireExactKeys(setting, ["state", "value"], `Model configuration setting ${name}`);
    canonicalJson(setting.value as CanonicalJsonValue);
  } else if (setting.state === "UNAVAILABLE") {
    requireExactKeys(setting, ["state", "reasonCode"], `Model configuration setting ${name}`);
    if (!UNAVAILABLE_REASONS.has(setting.reasonCode as UnavailableReasonCode)) {
      throw new TypeError(`Model configuration setting ${name} has an invalid unavailable reason`);
    }
  } else if (setting.state === "UNRESOLVED") {
    requireExactKeys(setting, ["state"], `Model configuration setting ${name}`);
  } else {
    throw new TypeError(`Model configuration setting ${name} has invalid state`);
  }
  return setting as unknown as ProviderSetting;
}

function validateInput(value: unknown): ModelConfigurationInput {
  const input = asRecord(value, "Model configuration input");
  requireExactKeys(input, INPUT_KEYS, "Model configuration input");
  if (typeof input.provider !== "string" || input.provider.length === 0 ||
      typeof input.modelIdentifier !== "string" || input.modelIdentifier.length === 0) {
    throw new TypeError("Model provider and identifier must not be empty");
  }
  const settings = asRecord(input.settings, "Model configuration settings");
  requireExactKeys(settings, SETTING_KEYS, "Model configuration settings");
  for (const key of SETTING_KEYS) validateSetting(key, settings[key]);
  return input as unknown as ModelConfigurationInput;
}

function content(input: ModelConfigurationInput): CanonicalJsonValue {
  return {
    schemaVersion: MODEL_CONFIGURATION_SCHEMA_VERSION,
    hashAlgorithm: CONTENT_HASH_ALGORITHM,
    canonicalHashContractVersion: CANONICAL_HASH_CONTRACT_VERSION,
    provider: input.provider,
    modelIdentifier: input.modelIdentifier,
    settings: input.settings,
  } as unknown as CanonicalJsonValue;
}

function derivedId(hash: string): string {
  return `${MODEL_CONFIGURATION_SCHEMA_VERSION}:${CONTENT_HASH_ALGORITHM}:${hash}`;
}

export function createModelConfiguration(
  value: ModelConfigurationInput,
): ModelConfigurationRecord {
  const input = validateInput(value);
  const hashContent = content(input);
  const modelConfigurationHash = sha256CanonicalJson(hashContent);
  return deepFreezeCanonical({
    ...(hashContent as Record<string, CanonicalJsonValue>),
    modelConfigurationId: derivedId(modelConfigurationHash),
    modelConfigurationHash,
  }) as unknown as ModelConfigurationRecord;
}

export function verifyModelConfigurationRecord(
  value: unknown,
): ModelConfigurationRecord {
  const record = asRecord(value, "Model configuration record");
  requireExactKeys(record, RECORD_KEYS, "Model configuration record");
  if (record.schemaVersion !== MODEL_CONFIGURATION_SCHEMA_VERSION) {
    throw new TypeError("Unsupported model configuration schema version");
  }
  if (record.hashAlgorithm !== CONTENT_HASH_ALGORITHM) {
    throw new TypeError("Unsupported model configuration hash algorithm");
  }
  if (record.canonicalHashContractVersion !== CANONICAL_HASH_CONTRACT_VERSION) {
    throw new TypeError("Unsupported model configuration canonical hash contract");
  }
  const input = validateInput({
    provider: record.provider,
    modelIdentifier: record.modelIdentifier,
    settings: record.settings,
  });
  const expectedHash = sha256CanonicalJson(content(input));
  if (record.modelConfigurationHash !== expectedHash) {
    throw new TypeError("Model configuration hash does not match content");
  }
  if (record.modelConfigurationId !== derivedId(expectedHash)) {
    throw new TypeError("Model configuration ID does not match verified hash");
  }
  return deepFreezeCanonical(
    record as unknown as CanonicalJsonValue,
  ) as unknown as ModelConfigurationRecord;
}
