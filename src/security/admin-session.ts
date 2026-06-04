import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { unauthorized } from "../errors.js";

export interface AdminSessionPayload {
  sub: string;
  iat: number;
  exp: number;
  jti: string;
}

export function constantTimeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
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
  if (!parsed.sub || !parsed.exp || parsed.exp <= now) {
    throw unauthorized("expired_admin_session", "Admin session has expired");
  }

  return {
    sub: parsed.sub,
    iat: Number(parsed.iat ?? 0),
    exp: parsed.exp,
    jti: String(parsed.jti ?? "")
  };
}

function signPayload(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}
