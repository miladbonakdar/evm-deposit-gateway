import { assertEnabledToken, type SupportedNetworks } from "../config/networks.js";
import { conflict, notFound, unprocessable } from "../errors.js";
import type { Encryptor } from "../security/encryption.js";
import type { DepositAddress, NetworkSlug, TokenSymbol, TokenTransfer } from "../types/domain.js";
import { normalizeAddress } from "../utils/address.js";
import { buildQrResult, type QrFormat } from "../utils/qr.js";
import { newId } from "../utils/id.js";
import { generateChainWallet } from "../utils/wallet.js";
import type { Repository } from "../repositories/repository.js";
import type { WebhookService } from "./webhook-service.js";

export interface CreateDepositAddressInput {
  merchantId: string;
  network: NetworkSlug;
  token: TokenSymbol;
  treasuryWalletId?: string;
  callbackUrl: string;
  callbackSecret: string;
  ttlSeconds?: number;
  externalId?: string;
  metadata?: unknown;
  qrFormat?: QrFormat;
}

export class DepositService {
  constructor(
    private readonly repo: Repository,
    private readonly encryptor: Encryptor,
    private readonly networks: SupportedNetworks,
    private readonly webhooks: WebhookService
  ) {}

  async createDepositAddress(input: CreateDepositAddressInput) {
    const { network: networkConfig } = assertEnabledToken(this.networks, input.network, input.token);

    const treasury = input.treasuryWalletId
      ? await this.repo.getTreasuryWalletById(input.merchantId, input.treasuryWalletId)
      : await this.repo.getTreasuryWallet(input.merchantId, input.network, input.token);
    if (!treasury) {
      throw unprocessable(
        "treasury_wallet_missing",
        `Treasury wallet must be configured before creating ${input.token} deposit addresses on ${input.network}`
      );
    }
    if (treasury.network !== input.network || treasury.token !== input.token) {
      throw unprocessable(
        "treasury_wallet_mismatch",
        "Treasury wallet must match the requested network and token"
      );
    }

    const wallet = await generateChainWallet(networkConfig.kind);
    const ttlSeconds = input.ttlSeconds ?? 86_400;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const depositAddress = await this.repo.createDepositAddress({
      id: newId(),
      merchantId: input.merchantId,
      network: input.network,
      token: input.token,
      address: normalizeAddress(networkConfig, wallet.address),
      privateKeyEncrypted: this.encryptor.encryptString(wallet.privateKey),
      treasuryWalletId: treasury.id,
      callbackUrl: input.callbackUrl,
      callbackSecretEncrypted: this.encryptor.encryptString(input.callbackSecret),
      expiresAt,
      externalId: input.externalId ?? null,
      metadata: input.metadata ?? {}
    });

    await this.webhooks.enqueueMerchantEvent(
      input.merchantId,
      "wallet.created",
      {
        depositAddress: publicDepositAddress(depositAddress),
        treasuryWallet: treasury.address,
        treasuryWalletId: treasury.id
      },
      { depositAddressId: depositAddress.id }
    );

    return {
      ...publicDepositAddress(depositAddress),
      qr: await buildQrResult(depositAddress.address, input.qrFormat ?? "none")
    };
  }

  async getDepositAddress(merchantId: string, id: string) {
    const depositAddress = await this.repo.getDepositAddressForMerchant(merchantId, id);
    if (!depositAddress) {
      throw notFound("deposit_address_not_found", "Deposit address was not found");
    }

    const transfers = await this.repo.listTransfersForDepositAddress(depositAddress.id);

    return {
      ...publicDepositAddress(depositAddress),
      transfers: transfers.map(publicTransfer)
    };
  }

  async listDeposits(merchantId: string, status: TokenTransfer["status"] | undefined, limit: number) {
    const transfers = await this.repo.listTransfersForMerchant(merchantId, { status, limit });
    return { deposits: transfers.map(publicTransfer) };
  }

  async listTreasuryWallets(
    merchantId: string,
    network: NetworkSlug | undefined,
    token: TokenSymbol | undefined,
    limit: number
  ) {
    const wallets = await this.repo.listTreasuryWallets({ merchantId, network, token, limit });
    return { treasuryWallets: wallets.map(publicTreasuryWallet) };
  }

  async assertIdempotency(
    merchantId: string,
    route: string,
    key: string | undefined,
    requestHash: string
  ): Promise<{ replay: boolean; response?: unknown; status?: number }> {
    if (!key) {
      return { replay: false };
    }

    const existing = await this.repo.getIdempotencyRecord(merchantId, route, key);
    if (!existing) {
      return { replay: false };
    }

    if (existing.requestHash !== requestHash) {
      throw conflict("idempotency_key_conflict", "Idempotency key was reused with a different request body");
    }

    return { replay: true, response: existing.responseBody, status: existing.responseStatus };
  }

  async storeIdempotency(
    merchantId: string,
    route: string,
    key: string | undefined,
    requestHash: string,
    responseStatus: number,
    responseBody: unknown
  ): Promise<void> {
    if (!key) {
      return;
    }

    await this.repo.createIdempotencyRecord({
      id: newId(),
      merchantId,
      route,
      key,
      requestHash,
      responseStatus,
      responseBody
    });
  }
}

export function publicDepositAddress(depositAddress: DepositAddress) {
  return {
    id: depositAddress.id,
    merchantId: depositAddress.merchantId,
    network: depositAddress.network,
    token: depositAddress.token,
    address: depositAddress.address,
    treasuryWalletId: depositAddress.treasuryWalletId,
    callbackUrl: depositAddress.callbackUrl,
    status: depositAddress.status,
    expiresAt: depositAddress.expiresAt.toISOString(),
    externalId: depositAddress.externalId,
    metadata: depositAddress.metadata,
    createdAt: depositAddress.createdAt.toISOString()
  };
}

export function publicTransfer(transfer: TokenTransfer) {
  return {
    id: transfer.id,
    merchantId: transfer.merchantId,
    depositAddressId: transfer.depositAddressId,
    network: transfer.network,
    token: transfer.token,
    txHash: transfer.txHash,
    logIndex: transfer.logIndex,
    fromAddress: transfer.fromAddress,
    toAddress: transfer.toAddress,
    amountRaw: transfer.amountRaw,
    amountFormatted: transfer.amountFormatted,
    blockNumber: transfer.blockNumber.toString(10),
    confirmations: transfer.confirmations,
    status: transfer.status,
    settlementStatus: transfer.settlementStatus,
    settlementStep: transfer.settlementStep,
    settlementFailureReason: transfer.settlementFailureReason,
    settlementUpdatedAt: transfer.settlementUpdatedAt.toISOString(),
    detectedAt: transfer.detectedAt.toISOString(),
    confirmedAt: transfer.confirmedAt?.toISOString() ?? null
  };
}

export function publicTreasuryWallet(wallet: {
  id: string;
  merchantId: string;
  network: NetworkSlug;
  token: TokenSymbol;
  address: string;
  label: string;
  isDefault: boolean;
  operationalWalletId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: wallet.id,
    merchantId: wallet.merchantId,
    network: wallet.network,
    token: wallet.token,
    address: wallet.address,
    label: wallet.label,
    isDefault: wallet.isDefault,
    operationalWalletId: wallet.operationalWalletId,
    createdAt: wallet.createdAt.toISOString(),
    updatedAt: wallet.updatedAt.toISOString()
  };
}
