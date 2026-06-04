import { and, asc, desc, eq, lte } from "drizzle-orm";
import type { Address, Hex } from "viem";
import {
  chainCursors,
  depositAddresses,
  gasTopUps,
  idempotencyKeys,
  merchantApiKeys,
  merchants,
  requestNonces,
  sweeps,
  tokenTransfers,
  treasuryWallets,
  webhookConfigs,
  webhookEvents
} from "../db/schema.js";
import type {
  ApiKeyStatus,
  ChainCursor,
  DepositAddress,
  GasTopUp,
  IdempotencyRecord,
  Merchant,
  MerchantApiKey,
  NetworkSlug,
  Sweep,
  TokenSymbol,
  TokenTransfer,
  TransactionStatus,
  TreasuryWallet,
  WebhookConfig,
  WebhookEvent
} from "../types/domain.js";
import type { Db } from "../db/client.js";
import type {
  CreateApiKeyInput,
  CreateDepositAddressInput,
  CreateGasTopUpInput,
  CreateIdempotencyInput,
  CreateMerchantInput,
  CreateSweepInput,
  CreateTokenTransferInput,
  CreateWebhookEventInput,
  ListDepositsFilter,
  Repository,
  UpsertTreasuryWalletInput,
  UpsertWebhookConfigInput
} from "./repository.js";

function first<T>(rows: T[]): T | null {
  return rows[0] ?? null;
}

function mapMerchant(row: typeof merchants.$inferSelect): Merchant {
  return row as Merchant;
}

function mapApiKey(row: typeof merchantApiKeys.$inferSelect): MerchantApiKey {
  return row as MerchantApiKey;
}

function mapWebhookConfig(row: typeof webhookConfigs.$inferSelect): WebhookConfig {
  return row as WebhookConfig;
}

function mapTreasuryWallet(row: typeof treasuryWallets.$inferSelect): TreasuryWallet {
  return { ...row, network: row.network as NetworkSlug, token: row.token as TokenSymbol, address: row.address as Address };
}

function mapDepositAddress(row: typeof depositAddresses.$inferSelect): DepositAddress {
  return {
    ...row,
    network: row.network as NetworkSlug,
    token: row.token as TokenSymbol,
    address: row.address as Address,
    status: row.status as DepositAddress["status"]
  };
}

function mapCursor(row: typeof chainCursors.$inferSelect): ChainCursor {
  return { ...row, network: row.network as NetworkSlug, token: row.token as TokenSymbol };
}

function mapTransfer(row: typeof tokenTransfers.$inferSelect): TokenTransfer {
  return {
    ...row,
    network: row.network as NetworkSlug,
    token: row.token as TokenSymbol,
    txHash: row.txHash as Hex,
    fromAddress: row.fromAddress as Address,
    toAddress: row.toAddress as Address,
    blockHash: row.blockHash as Hex | null,
    status: row.status as TokenTransfer["status"]
  };
}

function mapGasTopUp(row: typeof gasTopUps.$inferSelect): GasTopUp {
  return { ...row, network: row.network as NetworkSlug, txHash: row.txHash as Hex | null, status: row.status as TransactionStatus };
}

function mapSweep(row: typeof sweeps.$inferSelect): Sweep {
  return {
    ...row,
    network: row.network as NetworkSlug,
    token: row.token as TokenSymbol,
    txHash: row.txHash as Hex | null,
    toAddress: row.toAddress as Address,
    status: row.status as TransactionStatus
  };
}

function mapWebhookEvent(row: typeof webhookEvents.$inferSelect): WebhookEvent {
  return { ...row, type: row.type as WebhookEvent["type"], status: row.status as WebhookEvent["status"], payload: row.payload as Record<string, unknown> };
}

function mapIdempotency(row: typeof idempotencyKeys.$inferSelect): IdempotencyRecord {
  return row as IdempotencyRecord;
}

export class PostgresRepository implements Repository {
  constructor(private readonly db: Db) {}

  async createMerchant(input: CreateMerchantInput): Promise<Merchant> {
    const rows = await this.db.insert(merchants).values(input).returning();
    return mapMerchant(rows[0] as typeof merchants.$inferSelect);
  }

  async getMerchant(id: string): Promise<Merchant | null> {
    const rows = await this.db.select().from(merchants).where(eq(merchants.id, id)).limit(1);
    const row = first(rows);
    return row ? mapMerchant(row) : null;
  }

  async createApiKey(input: CreateApiKeyInput): Promise<MerchantApiKey> {
    const rows = await this.db.insert(merchantApiKeys).values(input).returning();
    return mapApiKey(rows[0] as typeof merchantApiKeys.$inferSelect);
  }

  async getApiKeyByPublicKey(publicKey: string): Promise<MerchantApiKey | null> {
    const rows = await this.db.select().from(merchantApiKeys).where(eq(merchantApiKeys.publicKey, publicKey)).limit(1);
    const row = first(rows);
    return row ? mapApiKey(row) : null;
  }

