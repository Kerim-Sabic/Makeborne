/** JSON-only identity helper for the trusted build controller and image. */
export function canonicalRuntimeJson(value) {
  return JSON.stringify(value && typeof value === "object" ? Array.isArray(value)
    ? value.map(value => JSON.parse(canonicalRuntimeJson(value)))
    : Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonicalRuntimeJson(value[key]))])) : value);
}
