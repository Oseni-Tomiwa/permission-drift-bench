import type { PrimaryEndpointOutcome } from "../evaluator/primary-endpoint.js";
import type { TrialOutcome } from "../evaluator/trial-outcome.js";
import { verifyRunSpecification } from "../provenance/run-specification.js";
import type { VerifiedRunSpecification } from "../provenance/run-specification.js";
import { MAX_ATTEMPTS_PER_SCHEDULED_TRIAL } from "../schemas/trial-policy.js";
import type {
  AttemptDisposition,
  IntegrityFailureCode,
  IntegrityStatus,
  RetryReasonCode,
  ScheduledTrialStatus,
  TerminationReason,
} from "../schemas/trial-policy.js";

export interface AppendableTrialAttempt {
  readonly scheduledTrialId: string;
  readonly runSpecificationId: string;
  readonly runSpecificationHash: string;
  readonly assignmentDefinitionId: string;
  readonly conditionId: string;
  readonly trialAttemptId: string;
  readonly attemptNumber: number;
  readonly replacementForAttemptId: string | null;
  readonly integrityStatus: IntegrityStatus;
  readonly integrityFailureCode: IntegrityFailureCode | null;
  readonly terminationReason: TerminationReason;
  readonly behavioralOutcome: TrialOutcome;
  readonly primaryEndpointOutcome: PrimaryEndpointOutcome;
  readonly attemptDisposition: AttemptDisposition;
  readonly retryEligible: boolean;
  readonly retryReasonCode: RetryReasonCode;
}

export type ScheduledTrialAttemptRecord = Readonly<AppendableTrialAttempt>;

export interface ScheduledTrialReplacementLink {
  readonly scheduledTrialId: string;
  readonly finalAttemptId: string;
}

export interface ScheduledTrialRecord {
  readonly scheduledTrialId: string;
  readonly runSpecificationId: string;
  readonly runSpecificationHash: string;
  readonly assignmentDefinitionId: string;
  readonly modelConfigurationId: string;
  readonly condition: string;
  readonly promptId: string;
  readonly promptHash: string;
  readonly promptVersion: string;
  readonly orderingAssignment: number;
  readonly repetitionIndex: number;
  readonly replacementForScheduledTrialId: string | null;
  readonly replacementForAttemptId: string | null;
  readonly replacementLineage: readonly ScheduledTrialReplacementLink[];
  readonly status: ScheduledTrialStatus;
  readonly finalAnalyzableAttemptId: string | null;
  readonly attempts: readonly ScheduledTrialAttemptRecord[];
}

function verifiedRun(value: VerifiedRunSpecification): VerifiedRunSpecification {
  try {
    return verifyRunSpecification(value);
  } catch {
    throw new Error("Scheduled trial requires a verified run specification");
  }
}

function assignmentForScheduledTrial(
  scheduledTrialId: string,
  run: VerifiedRunSpecification,
) {
  const matches = run.assignmentDefinitions.filter(
    (definition) => definition.scheduledTrialId === scheduledTrialId,
  );
  if (matches.length !== 1) {
    throw new Error("Scheduled trial ID must resolve to exactly one assignment definition");
  }
  return matches[0] as (typeof matches)[number];
}

function createBoundScheduledTrial(
  scheduledTrialId: string,
  run: VerifiedRunSpecification,
  assignmentDefinitionId: string,
  replacementForScheduledTrialId: string | null,
  replacementForAttemptId: string | null,
  replacementLineage: readonly ScheduledTrialReplacementLink[],
): ScheduledTrialRecord {
  const definition = run.assignmentDefinitions.find(
    (candidate) => candidate.assignmentDefinitionId === assignmentDefinitionId,
  );
  if (definition === undefined) {
    throw new Error("Assignment definition is not present in the verified run specification");
  }
  return Object.freeze({
    scheduledTrialId,
    runSpecificationId: run.runSpecificationId,
    runSpecificationHash: run.runSpecificationHash,
    assignmentDefinitionId: definition.assignmentDefinitionId,
    modelConfigurationId: definition.modelConfigurationId,
    condition: definition.condition,
    promptId: definition.promptId,
    promptHash: definition.promptHash,
    promptVersion: definition.promptVersion,
    orderingAssignment: definition.orderingAssignment,
    repetitionIndex: definition.repetitionIndex,
    replacementForScheduledTrialId,
    replacementForAttemptId,
    replacementLineage: Object.freeze(
      replacementLineage.map((link) => Object.freeze({ ...link })),
    ),
    status: "PENDING",
    finalAnalyzableAttemptId: null,
    attempts: Object.freeze([]),
  });
}

export function createScheduledTrial(
  scheduledTrialId: string,
  value: VerifiedRunSpecification,
): ScheduledTrialRecord {
  if (scheduledTrialId.length === 0) {
    throw new Error("Scheduled trial ID must not be empty");
  }
  const run = verifiedRun(value);
  const definition = assignmentForScheduledTrial(scheduledTrialId, run);
  return createBoundScheduledTrial(
    scheduledTrialId,
    run,
    definition.assignmentDefinitionId,
    null,
    null,
    [],
  );
}

