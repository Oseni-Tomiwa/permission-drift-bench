import { pathToFileURL } from "node:url";
import { bindModelConfiguration, deriveSdkClientConfiguration } from "../dist/provenance/model-configuration-binding.js";
import { SCOPE_V01_CANDIDATE_MODEL_CONFIGURATIONS } from "../dist/provenance/scope-v0.1-model-candidates.js";

const EXACT_CONDITION = "A";

const descriptor = (provider, credentialEnvironmentVariable) => {
  const frozenModelConfiguration = SCOPE_V01_CANDIDATE_MODEL_CONFIGURATIONS[provider];
  return Object.freeze({
    model: frozenModelConfiguration.identity.requestedModel,
    credentialEnvironmentVariable,
    frozenModelConfiguration,
    condition: EXACT_CONDITION,
    maxModelResponsesPerStep: frozenModelConfiguration.settings.responseCapPerStep.value,
  });
};

export const CANONICAL_SMOKE_PROVIDERS = Object.freeze({
  openai: descriptor("openai", "OPENAI_API_KEY"),
  google: descriptor("google", "GOOGLE_API_KEY"),
  anthropic: descriptor("anthropic", "ANTHROPIC_API_KEY"),
});

export function validateCanonicalSmokeInvocation(provider, condition, environment) {
  const selected = CANONICAL_SMOKE_PROVIDERS[provider];
  if (selected === undefined) {
    throw new Error("Provider must be exactly openai, anthropic, or google.");
  }
  if (condition !== EXACT_CONDITION) {
    throw new Error("Condition must be exactly A for the canonical pilot smoke.");
  }
  const apiKey = environment[selected.credentialEnvironmentVariable];
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    throw new Error(`${selected.credentialEnvironmentVariable} is required for the opt-in smoke test.`);
  }
  return Object.freeze({ descriptor: selected, apiKey });
}

async function loadModule(provider, suppliedModules) {
  if (suppliedModules[provider] !== undefined) return suppliedModules[provider];
  if (provider === "openai") return import("openai");
  if (provider === "anthropic") return import("@anthropic-ai/sdk");
  return import("@google/genai");
}

export async function createCanonicalSmokeAdapter(
  provider,
  apiKey,
  suppliedModules = {},
  _environment = process.env,
) {
  const selected = CANONICAL_SMOKE_PROVIDERS[provider];
  if (selected === undefined) throw new Error("Unsupported canonical smoke provider.");
  const sdk = await loadModule(provider, suppliedModules);
  const sdkClientConfiguration = deriveSdkClientConfiguration(selected.frozenModelConfiguration);

  if (provider === "openai") {
    const [{ OpenAIResponsesAdapter }, OpenAI] = await Promise.all([
      import("../dist/adapters/openai-responses-adapter.js"),
      Promise.resolve(sdk.default),
    ]);
    const client = new OpenAI({ apiKey, ...sdkClientConfiguration });
    const adapter = new OpenAIResponsesAdapter(client);
    const binding = bindModelConfiguration(selected.frozenModelConfiguration, adapter.getIdentity(selected.model));
    return Object.freeze({ adapter, model: binding.model, modelConfiguration: binding.requestConfiguration, frozenModelConfiguration: selected.frozenModelConfiguration });
  }
  if (provider === "anthropic") {
    const [{ AnthropicMessagesAdapter }, Anthropic] = await Promise.all([
      import("../dist/adapters/anthropic-messages-adapter.js"),
      Promise.resolve(sdk.default),
    ]);
    const client = new Anthropic({ apiKey, ...sdkClientConfiguration });
    const adapter = new AnthropicMessagesAdapter(client);
    const binding = bindModelConfiguration(selected.frozenModelConfiguration, adapter.getIdentity(selected.model));
    return Object.freeze({ adapter, model: binding.model, modelConfiguration: binding.requestConfiguration, frozenModelConfiguration: selected.frozenModelConfiguration });
  }

  const { GoogleInteractionsAdapter } = await import("../dist/adapters/google-interactions-adapter.js");
  const client = new sdk.GoogleGenAI({
    apiKey,
    vertexai: sdkClientConfiguration.vertexai,
    apiVersion: sdkClientConfiguration.apiVersion,
    httpOptions: { baseUrl: sdkClientConfiguration.baseUrl },
  });
  const adapter = new GoogleInteractionsAdapter(
    client,
    Object.freeze({ maxRetries: sdkClientConfiguration.maxRetries }),
  );
  const binding = bindModelConfiguration(selected.frozenModelConfiguration, adapter.getIdentity(selected.model));
  return Object.freeze({ adapter, model: binding.model, modelConfiguration: binding.requestConfiguration, frozenModelConfiguration: selected.frozenModelConfiguration });
}

async function main() {
  const provider = process.argv[2];
  const condition = process.argv[3];
  let validated;
  try {
    validated = validateCanonicalSmokeInvocation(provider, condition, process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid canonical smoke invocation.");
    process.exitCode = 1;
    return;
  }

  try {
    const [adapterSetup, runner, summary, scenario, trace] = await Promise.all([
      createCanonicalSmokeAdapter(provider, validated.apiKey),
      import("../dist/runner/model-trial-runner.js"),
      import("../dist/runner/pilot-summary.js"),
      import("../dist/scenarios/file-read-boundary.js"),
      import("./pilot-trace.mjs"),
    ]);
    const scheduledTrialId = `pilot-${provider}-A-${Date.now()}`;
    const result = await runner.runModelTrial({
      scenario: scenario.fileReadBoundaryScenario,
      conditionId: EXACT_CONDITION,
      scheduledTrialId,
      trialAttemptId: `${scheduledTrialId}-attempt-1`,
      attemptNumber: 1,
      replacementForAttemptId: null,
      adapter: adapterSetup.adapter,
      model: adapterSetup.model,
      frozenModelConfiguration: adapterSetup.frozenModelConfiguration,
      maxModelResponsesPerStep: validated.descriptor.maxModelResponsesPerStep,
    });
    const emitted = await trace.emitPilotArtifacts(result, summary.formatPilotSummary(result));
    if (!emitted.traceWritten) process.exitCode = 1;
  } catch {
    console.error(`${provider} pilot request failed. No raw provider error was printed.`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

