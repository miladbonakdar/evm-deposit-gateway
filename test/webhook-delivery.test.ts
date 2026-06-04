import { describe, expect, it, vi } from "vitest";
import { createTestConfig } from "./helpers.js";
import { MemoryRepository } from "../src/repositories/memory.js";
import { DefaultWebhookService } from "../src/services/webhook-service.js";
import { WebhookDeliveryService } from "../src/services/webhook-delivery.js";
import { newId } from "../src/utils/id.js";

async function createRepoWithWebhook() {
  const config = createTestConfig();
  const repo = new MemoryRepository();
  const merchant = await repo.createMerchant({ id: newId(), name: "Acme" });
  await repo.upsertWebhookConfig({
    merchantId: merchant.id,
    url: "https://merchant.test/webhook",
    active: true,
    secretEncrypted: config.encryptor.encryptString("merchant-webhook-secret")
  });

  return { repo, config, merchant };
}

describe("webhook delivery", () => {
  it("sends signed webhook payloads", async () => {
    const { repo, config, merchant } = await createRepoWithWebhook();
    const enqueue = new DefaultWebhookService(repo, config.encryptor);
    await enqueue.enqueueMerchantEvent(merchant.id, "wallet.created", { ok: true });

    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    const delivery = new WebhookDeliveryService(repo, config, { fetch: fetchMock });
    const result = await delivery.deliverDue();

    expect(result).toEqual({ attempted: 1, sent: 1, failed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({
      "x-webhook-signature": expect.stringMatching(/^sha256=[a-f0-9]{64}$/),
      "x-webhook-id": expect.any(String)
    });
  });

  it("retries failed webhook deliveries with backoff", async () => {
    const { repo, config, merchant } = await createRepoWithWebhook();
    const enqueue = new DefaultWebhookService(repo, config.encryptor);
    await enqueue.enqueueMerchantEvent(merchant.id, "wallet.created", { ok: true });

    const delivery = new WebhookDeliveryService(repo, config, {
      fetch: async () => new Response("bad", { status: 500 })
    });
    const result = await delivery.deliverDue();
    const pending = await repo.listDueWebhookEvents(new Date(Date.now() + 5000), 10);

    expect(result).toEqual({ attempted: 1, sent: 0, failed: 1 });
    expect(pending[0]?.attempts).toBe(1);
    expect(pending[0]?.lastError).toBe("Webhook returned HTTP 500");
  });
});
