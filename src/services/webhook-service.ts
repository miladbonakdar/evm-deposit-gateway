import type { Encryptor } from "../security/encryption.js";
import type { WebhookEventType } from "../types/domain.js";
import { newId } from "../utils/id.js";
import type { Repository } from "../repositories/repository.js";
export interface WebhookService { enqueueMerchantEvent(merchantId: string, type: WebhookEventType, data: Record<string, unknown>, options?: { depositAddressId?: string }): Promise<void>; }
export class DefaultWebhookService implements WebhookService {
  constructor(private readonly repo: Repository, private readonly encryptor: Encryptor) {}
  async enqueueMerchantEvent(merchantId: string, type: WebhookEventType, data: Record<string, unknown>, options: { depositAddressId?: string } = {}) {
    const prefs = await this.repo.getNotificationPreferences(merchantId);
    if (prefs && !prefs.enabledEvents.includes(type)) return;
    const target = await this.resolveCallbackTarget(merchantId, options.depositAddressId);
    if (!target) return;
    const id = newId();
    await this.repo.createWebhookEvent({ id, merchantId, depositAddressId: options.depositAddressId ?? null, type, url: target.url, secretEncrypted: target.secretEncrypted, payload: { id, type, createdAt: new Date().toISOString(), data } });
    void this.encryptor;
  }
  private async resolveCallbackTarget(merchantId: string, depositAddressId?: string): Promise<{ url: string; secretEncrypted: string } | null> {
    const config = await this.repo.getWebhookConfig(merchantId);
    if (depositAddressId) {
      const deposit = await this.repo.getDepositAddressForMerchant(merchantId, depositAddressId);
      if (deposit?.callbackUrl && deposit.callbackSecretEncrypted) return { url: deposit.callbackUrl, secretEncrypted: deposit.callbackSecretEncrypted };
      if (deposit?.callbackUrl && config?.active) return { url: deposit.callbackUrl, secretEncrypted: config.secretEncrypted };
    }
    return config?.active ? { url: config.url, secretEncrypted: config.secretEncrypted } : null;
  }
}
