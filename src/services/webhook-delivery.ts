import type { AppConfig } from "../config/env.js";
import { createWebhookSignature } from "../security/hmac.js";
import type { Repository } from "../repositories/repository.js";

export interface WebhookDeliveryResult {
  attempted: number;
  sent: number;
  failed: number;
}

export interface WebhookHttpClient {
  fetch(input: string, init: RequestInit): Promise<Response>;
}

export class WebhookDeliveryService {
  constructor(
    private readonly repo: Repository,
    private readonly config: Pick<
      AppConfig,
      "encryptor" | "webhookTimeoutMs" | "webhookMaxAttempts" | "webhookBaseRetrySeconds"
    >,
    private readonly http: WebhookHttpClient = { fetch }
  ) {}

  async deliverDue(limit = 50): Promise<WebhookDeliveryResult> {
    const events = await this.repo.listDueWebhookEvents(new Date(), limit);
    let sent = 0;
    let failed = 0;

    for (const event of events) {
      const body = JSON.stringify(event.payload);
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const secret = this.config.encryptor.decryptString(event.secretEncrypted);
      const signature = createWebhookSignature(secret, timestamp, body);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.webhookTimeoutMs);

      try {
        const response = await this.http.fetch(event.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "evm-deposit-gateway-webhooks/0.1",
            "x-webhook-id": event.id,
            "x-webhook-timestamp": timestamp,
            "x-webhook-signature": `sha256=${signature}`
          },
          body,
          signal: controller.signal
        });

        if (response.status >= 200 && response.status < 300) {
          await this.repo.markWebhookSent(event.id, response.status, new Date());
          sent += 1;
        } else {
          await this.scheduleRetry(event.id, event.attempts + 1, `Webhook returned HTTP ${response.status}`, response.status);
          failed += 1;
        }
      } catch (error) {
        await this.scheduleRetry(
          event.id,
          event.attempts + 1,
          error instanceof Error ? error.message : "Webhook delivery failed",
          null
        );
        failed += 1;
      } finally {
        clearTimeout(timeout);
      }
    }

    return { attempted: events.length, sent, failed };
  }

  private async scheduleRetry(id: string, attempts: number, error: string, responseStatus: number | null): Promise<void> {
    const permanentlyFailed = attempts >= this.config.webhookMaxAttempts;
    const delaySeconds = this.config.webhookBaseRetrySeconds * 2 ** Math.max(0, attempts - 1);
    const nextAttemptAt = new Date(Date.now() + delaySeconds * 1000);

    await this.repo.markWebhookRetry(
      id,
      attempts,
      permanentlyFailed ? "failed" : "pending",
      nextAttemptAt,
      error,
      responseStatus
    );
  }
}
