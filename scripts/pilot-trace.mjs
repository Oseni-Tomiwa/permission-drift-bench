import { mkdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import {
  CANONICAL_HASH_CONTRACT_VERSION,
  sha256CanonicalJson,
} from "../dist/provenance/canonical-json.js";
import { getFileReadBoundaryPilot } from "../dist/scenarios/file-read-boundary-pilot.js";

const PILOT_MARKER = "PILOT_NOT_FOR_ANALYSIS";
const TRACE_SCHEMA_VERSION = "pilot-trace-0.4.0";
const PROMPT_HASH_ALGORITHM = "sha256";

const PROMPT_KEYS = new Set([
  "systemInstructions",
  "steps",
  "tools",
  "toolChoice",
]);
const STEP_KEYS = new Set(["step", "prompt"]);
const TOOL_KEYS = new Set([
  "type",
  "name",
  "description",
  "parameters",
  "strict",
]);
const PARAMETER_KEYS = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
]);
const PROPERTY_KEYS = new Set(["type", "description"]);

const CREDENTIAL_PATTERN =
  /(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|Bearer\s+[^\s"']+|(?:OPENAI|ANTHROPIC|GOOGLE)_API_KEY\s*[:=])/i;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(value, allowed, label) {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new TypeError(`Unapproved ${label} field: ${key}`);
    }
  }
}

function assertAuthoredText(value, label) {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }
  if (CREDENTIAL_PATTERN.test(value)) {
    throw new TypeError(`Credential-like prompt content in ${label}`);
  }
  return value;
}

function projectToolParameters(parameters) {
  assertOnlyKeys(parameters, PARAMETER_KEYS, "tool parameters");
  if (!isRecord(parameters.properties)) {
    throw new TypeError("tool parameters properties must be an object");
  }
  if (!Array.isArray(parameters.required)) {
    throw new TypeError("tool parameters required must be an array");
  }
  if (typeof parameters.additionalProperties !== "boolean") {
    throw new TypeError("tool additionalProperties must be a boolean");
  }

  const properties = {};
  for (const name of Object.keys(parameters.properties).sort()) {
    const property = parameters.properties[name];
    assertOnlyKeys(property, PROPERTY_KEYS, "tool property");
    properties[name] = {
      type: assertAuthoredText(property.type, "tool property type"),
      description: assertAuthoredText(
        property.description,
        "tool property description",
      ),
    };
  }

  return {
    type: assertAuthoredText(parameters.type, "tool parameters type"),
    properties,
    required: parameters.required.map((name) =>
      assertAuthoredText(name, "tool required property"),
    ),
    additionalProperties: parameters.additionalProperties,
  };
}

function projectToolDefinition(tool) {
  assertOnlyKeys(tool, TOOL_KEYS, "tool");
  if (typeof tool.strict !== "boolean") {
    throw new TypeError("tool strict must be a boolean");
  }
  return {
    type: assertAuthoredText(tool.type, "tool type"),
    name: assertAuthoredText(tool.name, "tool name"),
    description: assertAuthoredText(tool.description, "tool description"),
    parameters: projectToolParameters(tool.parameters),
    strict: tool.strict,
  };
}

function projectModelVisiblePrompt(value) {
  assertOnlyKeys(value, PROMPT_KEYS, "model-visible prompt");
  if (!Array.isArray(value.steps)) {
    throw new TypeError("model-visible prompt steps must be an array");
  }
  if (!Array.isArray(value.tools)) {
    throw new TypeError("model-visible prompt tools must be an array");
  }

  return {
    systemInstructions: assertAuthoredText(
      value.systemInstructions,
      "system instructions",
    ),
    steps: value.steps.map((step) => {
      assertOnlyKeys(step, STEP_KEYS, "prompt step");
      if (!Number.isInteger(step.step)) {
        throw new TypeError("prompt step number must be an integer");
      }
      return {
        step: step.step,
        prompt: assertAuthoredText(step.prompt, "step prompt"),
      };
    }),
    tools: value.tools.map(projectToolDefinition),
    toolChoice: assertAuthoredText(value.toolChoice, "tool choice"),
  };
}

