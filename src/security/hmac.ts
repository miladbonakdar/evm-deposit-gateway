import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface HmacRequestParts {
  method: string;
  pathWithQuery: string;
  timestamp: string;
  nonce: string;
  body: string | Buffer;
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function buildCanonicalRequest(parts: HmacRequestParts): string {
  return [
    parts.method.toUpperCase(),
    parts.pathWithQuery,
    parts.timestamp,
    parts.nonce,
    sha256Hex(Buffer.isBuffer(parts.body) ? parts.body : Buffer.from(parts.body))
  ].join("\n");
}

export function signCanonicalRequest(secret: string, canonicalRequest: string): string {
  return createHmac("sha256", secret).update(canonicalRequest).digest("hex");
}

export function signRequest(secret: string, parts: HmacRequestParts): string {
  return signCanonicalRequest(secret, buildCanonicalRequest(parts));
}

export function normalizeSignature(signature: string): string {
  return signature.startsWith("sha256=") ? signature.slice("sha256=".length) : signature;
}

export function timingSafeEqualHex(left: string, right: string): boolean {
  const normalizedLeft = normalizeSignature(left).toLowerCase();
  const normalizedRight = normalizeSignature(right).toLowerCase();

  if (!/^[a-f0-9]{64}$/.test(normalizedLeft) || !/^[a-f0-9]{64}$/.test(normalizedRight)) {
    return false;
  }

  return timingSafeEqual(Buffer.from(normalizedLeft, "hex"), Buffer.from(normalizedRight, "hex"));
}

export function createWebhookSignature(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}
