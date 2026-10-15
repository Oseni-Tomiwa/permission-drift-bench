import { sha256CanonicalJson } from "./canonical-json.js";
import type { CanonicalJsonValue } from "./canonical-json.js";
import { createAssignmentDefinition } from "./run-specification.js";
import type { AssignmentDefinition } from "./run-specification.js";

export const SCOPE_V01_RANDOMIZATION_VERSION =
  "scope-v0.1-permuted-block-randomization-v0.1";
export const SCOPE_V01_BLOCK_SIZE = 4;
export const SCOPE_V01_BLOCKS_PER_MODEL = 100;
export const SCOPE_V01_CONDITIONS = Object.freeze([
  "A",
  "B",
  "C",
  "D",
] as const);

export type ScopeV01Condition = (typeof SCOPE_V01_CONDITIONS)[number];

export interface ScopeV01PromptReference {
  readonly condition: ScopeV01Condition;
  readonly promptId: string;
  readonly promptHash: string;
  readonly promptVersion: string;
}

export interface ScopeV01AssignmentModel {
  readonly modelConfigurationId: string;
  readonly promptReferences: Readonly<
    Record<ScopeV01Condition, ScopeV01PromptReference>
  >;
}

export interface ScopeV01AssignmentGenerationInput {
  readonly masterSeed: string;
  readonly models: readonly ScopeV01AssignmentModel[];
}

function requireNonempty(name: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a nonempty string`);
  }
}

export function deriveModelRandomizationSeed(
  masterSeed: string,
  modelConfigurationId: string,
): string {
  requireNonempty("Master seed", masterSeed);
  requireNonempty("Model configuration ID", modelConfigurationId);
  return sha256CanonicalJson({
    algorithmVersion: SCOPE_V01_RANDOMIZATION_VERSION,
    masterSeed,
    modelConfigurationId,
  });
}

function deterministicIndex(
  modelSeed: string,
  blockIndex: number,
  drawIndex: number,
  upperExclusive: number,
): number {
  const range = 1n << 64n;
  const modulus = BigInt(upperExclusive);
  const acceptanceLimit = range - (range % modulus);
  for (let rejectionCounter = 0; ; rejectionCounter += 1) {
    const digest = sha256CanonicalJson({
      algorithmVersion: SCOPE_V01_RANDOMIZATION_VERSION,
      modelSeed,
      blockIndex,
      drawIndex,
      rejectionCounter,
    });
    const sample = BigInt(`0x${digest.slice(0, 16)}`);
    if (sample < acceptanceLimit) return Number(sample % modulus);
  }
}

function permutedConditions(
  modelSeed: string,
  blockIndex: number,
): readonly ScopeV01Condition[] {
  const conditions = [...SCOPE_V01_CONDITIONS];
  let drawIndex = 0;
  for (let current = conditions.length - 1; current > 0; current -= 1) {
    const selected = deterministicIndex(
      modelSeed,
      blockIndex,
      drawIndex,
      current + 1,
    );
    [conditions[current], conditions[selected]] = [
      conditions[selected] as ScopeV01Condition,
      conditions[current] as ScopeV01Condition,
    ];
    drawIndex += 1;
  }
  return Object.freeze(conditions);
}

function validatePromptReferences(
  value: ScopeV01AssignmentModel["promptReferences"],
): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Prompt references must be an A-D record");
  }
  const keys = Object.keys(value).sort();
  if (
    keys.length !== SCOPE_V01_CONDITIONS.length ||
    keys.some((key, index) => key !== [...SCOPE_V01_CONDITIONS].sort()[index])
  ) {
    throw new TypeError("Prompt references must contain exactly A, B, C, and D");
  }
  for (const condition of SCOPE_V01_CONDITIONS) {
    const reference = value[condition];
    if (
      reference.condition !== condition ||
      reference.promptVersion !== "pilot-0.2.0" ||
      !/^[a-f0-9]{64}$/.test(reference.promptHash)
    ) {
      throw new TypeError(`Invalid canonical prompt reference for condition ${condition}`);
    }
    requireNonempty(`Prompt ID for condition ${condition}`, reference.promptId);
    const expectedPromptId =
      `${reference.promptVersion}:${condition}:${reference.promptHash}`;
    if (reference.promptId !== expectedPromptId) {
      throw new TypeError(`Prompt ID for condition ${condition} does not match its version, condition, and hash`);
    }
  }
}

export function createScopeV01AssignmentDefinitions(
  input: ScopeV01AssignmentGenerationInput,
): readonly AssignmentDefinition[] {
  requireNonempty("Master seed", input.masterSeed);
  if (!Array.isArray(input.models) || input.models.length === 0) {
    throw new TypeError("At least one model configuration is required");
  }
  const modelIds = new Set<string>();
  const assignments: AssignmentDefinition[] = [];

  for (const model of input.models) {
    requireNonempty("Model configuration ID", model.modelConfigurationId);
    if (modelIds.has(model.modelConfigurationId)) {
      throw new TypeError("Duplicate model configuration ID");
    }
    modelIds.add(model.modelConfigurationId);
    validatePromptReferences(model.promptReferences);

    const modelSeed = deriveModelRandomizationSeed(
      input.masterSeed,
      model.modelConfigurationId,
    );
    const repetitions: Record<ScopeV01Condition, number> = {
      A: 0,
      B: 0,
      C: 0,
      D: 0,
    };
    let orderingAssignment = 0;

    for (
      let zeroBasedBlockIndex = 0;
      zeroBasedBlockIndex < SCOPE_V01_BLOCKS_PER_MODEL;
      zeroBasedBlockIndex += 1
    ) {
      const blockIndex = zeroBasedBlockIndex + 1;
      const block = permutedConditions(modelSeed, blockIndex);
      for (let zeroBasedPosition = 0; zeroBasedPosition < block.length; zeroBasedPosition += 1) {
        const condition = block[zeroBasedPosition] as ScopeV01Condition;
        const reference = model.promptReferences[condition];
        repetitions[condition] += 1;
        orderingAssignment += 1;
        assignments.push(createAssignmentDefinition({
          scheduledTrialId:
            `scope-v0.1:${model.modelConfigurationId}:${String(orderingAssignment).padStart(3, "0")}`,
          condition,
          promptId: reference.promptId,
          promptHash: reference.promptHash,
          promptVersion: reference.promptVersion,
          modelConfigurationId: model.modelConfigurationId,
          repetitionIndex: repetitions[condition],
          orderingAssignment,
          randomizationAssignment: {
            state: "RESOLVED",
            value: {
              algorithmVersion: SCOPE_V01_RANDOMIZATION_VERSION,
              modelSeed,
              blockIndex,
              positionInBlock: zeroBasedPosition + 1,
            } as CanonicalJsonValue,
          },
          randomizationBlock: {
            state: "RESOLVED",
            value: {
              strategy: "PERMUTED_BLOCK_RANDOMIZATION",
              stratifyBy: "model",
              modelConfigurationId: model.modelConfigurationId,
              blockIndex,
              blockSize: SCOPE_V01_BLOCK_SIZE,
            } as CanonicalJsonValue,
          },
        }));
      }
    }
  }

  return Object.freeze(assignments);
}
