import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { unauthorized } from "../errors.js";

export interface AdminSessionPayload {
  sub: string;
  iat: number;
  exp: number;
  jti: string;
}

export function constantTimeStringEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

export function createAdminSessionToken(username: string, secret: string, ttlSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: AdminSessionPayload = {
    sub: username,
    iat: now,
    exp: now + ttlSeconds,
    jti: randomUUID()
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signPayload(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function verifyAdminSessionToken(token: string, secret: string): AdminSessionPayload {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    throw unauthorized("invalid_admin_session", "Invalid admin session");
  }

  const expectedSignature = signPayload(encodedPayload, secret);
  if (!constantTimeStringEqual(signature, expectedSignature)) {
    throw unauthorized("invalid_admin_session", "Invalid admin session");
  }

  let parsed: Partial<AdminSessionPayload>;
  try {
    parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<AdminSessionPayload>;
  } catch {
    throw unauthorized("invalid_admin_session", "Invalid admin session");
  }
  const now = Math.floor(Date.now() / 1000);
  if (
    typeof parsed.sub !== "string" ||
    typeof parsed.iat !== "number" ||
    typeof parsed.exp !== "number" ||
    typeof parsed.jti !== "string"
  ) {
    throw unauthorized("invalid_admin_session", "Invalid admin session");
  }

  if (parsed.exp <= now) {
    throw unauthorized("expired_admin_session", "Admin session has expired");
  }

  return {
    sub: parsed.sub,
    iat: parsed.iat,
    exp: parsed.exp,
    jti: parsed.jti
  };
}

function signPayload(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}
