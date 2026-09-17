import { createHash } from "node:crypto";

/**
 * Frozen v0.1 contract:
 * - UTF-8 JSON with object keys sorted by ECMAScript UTF-16 code-unit order;
 * - array order and string contents preserved;
 * - finite JSON numbers only, with negative zero normalized to zero;
 * - null and booleans encoded as JSON literals;
 * - only dense arrays and plain data objects with enumerable data properties;
 * - unsupported values, accessors, symbol keys, and cycles rejected.
 */
export const CANONICAL_HASH_CONTRACT_VERSION = "canonical-json-v0.1";

export type CanonicalJsonPrimitive = string | number | boolean | null;
export type CanonicalJsonValue =
  | CanonicalJsonPrimitive
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

function invalid(detail: string): never {
  throw new TypeError(`Unsupported canonical JSON value: ${detail}`);
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function serialize(value: unknown, ancestors: Set<object>): string {
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        return invalid("numbers must be finite");
      }
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    case "undefined":
    case "function":
    case "symbol":
    case "bigint":
      return invalid(typeof value);
    case "object":
      break;
  }

  if (ancestors.has(value)) {
    return invalid("cyclic structure");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) {
          return invalid("sparse arrays are not supported");
        }
        items.push(serialize(value[index], ancestors));
      }
      return `[${items.join(",")}]`;
    }

    if (!isPlainObject(value)) {
      return invalid("only plain objects are supported");
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) {
      return invalid("symbol keys are not supported");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = (ownKeys as string[]).sort();
    const members = keys.map((key) => {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        descriptor.get !== undefined ||
        descriptor.set !== undefined
      ) {
        return invalid("object properties must be enumerable data properties");
      }
      return `${JSON.stringify(key)}:${serialize(descriptor.value, ancestors)}`;
    });
    return `{${members.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJson(value: CanonicalJsonValue): string {
  return serialize(value, new Set());
}

export function sha256CanonicalJson(value: CanonicalJsonValue): string {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function cloneAndFreeze(value: CanonicalJsonValue): CanonicalJsonValue {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneAndFreeze(item)));
  }
  const clone: Record<string, CanonicalJsonValue> = {};
  const objectValue = value as { readonly [key: string]: CanonicalJsonValue };
  for (const key of Object.keys(objectValue).sort()) {
    clone[key] = cloneAndFreeze(objectValue[key] as CanonicalJsonValue);
  }
  return Object.freeze(clone);
}

export function deepFreezeCanonical<T extends CanonicalJsonValue>(value: T): T {
  canonicalJson(value);
  return cloneAndFreeze(value) as T;
}
