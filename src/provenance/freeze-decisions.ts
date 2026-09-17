import {
  canonicalJson,
  deepFreezeCanonical,
} from "./canonical-json.js";
import type { CanonicalJsonValue } from "./canonical-json.js";

export const FREEZE_DECISION_CATALOG_VERSION = "freeze-decisions-v0.1";

export const FREEZE_DECISION_IDS = Object.freeze([
  "MODEL_ROSTER_CONFIGURATIONS",
  "REPETITION_COUNT_SAMPLE_SIZE",
  "PROMPT_VARIANT_STRATEGY",
  "RANDOMIZATION_COUNTERBALANCING",
  "RETRY_POLICY",
  "RESPONSE_CAP_POLICY",
  "SCORING_SPECIFICATION",
  "MAIN_DATA_BOUNDARY",
  "DENOMINATOR_CONVENTION",
  "STATISTICAL_ANALYSIS_METHOD",
  "ANNOTATION_PROTOCOL",
  "POSITIVE_CONTROL_ADEQUACY",
  "FORMAL_FREEZE_ACCEPTANCE",
] as const);

export type FreezeDecisionId = (typeof FREEZE_DECISION_IDS)[number];
export type FreezeDecisionGate = "ASSIGNMENT" | "COLLECTION" | "ANALYSIS";

export interface FreezeDecisionCatalogEntry {
  readonly id: FreezeDecisionId;
  readonly gate: FreezeDecisionGate;
  readonly allowNotApplicable: boolean;
  readonly resolutionRule: "CANONICAL_JSON_VALUE";
}

const catalogEntry = (
  id: FreezeDecisionId,
  gate: FreezeDecisionGate,
): FreezeDecisionCatalogEntry => Object.freeze({
  id,
  gate,
  allowNotApplicable: false,
  resolutionRule: "CANONICAL_JSON_VALUE",
});

export const FREEZE_DECISION_CATALOG: Readonly<
  Record<FreezeDecisionId, FreezeDecisionCatalogEntry>
> = Object.freeze({
  MODEL_ROSTER_CONFIGURATIONS: catalogEntry("MODEL_ROSTER_CONFIGURATIONS", "ASSIGNMENT"),
  REPETITION_COUNT_SAMPLE_SIZE: catalogEntry("REPETITION_COUNT_SAMPLE_SIZE", "ASSIGNMENT"),
  PROMPT_VARIANT_STRATEGY: catalogEntry("PROMPT_VARIANT_STRATEGY", "ASSIGNMENT"),
  RANDOMIZATION_COUNTERBALANCING: catalogEntry("RANDOMIZATION_COUNTERBALANCING", "ASSIGNMENT"),
  RETRY_POLICY: catalogEntry("RETRY_POLICY", "COLLECTION"),
  RESPONSE_CAP_POLICY: catalogEntry("RESPONSE_CAP_POLICY", "COLLECTION"),
  SCORING_SPECIFICATION: catalogEntry("SCORING_SPECIFICATION", "COLLECTION"),
  MAIN_DATA_BOUNDARY: catalogEntry("MAIN_DATA_BOUNDARY", "COLLECTION"),
  DENOMINATOR_CONVENTION: catalogEntry("DENOMINATOR_CONVENTION", "COLLECTION"),
  STATISTICAL_ANALYSIS_METHOD: catalogEntry("STATISTICAL_ANALYSIS_METHOD", "COLLECTION"),
  ANNOTATION_PROTOCOL: catalogEntry("ANNOTATION_PROTOCOL", "ANALYSIS"),
  POSITIVE_CONTROL_ADEQUACY: catalogEntry("POSITIVE_CONTROL_ADEQUACY", "COLLECTION"),
  FORMAL_FREEZE_ACCEPTANCE: catalogEntry("FORMAL_FREEZE_ACCEPTANCE", "COLLECTION"),
});

export type FreezeDecision =
  | Readonly<{ state: "RESOLVED"; value: CanonicalJsonValue }>
  | Readonly<{ state: "UNRESOLVED" }>
  | Readonly<{
      state: "NOT_APPLICABLE";
      applicabilityRuleId: string;
      rationaleCode: string;
    }>;

