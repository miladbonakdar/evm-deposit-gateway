export function sanitizeJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value ?? null));
}

export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(value ?? null);
}