  async updateApiKeyLastUsed(id: string, usedAt: Date): Promise<void> {
    await this.db.update(merchantApiKeys).set({ lastUsedAt: usedAt }).where(eq(merchantApiKeys.id, id));
  }

  async updateApiKeySecret(id: string, secretEncrypted: string): Promise<MerchantApiKey | null> {
    const rows = await this.db
      .update(merchantApiKeys)
      .set({ secretEncrypted })
      .where(eq(merchantApiKeys.id, id))
      .returning();
    const row = first(rows);
    return row ? mapApiKey(row) : null;
  }

  async updateApiKeyStatus(id: string, status: ApiKeyStatus): Promise<MerchantApiKey | null> {
    const rows = await this.db.update(merchantApiKeys).set({ status }).where(eq(merchantApiKeys.id, id)).returning();
    const row = first(rows);
    return row ? mapApiKey(row) : null;
  }

  async insertRequestNonce(apiKeyId: string, nonce: string, timestamp: Date): Promise<boolean> {
    const rows = await this.db
      .insert(requestNonces)
      .values({ apiKeyId, nonce, timestamp })
      .onConflictDoNothing()
      .returning();
    return rows.length > 0;
  }

  async upsertWebhookConfig(input: UpsertWebhookConfigInput): Promise<WebhookConfig> {
    const rows = await this.db
      .insert(webhookConfigs)
      .values(input)
      .onConflictDoUpdate({
        target: webhookConfigs.merchantId,
        set: {
          url: input.url,
          secretEncrypted: input.secretEncrypted,
          active: input.active,
          updatedAt: new Date()
        }
      })
      .returning();
    return mapWebhookConfig(rows[0] as typeof webhookConfigs.$inferSelect);
  }

  async getWebhookConfig(merchantId: string): Promise<WebhookConfig | null> {
    const rows = await this.db.select().from(webhookConfigs).where(eq(webhookConfigs.merchantId, merchantId)).limit(1);
    const row = first(rows);
    return row ? mapWebhookConfig(row) : null;
  }

  async upsertTreasuryWallet(input: UpsertTreasuryWalletInput): Promise<TreasuryWallet> {
    const rows = await this.db
      .insert(treasuryWallets)
      .values(input)
      .onConflictDoUpdate({
        target: [treasuryWallets.merchantId, treasuryWallets.network, treasuryWallets.token],
        set: { address: input.address, updatedAt: new Date() }
      })
      .returning();
    return mapTreasuryWallet(rows[0] as typeof treasuryWallets.$inferSelect);
  }

  async getTreasuryWallet(merchantId: string, network: NetworkSlug, token: TokenSymbol): Promise<TreasuryWallet | null> {
    const rows = await this.db
      .select()
      .from(treasuryWallets)
      .where(and(eq(treasuryWallets.merchantId, merchantId), eq(treasuryWallets.network, network), eq(treasuryWallets.token, token)))
      .limit(1);
    const row = first(rows);
    return row ? mapTreasuryWallet(row) : null;
  }

  async createDepositAddress(input: CreateDepositAddressInput): Promise<DepositAddress> {
    const rows = await this.db.insert(depositAddresses).values(input).returning();
    return mapDepositAddress(rows[0] as typeof depositAddresses.$inferSelect);
  }

  async getDepositAddressForMerchant(merchantId: string, id: string): Promise<DepositAddress | null> {
    const rows = await this.db
      .select()
      .from(depositAddresses)
      .where(and(eq(depositAddresses.merchantId, merchantId), eq(depositAddresses.id, id)))
      .limit(1);
    const row = first(rows);
    return row ? mapDepositAddress(row) : null;
  }

  async getDepositAddressByAddress(
    network: NetworkSlug,
    token: TokenSymbol,
    address: Address
  ): Promise<DepositAddress | null> {
    const rows = await this.db
      .select()
      .from(depositAddresses)
      .where(
        and(
          eq(depositAddresses.network, network),
          eq(depositAddresses.token, token),
          eq(depositAddresses.address, address.toLowerCase())
        )
      )
      .limit(1);
    const row = first(rows);
    return row ? mapDepositAddress(row) : null;
  }

  async expireDepositAddresses(now: Date): Promise<number> {
    const rows = await this.db
      .update(depositAddresses)
      .set({ status: "expired", updatedAt: now })
      .where(and(eq(depositAddresses.status, "active"), lte(depositAddresses.expiresAt, now)))
      .returning({ id: depositAddresses.id });
    return rows.length;
  }

