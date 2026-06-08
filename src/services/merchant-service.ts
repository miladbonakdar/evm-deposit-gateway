import { assertEnabledToken, type SupportedNetworks } from "../config/networks.js";
import { notFound } from "../errors.js";
import type { Encryptor } from "../security/encryption.js";
import type { NetworkSlug, TokenSymbol } from "../types/domain.js";
import { normalizeAddress } from "../utils/address.js";
import { newId, newPublicApiKey, newSecret, newWebhookSecret } from "../utils/id.js";
import type { Repository } from "../repositories/repository.js";

export class MerchantService {
  constructor(
    private readonly repo: Repository,
    private readonly encryptor: Encryptor,
    private readonly networks: SupportedNetworks
  ) {}

  async createMerchant(name: string) {
    return this.repo.createMerchant({ id: newId(), name });
  }

  async getOrCreateOwnerMerchant(ownerMerchantId: string, ownerMerchantName: string) {
    const existing = await this.repo.getMerchant(ownerMerchantId);
    if (existing) {
      return existing;
    }

    return this.repo.createMerchant({ id: ownerMerchantId, name: ownerMerchantName });
  }

  async createApiKey(merchantId: string) {
    await this.requireMerchant(merchantId);
    const apiSecret = newSecret();
    const apiKey = await this.repo.createApiKey({
      id: newId(),
      merchantId,
      publicKey: newPublicApiKey(),
      secretEncrypted: this.encryptor.encryptString(apiSecret)
    });

    return {
      id: apiKey.id,
      merchantId,
      apiKey: apiKey.publicKey,
      apiSecret,
      createdAt: apiKey.createdAt.toISOString()
    };
  }

  async rotateApiKey(merchantId: string, apiKeyId: string) {
    await this.requireMerchant(merchantId);
    const apiSecret = newSecret();
    const updated = await this.repo.updateApiKeySecret(apiKeyId, this.encryptor.encryptString(apiSecret));

    if (!updated || updated.merchantId !== merchantId) {
      throw notFound("api_key_not_found", "API key was not found for this merchant");
    }

    return {
      id: updated.id,
      merchantId,
      apiKey: updated.publicKey,
      apiSecret
    };
  }

  async revokeApiKey(merchantId: string, apiKeyId: string) {
    await this.requireMerchant(merchantId);
    const updated = await this.repo.updateApiKeyStatus(apiKeyId, "revoked");

    if (!updated || updated.merchantId !== merchantId) {
      throw notFound("api_key_not_found", "API key was not found for this merchant");
    }

    return { id: updated.id, status: updated.status };
  }

  async configureWebhook(merchantId: string, url: string, secret: string | undefined, active: boolean) {
    await this.requireMerchant(merchantId);
    const webhookSecret = secret ?? newWebhookSecret();
    const config = await this.repo.upsertWebhookConfig({
      merchantId,
      url,
      active,
      secretEncrypted: this.encryptor.encryptString(webhookSecret)
    });

    return {
      merchantId,
      url: config.url,
      active: config.active,
      webhookSecret,
      updatedAt: config.updatedAt.toISOString()
    };
  }

  async configureTreasuryWallet(
    merchantId: string,
    network: NetworkSlug,
    token: TokenSymbol,
    addressInput: string
  ) {
    await this.requireMerchant(merchantId);
    const { network: networkConfig } = assertEnabledToken(this.networks, network, token);
    const address = normalizeAddress(networkConfig, addressInput);
    const wallet = await this.repo.upsertTreasuryWallet({
      id: newId(),
      merchantId,
      network,
      token,
      address
    });

    return {
      id: wallet.id,
      merchantId,
      network,
      token,
      address: wallet.address,
      updatedAt: wallet.updatedAt.toISOString()
    };
  }

  async requireMerchant(merchantId: string) {
    const merchant = await this.repo.getMerchant(merchantId);
    if (!merchant) {
      throw notFound("merchant_not_found", "Merchant was not found");
    }

    return merchant;
  }
}
