const EXACT_CONDITION = "A";
const STANDARD_GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/";

const descriptor = (value) => Object.freeze({
  ...value,
  condition: EXACT_CONDITION,
  maxModelResponsesPerStep: 4,
  modelConfiguration: Object.freeze(value.modelConfiguration),
});

export const CANONICAL_SMOKE_PROVIDERS = Object.freeze({
  openai: descriptor({
    model: "gpt-6.1-sol",
    credentialEnvironmentVariable: "OPENAI_API_KEY",
    modelConfiguration: {
      reasoning: Object.freeze({ effort: "medium" }),
      maxOutputTokens: 32768,
      parallelToolCalls: false,
    },
  }),
  anthropic: descriptor({
    model: "claude-sonnet-5-5",
    credentialEnvironmentVariable: "ANTHROPIC_API_KEY",
    modelConfiguration: {
      reasoning: Object.freeze({ effort: "medium" }),
      maxOutputTokens: 32768,
      parallelToolCalls: false,
    },
  }),
  google: descriptor({
    model: "gemini-3.8-flash",
    credentialEnvironmentVariable: "GOOGLE_API_KEY",
    modelConfiguration: {
      reasoning: Object.freeze({ effort: "medium" }),
      maxOutputTokens: 32768,
    },
  }),
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

  if (provider === "openai") {
    const [{ OpenAIResponsesAdapter }, OpenAI] = await Promise.all([
      import("../dist/adapters/openai-responses-adapter.js"),
      Promise.resolve(sdk.default),
    ]);
    const client = new OpenAI({ apiKey, maxRetries: 0 });
    return Object.freeze({ adapter: new OpenAIResponsesAdapter(client), model: selected.model, modelConfiguration: selected.modelConfiguration });
  }
  if (provider === "anthropic") {
    const [{ AnthropicMessagesAdapter }, Anthropic] = await Promise.all([
      import("../dist/adapters/anthropic-messages-adapter.js"),
      Promise.resolve(sdk.default),
    ]);
    const client = new Anthropic({ apiKey, maxRetries: 0 });
    return Object.freeze({ adapter: new AnthropicMessagesAdapter(client), model: selected.model, modelConfiguration: selected.modelConfiguration });
  }

  const { GoogleInteractionsAdapter } = await import("../dist/adapters/google-interactions-adapter.js");
  const client = new sdk.GoogleGenAI({
    apiKey,
    vertexai: false,
    apiVersion: "v1beta",
    httpOptions: { baseUrl: STANDARD_GEMINI_ENDPOINT },
  });
  return Object.freeze({
    adapter: new GoogleInteractionsAdapter(client, Object.freeze({ maxRetries: 0 })),
    model: selected.model,
    modelConfiguration: selected.modelConfiguration,
  });
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
      modelConfiguration: adapterSetup.modelConfiguration,
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
import { pathToFileURL } from "node:url";

