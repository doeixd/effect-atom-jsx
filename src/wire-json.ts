/**
 * Report why a schema-encoded value cannot be represented faithfully as JSON.
 *
 * `Schema.Unknown` deliberately accepts runtime values, while JSON would
 * silently drop functions/symbols or coerce non-finite numbers. Portable wire
 * protocols use this check after schema encoding and before serialization.
 */
export function jsonValueIssue(
  value: unknown,
  subject: string,
): string | undefined {
  const seen = new WeakSet<object>();
  const visit = (current: unknown, path: string): string | undefined => {
    if (
      current === null
      || typeof current === "string"
      || typeof current === "boolean"
    ) {
      return undefined;
    }
    if (typeof current === "number") {
      return Number.isFinite(current)
        ? undefined
        : `${subject} ${path} must be a finite JSON number.`;
    }
    if (typeof current !== "object") {
      return `${subject} ${path} is not JSON-safe (${typeof current}).`;
    }
    if (seen.has(current)) {
      return `${subject} ${path} contains a cycle.`;
    }
    seen.add(current);
    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          current,
          String(index),
        );
        if (descriptor === undefined) {
          seen.delete(current);
          return `${subject} ${path}[${index}] is a sparse array entry and cannot be represented faithfully as JSON.`;
        }
        if (!("value" in descriptor)) {
          seen.delete(current);
          return `${subject} ${path}[${index}] is accessor-backed and cannot be inspected safely.`;
        }
        const issue = visit(descriptor.value, `${path}[${index}]`);
        if (issue !== undefined) {
          seen.delete(current);
          return issue;
        }
      }
      for (const key of Reflect.ownKeys(current)) {
        if (
          key === "length"
          || (
            typeof key === "string"
            && /^(0|[1-9][0-9]*)$/.test(key)
            && Number(key) < current.length
          )
        ) {
          continue;
        }
        seen.delete(current);
        return `${subject} ${path} contains an array property that JSON would discard (${String(key)}).`;
      }
      seen.delete(current);
      return undefined;
    }
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) {
      seen.delete(current);
      return `${subject} ${path} must encode to a plain JSON object.`;
    }
    for (const key of Reflect.ownKeys(current)) {
      if (typeof key !== "string") {
        seen.delete(current);
        return `${subject} ${path} contains a symbol key.`;
      }
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor === undefined) {
        seen.delete(current);
        return `${subject} ${path}.${key} could not be inspected safely.`;
      }
      if (!descriptor.enumerable) {
        seen.delete(current);
        return `${subject} ${path}.${key} is non-enumerable and JSON would discard it.`;
      }
      if (!("value" in descriptor)) {
        seen.delete(current);
        return `${subject} ${path}.${key} is accessor-backed and cannot be inspected safely.`;
      }
      const issue = visit(descriptor.value, `${path}.${key}`);
      if (issue !== undefined) {
        seen.delete(current);
        return issue;
      }
    }
    seen.delete(current);
    return undefined;
  };
  try {
    return visit(value, "$");
  } catch (error) {
    return `${subject} could not be inspected as JSON: ${String(error)}`;
  }
}
