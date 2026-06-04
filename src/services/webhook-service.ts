import type { Encryptor } from "../security/encryption.js";
import type { WebhookEventType } from "../types/domain.js";
import { newId } from "../utils/id.js";
import type { Repository } from "../repositories/repository.js";

export interface WebhookService {
  enqueueMerchantEvent(merchantId: string, type: WebhookEventType, data: Record<string, unknown>): Promise<void>;
}

export class DefaultWebhookService implements WebhookService {
  constructor(
    private readonly repo: Repository,
    private readonly encryptor: Encryptor
  ) {}

  async enqueueMerchantEvent(merchantId: string, type: WebhookEventType, data: Record<string, unknown>): Promise<void> {
    const config = await this.repo.getWebhookConfig(merchantId);

    if (!config?.active) {
      return;
    }

    const id = newId();
    const createdAt = new Date().toISOString();
    await this.repo.createWebhookEvent({
      id,
      merchantId,
      type,
      url: config.url,
      secretEncrypted: config.secretEncrypted,
      payload: {
        id,
        type,
        merchantId,
        createdAt,
        data
      }
    });

    void this.encryptor;
  }
}
