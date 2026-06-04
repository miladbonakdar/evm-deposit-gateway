import { randomBytes, randomUUID } from "node:crypto";

export function newId(): string {
  return randomUUID();
}

export function newPublicApiKey(): string {
  return `pk_${randomBytes(24).toString("base64url")}`;
}

export function newSecret(): string {
  return `sk_${randomBytes(32).toString("base64url")}`;
}

export function newWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}