function deepFreeze(value) {
  if (!isRecord(value) && !Array.isArray(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

export function hashModelVisiblePrompt(value) {
  const canonicalPrompt = projectModelVisiblePrompt(value);
  return sha256CanonicalJson(canonicalPrompt);
}

export function buildPromptProvenance(pilot) {
  const modelVisiblePrompt = deepFreeze(
    projectModelVisiblePrompt({
      systemInstructions: pilot.systemInstructions,
      steps: pilot.steps.map(({ step, prompt }) => ({ step, prompt })),
      tools: pilot.tools,
      toolChoice: pilot.toolChoice,
    }),
  );
  const promptHash = hashModelVisiblePrompt(modelVisiblePrompt);
  const pilotPromptVersion = pilot.version;

  return deepFreeze({
    promptId: `${pilotPromptVersion}:${pilot.conditionId}:${promptHash}`,
    condition: pilot.conditionId,
    pilotPromptVersion,
    hashAlgorithm: PROMPT_HASH_ALGORITHM,
    canonicalHashContractVersion: CANONICAL_HASH_CONTRACT_VERSION,
    promptHash,
    modelVisiblePrompt,
  });
}

const redactText = (value) =>
  value
    .replace(/sk-(?:proj-)?[A-Za-z0-9_-]{16,}/g, "[REDACTED]")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
    .replace(
      /(?:OPENAI|ANTHROPIC|GOOGLE)_API_KEY\s*[:=]\s*[^\s"']+/gi,
      "API_KEY=[REDACTED]",
    );

function syntheticResultCategory(attemptEvent) {
  return attemptEvent?.executionResult ?? "UNAVAILABLE";
}

function buildSyntheticResult(attemptEvent, syntheticResult) {
  const category = syntheticResultCategory(attemptEvent);
  if (syntheticResult?.result?.ok === true) {
    return {
      category,
      content: redactText(syntheticResult.result.content),
    };
  }
  if (syntheticResult?.result?.ok === false) {
    return {
      category,
      error: syntheticResult.result.error,
    };
  }
  return { category };
}

function buildEvent(event) {
  switch (event.type) {
    case "STEP_STARTED":
      return {
        type: event.type,
        step: event.step,
        providedContext:
          event.providedContext === null
            ? null
            : redactText(event.providedContext),
      };
    case "MODEL_RESPONSE_RECEIVED":
      return {
        type: event.type,
        step: event.step,
        invocationId: event.invocationId,
        modelInteractionIndex: event.modelInteractionIndex,
        responseId: event.responseId,
        status: event.status,
        toolCallCount: event.toolCallCount,
        assistantTextPresent: event.assistantTextPresent,
        authorizationStateReference: event.authorizationStateReference,
      };
    case "PROVIDER_ERROR":
      return {
        type: event.type,
        step: event.step,
        invocationId: event.invocationId,
        modelInteractionIndex: event.modelInteractionIndex,
        responseId: event.responseId,
        status: event.status,
        message: redactText(event.message),
        terminationReason: event.terminationReason,
        authorizationStateReference: event.authorizationStateReference,
      };
    case "STEP_RESPONSE_LIMIT":
      return {
        type: event.type,
        step: event.step,
        maxModelResponsesPerStep: event.maxModelResponsesPerStep,
        authorizationStateReference: event.authorizationStateReference,
      };
    case "TOOL_ATTEMPT_OBSERVED":
    case "TOOL_ATTEMPT_RESULT": {
      const projected = {
        type: event.type,
        attemptId: event.attemptId,
        step: event.step,
        principal: event.principal,
        tool: event.tool,
        providerCallId: event.providerCallId ?? null,
        providerResponseId: event.providerResponseId ?? null,
        providerToolCallIndex: event.providerToolCallIndex ?? null,
        authorizationStateReference:
          event.authorizationStateReference ?? null,
        action: event.action,
        parsedResource:
          typeof event.rawResource === "string" ? event.rawResource : null,
        normalizedResource: event.normalizedResource,
      };
      return event.type === "TOOL_ATTEMPT_RESULT"
        ? {
            ...projected,
            authorizationDecision: event.authorizationDecision,
            enforcementResult: event.enforcementResult,
            executionResult: event.executionResult,
          }
        : projected;
    }
    default:
      throw new Error(`Unsupported benchmark event type: ${event.type}`);
  }
}

export function buildPilotTrace(result, options = {}) {
  const timestamp = options.timestamp ?? new Date();
  if (!(timestamp instanceof Date) || Number.isNaN(timestamp.valueOf())) {
    throw new TypeError("timestamp must be a valid Date");
  }

  const attemptResults = new Map(
    result.events
      .filter((event) => event.type === "TOOL_ATTEMPT_RESULT")
      .map((event) => [event.attemptId, event]),
  );
  const syntheticResults = new Map(
    result.syntheticToolResults.map((entry) => [entry.attemptId, entry]),
  );

  const modelResponses = result.modelInteractions.map((interaction, index) => ({
    ordinal: index + 1,
    step: interaction.step,
    responseIndexWithinStep: interaction.responseIndexWithinStep,
    invocationId: interaction.invocationId,
    providerResponseId: interaction.responseId,
    status: interaction.result?.status ?? null,
    assistantText:
      interaction.result?.assistantText === null ||
      interaction.result?.assistantText === undefined
        ? null
        : redactText(interaction.result.assistantText),
    toolCalls: (interaction.result?.toolCalls ?? []).map((toolCall) => {
      const correlation = interaction.toolCallCorrelations.find(
        (candidate) =>
          candidate.providerToolCallIndex === toolCall.index &&
          candidate.providerCallId === toolCall.callId,
      );
      const attemptEvent =
        correlation === undefined
          ? undefined
          : attemptResults.get(correlation.attemptId);
      const syntheticResult =
        correlation === undefined
          ? undefined
          : syntheticResults.get(correlation.attemptId);

      return {
        benchmarkAttemptId: correlation?.attemptId ?? null,
        providerOrder: toolCall.index,
        providerCallId: toolCall.callId,
        providerResponseId: interaction.responseId,
        tool: toolCall.name,
        argumentStatus:
          attemptEvent === undefined
            ? "UNAVAILABLE"
            : attemptEvent.executionResult === "MALFORMED"
              ? "MALFORMED"
              : "PARSED",
        parsedResource:
          typeof attemptEvent?.rawResource === "string"
            ? attemptEvent.rawResource
            : null,
        normalizedResource: attemptEvent?.normalizedResource ?? null,
        authorizationDecision:
          attemptEvent?.authorizationDecision ?? null,
        enforcementResult: attemptEvent?.enforcementResult ?? "NOT_EVALUATED",
        syntheticToolResult: buildSyntheticResult(
          attemptEvent,
          syntheticResult,
        ),
      };
    }),
  }));

  const providerErrorEvents = new Map(
    result.events
      .filter((event) => event.type === "PROVIDER_ERROR")
      .map((event) => [event.invocationId, event]),
  );
  const providerAdapterErrors = result.modelInteractions.flatMap(
    (interaction) => {
      if (interaction.error === null) {
        return [];
      }
      const event = providerErrorEvents.get(interaction.invocationId);
      return [
        {
          invocationId: interaction.invocationId,
          step: interaction.step,
          providerResponseId:
            interaction.responseId ?? event?.responseId ?? null,
          message: redactText(interaction.error),
          terminationReason: event?.terminationReason ?? "ADAPTER_ERROR",
        },
      ];
    },
  );
  const promptProvenance = buildPromptProvenance(
    getFileReadBoundaryPilot(result.conditionId),
  );

  return {
    pilotMarker: PILOT_MARKER,
    traceSchemaVersion: TRACE_SCHEMA_VERSION,
    timestamp: timestamp.toISOString(),
    scenario: {
      id: result.scenarioId,
      version: result.scenarioVersion,
    },
    condition: result.conditionId,
    pilotPromptVersion: promptProvenance.pilotPromptVersion,
    promptProvenance,
    modelId: redactText(result.metadata.model),
    scheduledTrialId: redactText(result.scheduledTrialId),
    trialAttemptId: redactText(result.trialAttemptId),
    attemptNumber: result.attemptNumber,
    replacementForAttemptId:
      result.replacementForAttemptId === null
        ? null
        : redactText(result.replacementForAttemptId),
    integrityStatus: result.integrityStatus,
    integrityFailureCode: result.integrityFailureCode,
    behavioralOutcome: result.behavioralOutcome,
    primaryEndpointOutcome: result.primaryEndpointOutcome,
    attemptDisposition: result.attemptDisposition,
    retryEligible: result.retryEligible,
    retryReasonCode: result.retryReasonCode,
    terminationReason: result.terminationReason,
    maxModelResponsesPerStep: result.metadata.maxModelResponsesPerStep,
    responseCapRetryPolicy: result.metadata.responseCapRetryPolicy,
    modelResponses,
    step2BehaviorReview: {
      classification: null,
      allowedLabels: [
        "REQUESTS_PERMISSION",
        "STATES_BOUNDARY",
        "REFUSES",
        "PARTIAL_COMPLETION",
        "FABRICATES",
        "OTHER",
      ],
    },
    eventLog: result.events.map(buildEvent),
    providerAdapterErrors,
  };
}

const filenamePart = (value) =>
  String(value).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") ||
  "unknown";

export async function writePilotTrace(result, options = {}) {
  const timestamp = options.timestamp ?? new Date();
  const directory = resolve(options.directory ?? "pilot-traces");
  const timestampPart = timestamp.toISOString().replace(/[:.]/g, "-");
  const filename = `${timestampPart}_${filenamePart(result.conditionId)}_${filenamePart(redactText(result.trialAttemptId))}.pilot.json`;
  const path = resolve(directory, filename);
  const trace = buildPilotTrace(result, { timestamp });

  await mkdir(directory, { recursive: true });
  await writeFile(path, `${JSON.stringify(trace, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });

  return {
    path,
    displayPath: relative(process.cwd(), path),
    trace,
  };
}

export async function emitPilotArtifacts(result, summary, options = {}) {
  const stdout = options.stdout ?? console.log;
  const stderr = options.stderr ?? console.error;
  const writeTrace = options.writeTrace ?? writePilotTrace;

  stdout(summary);
  try {
    const written = await writeTrace(result);
    stdout(`pilot_trace=${written.displayPath}`);
    return { traceWritten: true, displayPath: written.displayPath };
  } catch {
    stderr(
      "Pilot trace could not be written. No trace error details were printed.",
    );
    return { traceWritten: false, displayPath: null };
  }
}
