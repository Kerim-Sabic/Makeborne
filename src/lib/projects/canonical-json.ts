/** Makeborne JSON identity v1. Valid JSON only; sorted keys, unchanged array order. */
export function canonicalSourceJson(value: unknown): string {
  const ancestors = new Set<object>();
  function encode(current: unknown): string {
    if (current === null || typeof current === "string" || typeof current === "boolean") return JSON.stringify(current);
    if (typeof current === "number" && Number.isFinite(current)) return JSON.stringify(current);
    if (typeof current !== "object" || Object.prototype.toString.call(current) !== (Array.isArray(current) ? "[object Array]" : "[object Object]")) {
      throw new Error("Source identity requires JSON values.");
    }
    if (ancestors.has(current)) throw new Error("Source identity cannot contain cycles.");
    ancestors.add(current);
    let result: string;
    if (Array.isArray(current)) {
      const values: string[] = [];
      for (let index = 0; index < current.length; index++) {
        if (!Object.hasOwn(current, index)) throw new Error("Source identity cannot contain sparse arrays.");
        values.push(encode(current[index]));
      }
      result = `[${values.join(",")}]`;
    } else {
      result = `{${Object.keys(current).sort().map(key => `${JSON.stringify(key)}:${encode((current as Record<string, unknown>)[key])}`).join(",")}}`;
    }
    ancestors.delete(current);
    return result;
  }
  return encode(value);
}