export type FreezeDecisionRegistry = Readonly<
  Record<FreezeDecisionId, FreezeDecision>
>;

export type FreezeDecisionRegistryIssue =
  | Readonly<{ code: "MISSING_FREEZE_DECISION"; decisionId: FreezeDecisionId }>
  | Readonly<{ code: "EXTRA_FREEZE_DECISION"; decisionId: string }>
  | Readonly<{ code: "INVALID_FREEZE_DECISION"; decisionId: string }>
  | Readonly<{ code: "INVALID_NOT_APPLICABLE"; decisionId: FreezeDecisionId }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === [...expected].sort()[index]);
}

function decisionIsValid(
  id: FreezeDecisionId,
  value: unknown,
): "VALID" | "INVALID" | "INVALID_NOT_APPLICABLE" {
  if (!isRecord(value) || typeof value.state !== "string") return "INVALID";
  if (value.state === "UNRESOLVED") {
    return exactKeys(value, ["state"]) ? "VALID" : "INVALID";
  }
  if (value.state === "RESOLVED") {
    if (!exactKeys(value, ["state", "value"])) return "INVALID";
    try {
      canonicalJson(value.value as CanonicalJsonValue);
      return "VALID";
    } catch {
      return "INVALID";
    }
  }
  if (value.state === "NOT_APPLICABLE") {
    if (!FREEZE_DECISION_CATALOG[id].allowNotApplicable) {
      return "INVALID_NOT_APPLICABLE";
    }
    return exactKeys(value, ["state", "applicabilityRuleId", "rationaleCode"]) &&
      typeof value.applicabilityRuleId === "string" && value.applicabilityRuleId.length > 0 &&
      typeof value.rationaleCode === "string" && value.rationaleCode.length > 0
      ? "VALID"
      : "INVALID";
  }
  return "INVALID";
}

export function freezeDecisionRegistryIssues(
  value: unknown,
): readonly FreezeDecisionRegistryIssue[] {
  if (!isRecord(value)) {
    return Object.freeze(FREEZE_DECISION_IDS.map((decisionId) =>
      Object.freeze({ code: "MISSING_FREEZE_DECISION" as const, decisionId })));
  }
  const issues: FreezeDecisionRegistryIssue[] = [];
  const expected = new Set<string>(FREEZE_DECISION_IDS);
  for (const id of FREEZE_DECISION_IDS) {
    if (!Object.hasOwn(value, id)) {
      issues.push({ code: "MISSING_FREEZE_DECISION", decisionId: id });
      continue;
    }
    const validity = decisionIsValid(id, value[id]);
    if (validity === "INVALID_NOT_APPLICABLE") {
      issues.push({ code: "INVALID_NOT_APPLICABLE", decisionId: id });
    } else if (validity === "INVALID") {
      issues.push({ code: "INVALID_FREEZE_DECISION", decisionId: id });
    }
  }
  for (const id of Object.keys(value)) {
    if (!expected.has(id)) issues.push({ code: "EXTRA_FREEZE_DECISION", decisionId: id });
  }
  return Object.freeze(issues.map((issue) => Object.freeze(issue)));
}

export function verifyFreezeDecisionRegistry(
  value: unknown,
): FreezeDecisionRegistry {
  const issues = freezeDecisionRegistryIssues(value);
  if (issues.length > 0) {
    const issue = issues[0] as FreezeDecisionRegistryIssue;
    if (issue.code === "INVALID_NOT_APPLICABLE") {
      throw new TypeError(`NOT_APPLICABLE is not allowed for ${issue.decisionId}`);
    }
    throw new TypeError(`${issue.code}: ${issue.decisionId}`);
  }
  return deepFreezeCanonical(
    value as CanonicalJsonValue,
  ) as unknown as FreezeDecisionRegistry;
}

export function createFreezeDecisionRegistry(
  value: unknown,
): FreezeDecisionRegistry {
  return verifyFreezeDecisionRegistry(value);
}
