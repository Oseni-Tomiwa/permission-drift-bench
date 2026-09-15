import { mkdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const PILOT_MARKER = "PILOT_NOT_FOR_ANALYSIS";

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
        },
      ];
    },
  );

  return {
    pilotMarker: PILOT_MARKER,
    timestamp: timestamp.toISOString(),
    scenario: {
      id: result.scenarioId,
      version: result.scenarioVersion,
    },
    condition: result.conditionId,
    modelId: redactText(result.metadata.model),
    trialId: redactText(result.metadata.trialId),
    trialOutcome: result.outcome,
    terminationReason: result.terminationReason,
    maxModelResponsesPerStep: result.metadata.maxModelResponsesPerStep,
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
  const filename = `${timestampPart}_${filenamePart(result.conditionId)}_${filenamePart(redactText(result.metadata.trialId))}.pilot.json`;
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