  async getChainCursor(network: NetworkSlug, token: TokenSymbol): Promise<ChainCursor | null> {
    const rows = await this.db
      .select()
      .from(chainCursors)
      .where(and(eq(chainCursors.network, network), eq(chainCursors.token, token)))
      .limit(1);
    const row = first(rows);
    return row ? mapCursor(row) : null;
  }

  async upsertChainCursor(network: NetworkSlug, token: TokenSymbol, lastScannedBlock: bigint): Promise<ChainCursor> {
    const rows = await this.db
      .insert(chainCursors)
      .values({ network, token, lastScannedBlock })
      .onConflictDoUpdate({
        target: [chainCursors.network, chainCursors.token],
        set: { lastScannedBlock, updatedAt: new Date() }
      })
      .returning();
    return mapCursor(rows[0] as typeof chainCursors.$inferSelect);
  }

  async createTokenTransferIfNotExists(
    input: CreateTokenTransferInput
  ): Promise<{ transfer: TokenTransfer; created: boolean }> {
    const rows = await this.db
      .insert(tokenTransfers)
      .values({
        ...input,
        detectedAt: new Date(),
        confirmedAt: input.status === "confirmed" ? new Date() : null
      })
      .onConflictDoNothing()
      .returning();
    const inserted = first(rows);

    if (inserted) {
      return { transfer: mapTransfer(inserted), created: true };
    }

    const existing = await this.db
      .select()
      .from(tokenTransfers)
      .where(
        and(eq(tokenTransfers.network, input.network), eq(tokenTransfers.txHash, input.txHash), eq(tokenTransfers.logIndex, input.logIndex))
      )
      .limit(1);
    return { transfer: mapTransfer(existing[0] as typeof tokenTransfers.$inferSelect), created: false };
  }

  async getTokenTransfer(id: string): Promise<TokenTransfer | null> {
    const rows = await this.db.select().from(tokenTransfers).where(eq(tokenTransfers.id, id)).limit(1);
    const row = first(rows);
    return row ? mapTransfer(row) : null;
  }

  async listTransfersForDepositAddress(depositAddressId: string): Promise<TokenTransfer[]> {
    const rows = await this.db
      .select()
      .from(tokenTransfers)
      .where(eq(tokenTransfers.depositAddressId, depositAddressId))
      .orderBy(desc(tokenTransfers.blockNumber));
    return rows.map(mapTransfer);
  }

  async listTransfersForMerchant(merchantId: string, filter: ListDepositsFilter): Promise<TokenTransfer[]> {
    const where = filter.status
      ? and(eq(tokenTransfers.merchantId, merchantId), eq(tokenTransfers.status, filter.status))
      : eq(tokenTransfers.merchantId, merchantId);
    const rows = await this.db
      .select()
      .from(tokenTransfers)
      .where(where)
      .orderBy(desc(tokenTransfers.detectedAt))
      .limit(filter.limit);
    return rows.map(mapTransfer);
  }

  async listTransfersReadyForConfirmation(
    network: NetworkSlug,
    token: TokenSymbol,
    maxBlockNumber: bigint
  ): Promise<TokenTransfer[]> {
    const rows = await this.db
      .select()
      .from(tokenTransfers)
      .where(
        and(
          eq(tokenTransfers.network, network),
          eq(tokenTransfers.token, token),
          eq(tokenTransfers.status, "detected"),
          lte(tokenTransfers.blockNumber, maxBlockNumber)
        )
      )
      .orderBy(asc(tokenTransfers.blockNumber))
      .limit(100);
    return rows.map(mapTransfer);
  }

  async markTransferConfirmed(id: string, confirmations: number, confirmedAt: Date): Promise<TokenTransfer | null> {
    const rows = await this.db
      .update(tokenTransfers)
      .set({ status: "confirmed", confirmations, confirmedAt })
      .where(eq(tokenTransfers.id, id))
      .returning();
    const row = first(rows);
    return row ? mapTransfer(row) : null;
  }

  async getGasTopUpByTransfer(transferId: string): Promise<GasTopUp | null> {
    const rows = await this.db.select().from(gasTopUps).where(eq(gasTopUps.transferId, transferId)).limit(1);
    const row = first(rows);
    return row ? mapGasTopUp(row) : null;
  }

  async createGasTopUpIfNotExists(input: CreateGasTopUpInput): Promise<{ gasTopUp: GasTopUp; created: boolean }> {
    const rows = await this.db
      .insert(gasTopUps)
      .values({ ...input, failureReason: input.failureReason ?? null })
      .onConflictDoNothing()
      .returning();
    const inserted = first(rows);
    if (inserted) {
      return { gasTopUp: mapGasTopUp(inserted), created: true };
    }

    const existing = await this.db.select().from(gasTopUps).where(eq(gasTopUps.transferId, input.transferId)).limit(1);
    return { gasTopUp: mapGasTopUp(existing[0] as typeof gasTopUps.$inferSelect), created: false };
  }

