import type { Encryptor } from "../security/encryption.js";
import type { WebhookEventType } from "../types/domain.js";
import { newId } from "../utils/id.js";
import type { Repository } from "../repositories/repository.js";

export interface WebhookService {
  enqueueMerchantEvent(
    merchantId: string,
    type: WebhookEventType,
    data: Record<string, unknown>,
    options?: { depositAddressId?: string }
  ): Promise<void>;
}

export class DefaultWebhookService implements WebhookService {
  constructor(
    private readonly repo: Repository,
    private readonly encryptor: Encryptor
  ) {}

  async enqueueMerchantEvent(
    merchantId: string,
    type: WebhookEventType,
    data: Record<string, unknown>,
    options: { depositAddressId?: string } = {}
  ): Promise<void> {
    const preferences = await this.repo.getNotificationPreferences(merchantId);
    if (preferences && !preferences.enabledEvents.includes(type)) {
      return;
    }

    const target = await this.resolveCallbackTarget(merchantId, options.depositAddressId);

    if (!target) {
      return;
    }

    const id = newId();
    const createdAt = new Date().toISOString();
    await this.repo.createWebhookEvent({
      id,
      merchantId,
      depositAddressId: options.depositAddressId ?? null,
      type,
      url: target.url,
      secretEncrypted: target.secretEncrypted,
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

  private async resolveCallbackTarget(
    merchantId: string,
    depositAddressId: string | undefined
  ): Promise<{ url: string; secretEncrypted: string } | null> {
    if (depositAddressId) {
      const depositAddress = await this.repo.getDepositAddressForMerchant(merchantId, depositAddressId);
      if (depositAddress?.callbackUrl && depositAddress.callbackSecretEncrypted) {
        return {
          url: depositAddress.callbackUrl,
          secretEncrypted: depositAddress.callbackSecretEncrypted
        };
      }
    }

    const config = await this.repo.getWebhookConfig(merchantId);
    if (!config?.active) {
      return null;
    }

    return {
      url: config.url,
      secretEncrypted: config.secretEncrypted
    };
  }
}