export function createReplacementScheduledTrial(options: {
  readonly scheduledTrialId: string;
  readonly replaces: ScheduledTrialRecord;
  readonly verifiedRun: VerifiedRunSpecification;
}): ScheduledTrialRecord {
  if (options.scheduledTrialId.length === 0) {
    throw new Error("Replacement scheduled trial ID must not be empty");
  }
  if (
    options.replaces.status !== "ABANDONED" &&
    options.replaces.status !== "QUARANTINED"
  ) {
    throw new Error("Replacement requires a terminal non-analyzable scheduled trial");
  }
  const finalAttempt = options.replaces.attempts.at(-1);
  if (finalAttempt === undefined) {
    throw new Error("Replacement requires a final failed or quarantined attempt");
  }
  const usedScheduledIds = new Set([
    options.replaces.scheduledTrialId,
    ...options.replaces.replacementLineage.map((link) => link.scheduledTrialId),
  ]);
  if (usedScheduledIds.has(options.scheduledTrialId)) {
    throw new Error("Replacement scheduled trial ID must be unique in its lineage");
  }
  const run = verifiedRun(options.verifiedRun);
  if (
    options.replaces.runSpecificationId !== run.runSpecificationId ||
    options.replaces.runSpecificationHash !== run.runSpecificationHash
  ) {
    throw new Error("Replacement belongs to a different run specification");
  }
  return createBoundScheduledTrial(
    options.scheduledTrialId,
    run,
    options.replaces.assignmentDefinitionId,
    options.replaces.scheduledTrialId,
    finalAttempt.trialAttemptId,
    [
      ...options.replaces.replacementLineage,
      {
        scheduledTrialId: options.replaces.scheduledTrialId,
        finalAttemptId: finalAttempt.trialAttemptId,
      },
    ],
  );
}

function statusAfterAttempt(
  disposition: AttemptDisposition,
): ScheduledTrialStatus {
  switch (disposition) {
    case "ANALYZABLE":
      return "ANALYZABLE";
    case "RETRYABLE_INFRASTRUCTURE_FAILURE":
      return "PENDING";
    case "NONRETRYABLE_INCOMPLETE":
      return "ABANDONED";
    case "QUARANTINED_INTEGRITY_INVALID":
      return "QUARANTINED";
  }
}

export function appendTrialAttempt(
  scheduled: ScheduledTrialRecord,
  attempt: AppendableTrialAttempt,
): ScheduledTrialRecord {
  if (scheduled.status !== "PENDING") {
    throw new Error(`Cannot append to scheduled trial in ${scheduled.status}`);
  }
  if (attempt.trialAttemptId.length === 0) {
    throw new Error("Trial attempt ID must not be empty");
  }
  if (attempt.scheduledTrialId !== scheduled.scheduledTrialId) {
    throw new Error("Attempt belongs to a different scheduled trial");
  }
  if (
    attempt.runSpecificationId !== scheduled.runSpecificationId ||
    attempt.runSpecificationHash !== scheduled.runSpecificationHash
  ) {
    throw new Error("Attempt belongs to a different run specification");
  }
  if (attempt.assignmentDefinitionId !== scheduled.assignmentDefinitionId) {
    throw new Error("Attempt belongs to a different assignment definition");
  }
  if (attempt.conditionId !== scheduled.condition) {
    throw new Error("Attempt condition does not match scheduled assignment");
  }
  const expectedAttemptNumber = scheduled.attempts.length + 1;
  const previousAttempt = scheduled.attempts.at(-1);
  const expectedReplacementId =
    previousAttempt === undefined ? null : previousAttempt.trialAttemptId;
  if (
    attempt.attemptNumber !== expectedAttemptNumber ||
    attempt.replacementForAttemptId !== expectedReplacementId ||
    scheduled.attempts.some(
      (candidate) => candidate.trialAttemptId === attempt.trialAttemptId,
    )
  ) {
    throw new Error("Attempt linkage is not the next append-only retry");
  }
  if (attempt.attemptNumber > MAX_ATTEMPTS_PER_SCHEDULED_TRIAL) {
    throw new Error("Attempt limit exceeded");
  }
  if (
    attempt.attemptNumber === MAX_ATTEMPTS_PER_SCHEDULED_TRIAL &&
    attempt.attemptDisposition === "RETRYABLE_INFRASTRUCTURE_FAILURE"
  ) {
    throw new Error("Third failed attempt must be terminal at the attempt limit");
  }
  if (
    attempt.retryEligible !==
    (attempt.attemptDisposition === "RETRYABLE_INFRASTRUCTURE_FAILURE")
  ) {
    throw new Error("Attempt retry eligibility contradicts its disposition");
  }

  const record = Object.freeze({ ...attempt });
  const status = statusAfterAttempt(attempt.attemptDisposition);
  return Object.freeze({
    ...scheduled,
    status,
    finalAnalyzableAttemptId:
      status === "ANALYZABLE" ? attempt.trialAttemptId : null,
    attempts: Object.freeze([...scheduled.attempts, record]),
  });
}
