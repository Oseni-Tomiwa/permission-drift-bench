import { ModelAdapterError } from "../adapters/model-adapter.js";
import type { ModelAdapterIdentity } from "../adapters/model-adapter.js";
import { deepFreezeCanonical } from "./canonical-json.js";
import type { CanonicalJsonValue } from "./canonical-json.js";
import { verifyModelConfigurationRecord } from "./model-configuration.js";
import type { ModelConfigurationRecord, ProviderSetting } from "./model-configuration.js";

function settingValue(setting: ProviderSetting): CanonicalJsonValue | undefined {
  return setting.state === "VALUE" ? setting.value : undefined;
}

function integrityError(message: string): ModelAdapterError {
  return new ModelAdapterError({ provider: "configuration-binding", errorCode: "UNSUPPORTED_CONFIGURATION", terminationReason: "ADAPTER_ERROR", failureClassification: "INTEGRITY_CORRUPTION", integrityFailureCode: "WRONG_MODEL_CONFIGURATION", cause: new TypeError(message) });
}

export function bindModelConfiguration(value: unknown, adapterIdentity: ModelAdapterIdentity) {
  const record = verifyModelConfigurationRecord(value);
  if (Object.values(record.settings).some((setting) => setting.state === "UNRESOLVED")) {
    throw integrityError("Unresolved model configuration cannot be executed");
  }
  for (const key of ["provider", "providerBackend", "apiSurface", "requestedModel", "adapterName", "adapterVersion", "sdkPackage", "sdkVersion"] as const) {
    if (adapterIdentity[key] !== record.identity[key]) throw integrityError(`Adapter identity ${key} does not match frozen model configuration`);
  }
  const requestConfiguration: Record<string, unknown> = {};
  const reasoning = settingValue(record.settings.reasoning); if (reasoning !== undefined) requestConfiguration.reasoning = reasoning;
  const output = settingValue(record.settings.outputTokenLimit); if (output !== undefined) requestConfiguration.maxOutputTokens = output;
  const parallel = settingValue(record.settings.parallelToolCalls); if (parallel !== undefined) requestConfiguration.parallelToolCalls = parallel;
  const toolChoice = settingValue(record.settings.toolChoice);
  const responseCapPerStep = settingValue(record.settings.responseCapPerStep);
  if (toolChoice !== "auto" && toolChoice !== "none" && toolChoice !== "required") throw integrityError("Frozen tool choice is not executable");
  if (!Number.isInteger(responseCapPerStep) || (responseCapPerStep as number) < 1) throw integrityError("Frozen response cap is not executable");
  const sdkClientConfiguration = deriveSdkClientConfiguration(record);
  return deepFreezeCanonical({ model: record.identity.requestedModel, requestConfiguration, sdkClientConfiguration, toolChoice, responseCapPerStep } as unknown as CanonicalJsonValue) as unknown as Readonly<{ model: string; requestConfiguration: Readonly<Record<string, unknown>>; sdkClientConfiguration: Readonly<Record<string, CanonicalJsonValue>>; toolChoice: "auto" | "none" | "required"; responseCapPerStep: number }>;
}

export function deriveSdkClientConfiguration(value: unknown): Readonly<Record<string, CanonicalJsonValue>> {
  const record = verifyModelConfigurationRecord(value);
  const maxRetries = settingValue(record.settings.automaticSdkRetries);
  if (!Number.isInteger(maxRetries) || (maxRetries as number) < 0) throw integrityError("Frozen SDK retry setting is not executable");
  const configuration: Record<string, CanonicalJsonValue> = { maxRetries: maxRetries as number };
  if (record.identity.provider === "google") {
    const apiVersion = settingValue(record.settings.apiVersion);
    const vertexai = settingValue(record.settings.vertexBackend);
    const baseUrl = settingValue(record.settings.endpoint);
    if (typeof apiVersion !== "string" || typeof vertexai !== "boolean" || typeof baseUrl !== "string") throw integrityError("Frozen Google SDK client configuration is not executable");
    configuration.apiVersion = apiVersion;
    configuration.vertexai = vertexai;
    configuration.baseUrl = baseUrl;
  }
  return deepFreezeCanonical(configuration);
}

export function verifyReturnedModelBinding(recordValue: unknown, returnedModel: string | null): void {
  const record = verifyModelConfigurationRecord(recordValue);
  if (returnedModel !== null && record.returnedModelPolicy === "EXACT_REQUESTED_IF_PRESENT" && returnedModel !== record.identity.requestedModel) {
    throw integrityError("Provider returned model does not match frozen requested model");
  }
}