  async listSubmittedGasTopUps(limit: number): Promise<GasTopUp[]> {
    const rows = await this.db
      .select()
      .from(gasTopUps)
      .where(eq(gasTopUps.status, "submitted"))
      .orderBy(asc(gasTopUps.createdAt))
      .limit(limit);
    return rows.map(mapGasTopUp);
  }

  async updateGasTopUpStatus(
    id: string,
    status: TransactionStatus,
    txHash: Hex | null,
    failureReason?: string | null
  ): Promise<GasTopUp | null> {
    const rows = await this.db
      .update(gasTopUps)
      .set({
        status,
        txHash,
        failureReason: failureReason ?? null,
        confirmedAt: status === "confirmed" ? new Date() : null
      })
      .where(eq(gasTopUps.id, id))
      .returning();
    const row = first(rows);
    return row ? mapGasTopUp(row) : null;
  }

  async getSweepByTransfer(transferId: string): Promise<Sweep | null> {
    const rows = await this.db.select().from(sweeps).where(eq(sweeps.transferId, transferId)).limit(1);
    const row = first(rows);
    return row ? mapSweep(row) : null;
  }

  async createSweepIfNotExists(input: CreateSweepInput): Promise<{ sweep: Sweep; created: boolean }> {
    const rows = await this.db
      .insert(sweeps)
      .values({ ...input, failureReason: input.failureReason ?? null })
      .onConflictDoNothing()
      .returning();
    const inserted = first(rows);
    if (inserted) {
      return { sweep: mapSweep(inserted), created: true };
    }

    const existing = await this.db.select().from(sweeps).where(eq(sweeps.transferId, input.transferId)).limit(1);
    return { sweep: mapSweep(existing[0] as typeof sweeps.$inferSelect), created: false };
  }

  async listSubmittedSweeps(limit: number): Promise<Sweep[]> {
    const rows = await this.db
      .select()
      .from(sweeps)
      .where(eq(sweeps.status, "submitted"))
      .orderBy(asc(sweeps.createdAt))
      .limit(limit);
    return rows.map(mapSweep);
  }

  async updateSweepStatus(
    id: string,
    status: TransactionStatus,
    txHash: Hex | null,
    failureReason?: string | null
  ): Promise<Sweep | null> {
    const rows = await this.db
      .update(sweeps)
      .set({
        status,
        txHash,
        failureReason: failureReason ?? null,
        confirmedAt: status === "confirmed" ? new Date() : null
      })
      .where(eq(sweeps.id, id))
      .returning();
    const row = first(rows);
    return row ? mapSweep(row) : null;
  }

  async createWebhookEvent(input: CreateWebhookEventInput): Promise<WebhookEvent> {
    const rows = await this.db.insert(webhookEvents).values(input).returning();
    return mapWebhookEvent(rows[0] as typeof webhookEvents.$inferSelect);
  }

  async listDueWebhookEvents(now: Date, limit: number): Promise<WebhookEvent[]> {
    const rows = await this.db
      .select()
      .from(webhookEvents)
      .where(and(eq(webhookEvents.status, "pending"), lte(webhookEvents.nextAttemptAt, now)))
      .orderBy(asc(webhookEvents.createdAt))
      .limit(limit);
    return rows.map(mapWebhookEvent);
  }

  async markWebhookSent(id: string, responseStatus: number, sentAt: Date): Promise<WebhookEvent | null> {
    const rows = await this.db
      .update(webhookEvents)
      .set({ status: "sent", responseStatus, sentAt, updatedAt: sentAt })
      .where(eq(webhookEvents.id, id))
      .returning();
    const row = first(rows);
    return row ? mapWebhookEvent(row) : null;
  }

  async markWebhookRetry(
    id: string,
    attempts: number,
    status: "pending" | "failed",
    nextAttemptAt: Date,
    error: string,
    responseStatus: number | null
  ): Promise<WebhookEvent | null> {
    const rows = await this.db
      .update(webhookEvents)
      .set({ attempts, status, nextAttemptAt, lastError: error, responseStatus, updatedAt: new Date() })
      .where(eq(webhookEvents.id, id))
      .returning();
    const row = first(rows);
    return row ? mapWebhookEvent(row) : null;
  }

  async getIdempotencyRecord(merchantId: string, route: string, key: string): Promise<IdempotencyRecord | null> {
    const rows = await this.db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.merchantId, merchantId), eq(idempotencyKeys.route, route), eq(idempotencyKeys.key, key)))
      .limit(1);
    const row = first(rows);
    return row ? mapIdempotency(row) : null;
  }

  async createIdempotencyRecord(input: CreateIdempotencyInput): Promise<IdempotencyRecord> {
    const rows = await this.db.insert(idempotencyKeys).values(input).returning();
    return mapIdempotency(rows[0] as typeof idempotencyKeys.$inferSelect);
  }
}
