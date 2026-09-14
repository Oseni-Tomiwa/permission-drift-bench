import { EventLog } from "../environment/event-log.js";
import { SyntheticEnvironment } from "../environment/synthetic-environment.js";
import { isAuthorized } from "../permissions/authorization.js";
import type {
  ToolAttemptObservedEvent,
  ToolAttemptResultEvent,
} from "../schemas/events.js";
import type {
  AttemptedAction,
  AuthorizationState,
} from "../schemas/permission.js";

export interface ReadFileInput {
  readonly principal: string;
  readonly path: unknown;
  readonly step: number;
  readonly purpose?: string;
  readonly context?: string;
}

export interface ModelToolCallInput {
  readonly principal: string;
  readonly tool: string;
  readonly rawArguments: string;
  readonly step: number;
  readonly providerCallId: string | null;
  readonly providerResponseId: string | null;
  readonly providerToolCallIndex: number;
  readonly purpose?: string;
  readonly context?: string;
}

export type ReadFileResult =
  | { readonly ok: true; readonly content: string }
  | {
      readonly ok: false;
      readonly error: "UNAUTHORIZED" | "MALFORMED" | "SIMULATOR_ERROR";
    };

export interface ModelToolCallExecution {
  readonly attemptId: number;
  readonly result: ReadFileResult;
}

interface AttemptInput extends ReadFileInput {
  readonly tool: string;
  readonly rawArguments: Readonly<Record<string, unknown>>;
  readonly rawProviderArguments?: string;
  readonly providerCallId?: string | null;
  readonly providerResponseId?: string | null;
  readonly providerToolCallIndex?: number;
  readonly executable: boolean;
}

export class SimulatedReadFileTool {
  #nextAttemptId = 1;

  constructor(
    private readonly environment: SyntheticEnvironment,
    private readonly authorizationState: AuthorizationState,
    private readonly eventLog: EventLog,
    private readonly authorizationStateReference?: string,
  ) {}

  readFile(input: ReadFileInput): ReadFileResult {
    return this.#executeAttempt({
      ...input,
      tool: "read_file",
      rawArguments: Object.freeze({ path: input.path }),
      executable:
        typeof input.path === "string" && Number.isInteger(input.step),
    }).result;
  }

  executeModelToolCall(input: ModelToolCallInput): ModelToolCallExecution {
    let parsedArguments: Readonly<Record<string, unknown>> = Object.freeze({});
    try {
      const parsed: unknown = JSON.parse(input.rawArguments);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        parsedArguments = Object.freeze({
          ...(parsed as Record<string, unknown>),
        });
      }
    } catch {
      // The raw string is retained on the event; parsing failure is observable.
    }

    const keys = Object.keys(parsedArguments);
    const path = parsedArguments.path;
    const executable =
      input.tool === "read_file" &&
      keys.length === 1 &&
      keys[0] === "path" &&
      typeof path === "string" &&
      Number.isInteger(input.step);

    return this.#executeAttempt({
      principal: input.principal,
      path: path ?? null,
      step: input.step,
      purpose: input.purpose,
      context: input.context,
      tool: input.tool,
      rawArguments: parsedArguments,
      rawProviderArguments: input.rawArguments,
      providerCallId: input.providerCallId,
      providerResponseId: input.providerResponseId,
      providerToolCallIndex: input.providerToolCallIndex,
      executable,
    });
  }

  #executeAttempt(input: AttemptInput): ModelToolCallExecution {
    const attemptId = this.#nextAttemptId++;
    const normalizedResource =
      input.executable && typeof input.path === "string" ? input.path : null;
    const eventBase = {
      attemptId,
      step: Number.isInteger(input.step) ? input.step : null,
      principal: input.principal,
      tool: input.tool,
      rawArguments: input.rawArguments,
      ...(input.rawProviderArguments === undefined
        ? {}
        : { rawProviderArguments: input.rawProviderArguments }),
      ...(input.providerCallId === undefined
        ? {}
        : { providerCallId: input.providerCallId }),
      ...(input.providerResponseId === undefined
        ? {}
        : { providerResponseId: input.providerResponseId }),
      ...(input.providerToolCallIndex === undefined
        ? {}
        : { providerToolCallIndex: input.providerToolCallIndex }),
      ...(this.authorizationStateReference === undefined
        ? {}
        : { authorizationStateReference: this.authorizationStateReference }),
      action: "read",
      rawResource: input.path,
      normalizedResource,
    } as const;

    const observedEvent: ToolAttemptObservedEvent = {
      type: "TOOL_ATTEMPT_OBSERVED",
      ...eventBase,
    };
    this.eventLog.append(observedEvent);

    if (!input.executable || normalizedResource === null) {
      const resultEvent: ToolAttemptResultEvent = {
        type: "TOOL_ATTEMPT_RESULT",
        ...eventBase,
        authorizationDecision: null,
        enforcementResult: "NOT_EVALUATED",
        executionResult: "MALFORMED",
      };
      this.eventLog.append(resultEvent);
      return {
        attemptId,
        result: { ok: false, error: "MALFORMED" },
      };
    }

    const attemptedAction: AttemptedAction = Object.freeze({
      principal: input.principal,
      action: "read",
      resource: normalizedResource,
      purpose: input.purpose,
      context: input.context,
      step: input.step,
    });
    const authorizationDecision = isAuthorized(
      this.authorizationState,
      attemptedAction,
      input.step,
    );

    if (!authorizationDecision) {
      const resultEvent: ToolAttemptResultEvent = {
        type: "TOOL_ATTEMPT_RESULT",
        ...eventBase,
        authorizationDecision,
        enforcementResult: "BLOCKED",
        executionResult: "BLOCKED_UNAUTHORIZED",
      };
      this.eventLog.append(resultEvent);
      return {
        attemptId,
        result: { ok: false, error: "UNAUTHORIZED" },
      };
    }

    const content = this.environment.readExact(normalizedResource);
    if (content === undefined) {
      const resultEvent: ToolAttemptResultEvent = {
        type: "TOOL_ATTEMPT_RESULT",
        ...eventBase,
        authorizationDecision,
        enforcementResult: "ALLOWED",
        executionResult: "SIMULATOR_ERROR",
      };
      this.eventLog.append(resultEvent);
      return {
        attemptId,
        result: { ok: false, error: "SIMULATOR_ERROR" },
      };
    }

    const resultEvent: ToolAttemptResultEvent = {
      type: "TOOL_ATTEMPT_RESULT",
      ...eventBase,
      authorizationDecision,
      enforcementResult: "ALLOWED",
      executionResult: "SUCCESS",
    };
    this.eventLog.append(resultEvent);
    return { attemptId, result: { ok: true, content } };
  }
}
