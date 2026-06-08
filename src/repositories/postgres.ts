import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import {
  chainCursors,
  depositAddresses,
  gasTopUps,
  idempotencyKeys,
  merchantApiKeys,
  merchants,
  notificationPreferences,
  operationalWallets,
  requestNonces,
  sweeps,
  tokenTransfers,
  treasuryTransfers,
  treasuryWallets,
  walletTransactions,
  webhookConfigs,
  webhookEvents
} from "../db/schema.js";
import type {
  ApiKeyStatus,
  ChainAddress,
  ChainTxHash,
  ChainCursor,
  DepositAddress,
  DepositMatchSource,
  GasTopUp,
  IdempotencyRecord,
  Merchant,
  MerchantApiKey,
  NetworkSlug,
  NotificationPreferences,
  OperationalWallet,
  Sweep,
  TokenSymbol,
  TokenTransfer,
  TransactionStatus,
  TreasuryTransfer,
  TreasuryTransferStatus,
  TreasuryWallet,
  WebhookConfig,
  WebhookEvent,
  WalletTransaction
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
  CreateTreasuryTransferInput,
  CreateWebhookEventInput,
  CreateWalletTransactionInput,
  ListDepositAddressesFilter,
  ListDepositsFilter,
  ListOperationalWalletsFilter,
  ListTreasuryTransfersFilter,
  ListTreasuryWalletsFilter,
  ListTransfersFilter,
  MarkDepositAddressMatchedInput,
  Repository,
  UpdateMerchantSettingsInput,
  UpdateTransferSettlementInput,
  UpsertNotificationPreferencesInput,
  UpsertOperationalWalletInput,
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

function mapNotificationPreferences(row: typeof notificationPreferences.$inferSelect): NotificationPreferences {
  return {
    merchantId: row.merchantId,
    enabledEvents: Array.isArray(row.enabledEvents)
      ? (row.enabledEvents as NotificationPreferences["enabledEvents"])
      : [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapTreasuryWallet(row: typeof treasuryWallets.$inferSelect): TreasuryWallet {
  return {
    ...row,
    network: row.network as NetworkSlug,
    token: row.token as TokenSymbol,
    address: row.address,
    operationalWalletId: row.operationalWalletId
  };
}

function mapOperationalWallet(row: typeof operationalWallets.$inferSelect): OperationalWallet {
  return {
    ...row,
    merchantId: row.merchantId,
    purpose: row.purpose as OperationalWallet["purpose"],
    network: row.network as NetworkSlug,
    token: row.token as TokenSymbol | null,
    status: row.status as OperationalWallet["status"]
  };
}

function mapDepositAddress(row: typeof depositAddresses.$inferSelect): DepositAddress {
  return {
    ...row,
    network: row.network as NetworkSlug,
    token: row.token as TokenSymbol,
    address: row.address,
    treasuryWalletId: row.treasuryWalletId,
    callbackUrl: row.callbackUrl,
    callbackSecretEncrypted: row.callbackSecretEncrypted,
    status: row.status as DepositAddress["status"],
    flow: row.flow as DepositAddress["flow"],
    matchStatus: row.matchStatus as DepositAddress["matchStatus"],
    matchSource: row.matchSource as DepositAddress["matchSource"],
    metadata: row.metadata
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
    txHash: row.txHash,
    fromAddress: row.fromAddress,
    toAddress: row.toAddress,
    blockHash: row.blockHash,
    status: row.status as TokenTransfer["status"],
    settlementStatus: row.settlementStatus as TokenTransfer["settlementStatus"],
    settlementStep: row.settlementStep as TokenTransfer["settlementStep"],
    settlementFailureReason: row.settlementFailureReason
  };
}

function mapTreasuryTransfer(row: typeof treasuryTransfers.$inferSelect): TreasuryTransfer {
  return {
    ...row,
    network: row.network as NetworkSlug,
    token: row.token as TokenSymbol,
    txHash: row.txHash,
    fromAddress: row.fromAddress,
    toAddress: row.toAddress,
    blockHash: row.blockHash,
    status: row.status as TreasuryTransferStatus,
    candidateDepositAddressIds: Array.isArray(row.candidateDepositAddressIds)
      ? (row.candidateDepositAddressIds as string[])
      : [],
    matchSource: row.matchSource as DepositMatchSource | null
  };
}

function mapGasTopUp(row: typeof gasTopUps.$inferSelect): GasTopUp {
  return { ...row, network: row.network as NetworkSlug, txHash: row.txHash, status: row.status as TransactionStatus };
}

function mapSweep(row: typeof sweeps.$inferSelect): Sweep {
  return {
    ...row,
    network: row.network as NetworkSlug,
    token: row.token as TokenSymbol,
    txHash: row.txHash,
    toAddress: row.toAddress,
    status: row.status as TransactionStatus
  };
}

function mapWalletTransaction(row: typeof walletTransactions.$inferSelect): WalletTransaction {
  return {
    ...row,
    merchantId: row.merchantId,
    network: row.network as NetworkSlug,
    token: row.token as TokenSymbol | null,
    asset: row.asset as WalletTransaction["asset"],
    txHash: row.txHash,
    fromAddress: row.fromAddress,
    toAddress: row.toAddress,
    status: row.status as TransactionStatus
  };
}

function mapWebhookEvent(row: typeof webhookEvents.$inferSelect): WebhookEvent {
  return {
    ...row,
    depositAddressId: row.depositAddressId,
    type: row.type as WebhookEvent["type"],
    status: row.status as WebhookEvent["status"],
    payload: row.payload as Record<string, unknown>
  };
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

  async listMerchants(limit: number): Promise<Merchant[]> {
    const rows = await this.db.select().from(merchants).orderBy(desc(merchants.createdAt)).limit(limit);
    return rows.map(mapMerchant);
  }

  async updateMerchantSettings(merchantId: string, input: UpdateMerchantSettingsInput): Promise<Merchant | null> {
    const rows = await this.db
      .update(merchants)
      .set({ rejectDuplicateClientPendingDeposits: input.rejectDuplicateClientPendingDeposits, updatedAt: new Date() })
      .where(eq(merchants.id, merchantId))
      .returning();
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

  async listApiKeys(merchantId: string | undefined, limit: number): Promise<MerchantApiKey[]> {
    const rows = await this.db
      .select()
      .from(merchantApiKeys)
      .where(merchantId ? eq(merchantApiKeys.merchantId, merchantId) : undefined)
      .orderBy(desc(merchantApiKeys.createdAt))
      .limit(limit);
    return rows.map(mapApiKey);
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

  async listWebhookConfigs(limit: number): Promise<WebhookConfig[]> {
    const rows = await this.db.select().from(webhookConfigs).orderBy(desc(webhookConfigs.updatedAt)).limit(limit);
    return rows.map(mapWebhookConfig);
  }

  async upsertNotificationPreferences(
    input: UpsertNotificationPreferencesInput
  ): Promise<NotificationPreferences> {
    const enabledEvents = [...new Set(input.enabledEvents)];
    const rows = await this.db
      .insert(notificationPreferences)
      .values({ merchantId: input.merchantId, enabledEvents })
      .onConflictDoUpdate({
        target: notificationPreferences.merchantId,
        set: { enabledEvents, updatedAt: new Date() }
      })
      .returning();
    return mapNotificationPreferences(rows[0] as typeof notificationPreferences.$inferSelect);
  }

  async getNotificationPreferences(merchantId: string): Promise<NotificationPreferences | null> {
    const rows = await this.db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.merchantId, merchantId))
      .limit(1);
    const row = first(rows);
    return row ? mapNotificationPreferences(row) : null;
  }

  async upsertTreasuryWallet(input: UpsertTreasuryWalletInput): Promise<TreasuryWallet> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const existingRows = await tx
        .select()
        .from(treasuryWallets)
        .where(
          and(
            eq(treasuryWallets.merchantId, input.merchantId),
            eq(treasuryWallets.network, input.network),
            eq(treasuryWallets.token, input.token),
            eq(treasuryWallets.address, input.address)
          )
        )
        .limit(1);
      const existing = first(existingRows);
      const defaultRows = await tx
        .select()
        .from(treasuryWallets)
        .where(
          and(
            eq(treasuryWallets.merchantId, input.merchantId),
            eq(treasuryWallets.network, input.network),
            eq(treasuryWallets.token, input.token),
            eq(treasuryWallets.isDefault, true)
          )
        )
        .limit(1);
      const shouldBeDefault = input.isDefault === true || defaultRows.length === 0;

      if (shouldBeDefault) {
        await tx
          .update(treasuryWallets)
          .set({ isDefault: false, updatedAt: now })
          .where(
            and(
              eq(treasuryWallets.merchantId, input.merchantId),
              eq(treasuryWallets.network, input.network),
              eq(treasuryWallets.token, input.token)
            )
          );
      }

      if (existing) {
        const rows = await tx
          .update(treasuryWallets)
          .set({
            label: input.label,
            operationalWalletId: input.operationalWalletId ?? existing.operationalWalletId,
            isDefault: shouldBeDefault ? true : existing.isDefault,
            updatedAt: now
          })
          .where(eq(treasuryWallets.id, existing.id))
          .returning();
        return mapTreasuryWallet(rows[0] as typeof treasuryWallets.$inferSelect);
      }

      const rows = await tx
        .insert(treasuryWallets)
        .values({
          ...input,
          isDefault: shouldBeDefault,
          operationalWalletId: input.operationalWalletId ?? null
        })
        .returning();
      return mapTreasuryWallet(rows[0] as typeof treasuryWallets.$inferSelect);
    });
  }

  async getTreasuryWallet(merchantId: string, network: NetworkSlug, token: TokenSymbol): Promise<TreasuryWallet | null> {
    const rows = await this.db
      .select()
      .from(treasuryWallets)
      .where(
        and(
          eq(treasuryWallets.merchantId, merchantId),
          eq(treasuryWallets.network, network),
          eq(treasuryWallets.token, token),
          eq(treasuryWallets.isDefault, true)
        )
      )
      .limit(1);
    const row = first(rows);
    if (row) {
      return mapTreasuryWallet(row);
    }

    const fallbackRows = await this.db
      .select()
      .from(treasuryWallets)
      .where(and(eq(treasuryWallets.merchantId, merchantId), eq(treasuryWallets.network, network), eq(treasuryWallets.token, token)))
      .orderBy(desc(treasuryWallets.updatedAt))
      .limit(1);
    const fallback = first(fallbackRows);
    return fallback ? mapTreasuryWallet(fallback) : null;
  }

  async getTreasuryWalletById(merchantId: string, id: string): Promise<TreasuryWallet | null> {
    const rows = await this.db
      .select()
      .from(treasuryWallets)
      .where(and(eq(treasuryWallets.merchantId, merchantId), eq(treasuryWallets.id, id)))
      .limit(1);
    const row = first(rows);
    return row ? mapTreasuryWallet(row) : null;
  }

  async listTreasuryWalletsByAddress(
    network: NetworkSlug,
    token: TokenSymbol,
    address: ChainAddress
  ): Promise<TreasuryWallet[]> {
    const rows = await this.db
      .select()
      .from(treasuryWallets)
      .where(and(eq(treasuryWallets.network, network), eq(treasuryWallets.token, token), eq(treasuryWallets.address, address)))
      .orderBy(desc(treasuryWallets.updatedAt));
    return rows.map(mapTreasuryWallet);
  }

  async listTreasuryWallets(filter: ListTreasuryWalletsFilter): Promise<TreasuryWallet[]> {
    const conditions = [
      filter.merchantId ? eq(treasuryWallets.merchantId, filter.merchantId) : undefined,
      filter.network ? eq(treasuryWallets.network, filter.network) : undefined,
      filter.token ? eq(treasuryWallets.token, filter.token) : undefined
    ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));
    const rows = await this.db
      .select()
      .from(treasuryWallets)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(treasuryWallets.isDefault), desc(treasuryWallets.updatedAt))
      .limit(filter.limit);
    return rows.map(mapTreasuryWallet);
  }

  async countActiveDirectDepositRequestsByTreasury(
    merchantId: string,
    network: NetworkSlug,
    token: TokenSymbol
  ): Promise<Map<string, number>> {
    const rows = await this.db
      .select({
        treasuryWalletId: depositAddresses.treasuryWalletId,
        count: sql<number>`count(*)::int`
      })
      .from(depositAddresses)
      .where(
        and(
          eq(depositAddresses.merchantId, merchantId),
          eq(depositAddresses.network, network),
          eq(depositAddresses.token, token),
          eq(depositAddresses.flow, "direct_treasury"),
          eq(depositAddresses.status, "active")
        )
      )
      .groupBy(depositAddresses.treasuryWalletId);
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (row.treasuryWalletId) counts.set(row.treasuryWalletId, Number(row.count));
    }
    return counts;
  }

  async setDefaultTreasuryWallet(merchantId: string, id: string): Promise<TreasuryWallet | null> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(treasuryWallets)
        .where(and(eq(treasuryWallets.merchantId, merchantId), eq(treasuryWallets.id, id)))
        .limit(1);
      const wallet = first(rows);
      if (!wallet) {
        return null;
      }

      const now = new Date();
      await tx
        .update(treasuryWallets)
        .set({ isDefault: false, updatedAt: now })
        .where(
          and(
            eq(treasuryWallets.merchantId, wallet.merchantId),
            eq(treasuryWallets.network, wallet.network),
            eq(treasuryWallets.token, wallet.token)
          )
        );

      const updated = await tx
        .update(treasuryWallets)
        .set({ isDefault: true, updatedAt: now })
        .where(eq(treasuryWallets.id, wallet.id))
        .returning();
      return mapTreasuryWallet(updated[0] as typeof treasuryWallets.$inferSelect);
    });
  }

  async upsertOperationalWallet(input: UpsertOperationalWalletInput): Promise<OperationalWallet> {
    const rows = await this.db
      .insert(operationalWallets)
      .values(input)
      .onConflictDoUpdate({
        target: operationalWallets.scopeKey,
        set: {
          merchantId: input.merchantId,
          purpose: input.purpose,
          network: input.network,
          token: input.token,
          address: input.address,
          privateKeyEncrypted: input.privateKeyEncrypted,
          label: input.label,
          status: "active",
          updatedAt: new Date()
        }
      })
      .returning();
    return mapOperationalWallet(rows[0] as typeof operationalWallets.$inferSelect);
  }

  async getOperationalWallet(id: string): Promise<OperationalWallet | null> {
    const rows = await this.db.select().from(operationalWallets).where(eq(operationalWallets.id, id)).limit(1);
    const row = first(rows);
    return row ? mapOperationalWallet(row) : null;
  }

  async getOperationalGasWallet(network: NetworkSlug): Promise<OperationalWallet | null> {
    const rows = await this.db
      .select()
      .from(operationalWallets)
      .where(and(eq(operationalWallets.scopeKey, `gas:platform:${network}:native`), eq(operationalWallets.status, "active")))
      .limit(1);
    const row = first(rows);
    return row ? mapOperationalWallet(row) : null;
  }

  async listOperationalWallets(filter: ListOperationalWalletsFilter): Promise<OperationalWallet[]> {
    const conditions = [
      filter.includeDisabled ? undefined : eq(operationalWallets.status, "active"),
      filter.merchantId ? eq(operationalWallets.merchantId, filter.merchantId) : undefined,
      filter.purpose ? eq(operationalWallets.purpose, filter.purpose) : undefined,
      filter.network ? eq(operationalWallets.network, filter.network) : undefined,
      filter.token ? eq(operationalWallets.token, filter.token) : undefined
    ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));
    const rows = await this.db
      .select()
      .from(operationalWallets)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(operationalWallets.updatedAt))
      .limit(filter.limit);
    return rows.map(mapOperationalWallet);
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

  async getActiveDepositAddressByClientId(merchantId: string, clientId: string): Promise<DepositAddress | null> {
    const rows = await this.db
      .select()
      .from(depositAddresses)
      .where(
        and(
          eq(depositAddresses.merchantId, merchantId),
          eq(depositAddresses.clientId, clientId),
          eq(depositAddresses.status, "active")
        )
      )
      .orderBy(desc(depositAddresses.createdAt))
      .limit(1);
    const row = first(rows);
    return row ? mapDepositAddress(row) : null;
  }

  async getDepositAddressByAddress(
    network: NetworkSlug,
    token: TokenSymbol,
    address: ChainAddress
  ): Promise<DepositAddress | null> {
    const rows = await this.db
      .select()
      .from(depositAddresses)
      .where(
        and(
          eq(depositAddresses.network, network),
          eq(depositAddresses.token, token),
          eq(depositAddresses.address, address)
        )
      )
      .limit(1);
    const row = first(rows);
    return row ? mapDepositAddress(row) : null;
  }

  async listDepositAddresses(filter: ListDepositAddressesFilter): Promise<DepositAddress[]> {
    const conditions = [
      filter.merchantId ? eq(depositAddresses.merchantId, filter.merchantId) : undefined,
      filter.status ? eq(depositAddresses.status, filter.status) : undefined,
      filter.flow ? eq(depositAddresses.flow, filter.flow) : undefined,
      filter.matchStatus ? eq(depositAddresses.matchStatus, filter.matchStatus) : undefined,
      filter.network ? eq(depositAddresses.network, filter.network) : undefined,
      filter.token ? eq(depositAddresses.token, filter.token) : undefined,
      filter.treasuryWalletId ? eq(depositAddresses.treasuryWalletId, filter.treasuryWalletId) : undefined,
      filter.clientId ? eq(depositAddresses.clientId, filter.clientId) : undefined
    ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));
    const rows = await this.db
      .select()
      .from(depositAddresses)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(depositAddresses.createdAt))
      .limit(filter.limit);
    return rows.map(mapDepositAddress);
  }

  async markDepositAddressMatched(
    id: string,
    input: MarkDepositAddressMatchedInput
  ): Promise<DepositAddress | null> {
    const rows = await this.db
      .update(depositAddresses)
      .set({
        status: "completed",
        matchStatus: "matched",
        matchedTransferId: input.transferId,
        receivedAmountRaw: input.receivedAmountRaw,
        receivedAmountFormatted: input.receivedAmountFormatted,
        matchSource: input.matchSource,
        matchedAt: input.matchedAt,
        updatedAt: input.matchedAt
      })
      .where(eq(depositAddresses.id, id))
      .returning();
    const row = first(rows);
    return row ? mapDepositAddress(row) : null;
  }

  async closeDepositAddress(merchantId: string, id: string, closedAt: Date): Promise<DepositAddress | null> {
    const rows = await this.db
      .update(depositAddresses)
      .set({ status: "closed", updatedAt: closedAt })
      .where(and(eq(depositAddresses.merchantId, merchantId), eq(depositAddresses.id, id), eq(depositAddresses.status, "active")))
      .returning();
    const row = first(rows);
    return row ? mapDepositAddress(row) : null;
  }

  async expireDepositAddresses(now: Date): Promise<DepositAddress[]> {
    const rows = await this.db
      .update(depositAddresses)
      .set({ status: "expired", updatedAt: now })
      .where(and(eq(depositAddresses.status, "active"), lte(depositAddresses.expiresAt, now)))
      .returning();
    return rows.map(mapDepositAddress);
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

  async getTokenTransferByChainLog(
    network: NetworkSlug,
    txHash: ChainTxHash,
    logIndex: number
  ): Promise<TokenTransfer | null> {
    const rows = await this.db
      .select()
      .from(tokenTransfers)
      .where(and(eq(tokenTransfers.network, network), eq(tokenTransfers.txHash, txHash), eq(tokenTransfers.logIndex, logIndex)))
      .limit(1);
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

  async listTokenTransfers(filter: ListTransfersFilter): Promise<TokenTransfer[]> {
    const conditions = [
      filter.merchantId ? eq(tokenTransfers.merchantId, filter.merchantId) : undefined,
      filter.status ? eq(tokenTransfers.status, filter.status) : undefined
    ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));
    const rows = await this.db
      .select()
      .from(tokenTransfers)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
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

  async updateTransferSettlement(
    id: string,
    input: UpdateTransferSettlementInput
  ): Promise<TokenTransfer | null> {
    const rows = await this.db
      .update(tokenTransfers)
      .set({
        settlementStatus: input.settlementStatus,
        settlementStep: input.settlementStep ?? null,
        settlementFailureReason: input.settlementFailureReason ?? null,
        settlementUpdatedAt: new Date()
      })
      .where(eq(tokenTransfers.id, id))
      .returning();
    const row = first(rows);
    return row ? mapTransfer(row) : null;
  }

  async createTreasuryTransferIfNotExists(
    input: CreateTreasuryTransferInput
  ): Promise<{ transfer: TreasuryTransfer; created: boolean }> {
    const rows = await this.db
      .insert(treasuryTransfers)
      .values(input)
      .onConflictDoNothing()
      .returning();
    const inserted = first(rows);

    if (inserted) {
      return { transfer: mapTreasuryTransfer(inserted), created: true };
    }

    const existing = await this.db
      .select()
      .from(treasuryTransfers)
      .where(
        and(
          eq(treasuryTransfers.network, input.network),
          eq(treasuryTransfers.txHash, input.txHash),
          eq(treasuryTransfers.logIndex, input.logIndex)
        )
      )
      .limit(1);
    return { transfer: mapTreasuryTransfer(existing[0] as typeof treasuryTransfers.$inferSelect), created: false };
  }

  async getTreasuryTransfer(id: string): Promise<TreasuryTransfer | null> {
    const rows = await this.db.select().from(treasuryTransfers).where(eq(treasuryTransfers.id, id)).limit(1);
    const row = first(rows);
    return row ? mapTreasuryTransfer(row) : null;
  }

  async listTreasuryTransfers(filter: ListTreasuryTransfersFilter): Promise<TreasuryTransfer[]> {
    const conditions = [
      filter.merchantId ? eq(treasuryTransfers.merchantId, filter.merchantId) : undefined,
      filter.status ? eq(treasuryTransfers.status, filter.status) : undefined,
      filter.network ? eq(treasuryTransfers.network, filter.network) : undefined,
      filter.token ? eq(treasuryTransfers.token, filter.token) : undefined
    ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));
    const rows = await this.db
      .select()
      .from(treasuryTransfers)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(treasuryTransfers.detectedAt))
      .limit(filter.limit);
    return rows.map(mapTreasuryTransfer);
  }

  async updateTreasuryTransferStatus(
    id: string,
    status: TreasuryTransferStatus,
    matchedDepositAddressId: string | null = null,
    matchSource: DepositMatchSource | null = null,
    matchedAt: Date | null = null
  ): Promise<TreasuryTransfer | null> {
    const rows = await this.db
      .update(treasuryTransfers)
      .set({ status, matchedDepositAddressId, matchSource, matchedAt, updatedAt: new Date() })
      .where(eq(treasuryTransfers.id, id))
      .returning();
    const row = first(rows);
    return row ? mapTreasuryTransfer(row) : null;
  }

  async getLatestGasTopUpByTransfer(transferId: string): Promise<GasTopUp | null> {
    const rows = await this.db
      .select()
      .from(gasTopUps)
      .where(eq(gasTopUps.transferId, transferId))
      .orderBy(desc(gasTopUps.attemptNumber))
      .limit(1);
    const row = first(rows);
    return row ? mapGasTopUp(row) : null;
  }

  async createGasTopUp(input: CreateGasTopUpInput): Promise<GasTopUp> {
    const rows = await this.db
      .insert(gasTopUps)
      .values({ ...input, failureReason: input.failureReason ?? null })
      .returning();
    return mapGasTopUp(rows[0] as typeof gasTopUps.$inferSelect);
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

  async listGasTopUps(limit: number): Promise<GasTopUp[]> {
    const rows = await this.db.select().from(gasTopUps).orderBy(desc(gasTopUps.createdAt), desc(gasTopUps.attemptNumber)).limit(limit);
    return rows.map(mapGasTopUp);
  }

  async updateGasTopUpStatus(
    id: string,
    status: TransactionStatus,
    txHash: ChainTxHash | null,
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

  async getSweepByTxHash(network: NetworkSlug, token: TokenSymbol, txHash: ChainTxHash): Promise<Sweep | null> {
    const rows = await this.db
      .select()
      .from(sweeps)
      .where(and(eq(sweeps.network, network), eq(sweeps.token, token), eq(sweeps.txHash, txHash)))
      .limit(1);
    const row = first(rows);
    return row ? mapSweep(row) : null;
  }

  async getLatestSweepByTransfer(transferId: string): Promise<Sweep | null> {
    const rows = await this.db
      .select()
      .from(sweeps)
      .where(eq(sweeps.transferId, transferId))
      .orderBy(desc(sweeps.attemptNumber))
      .limit(1);
    const row = first(rows);
    return row ? mapSweep(row) : null;
  }

  async createSweep(input: CreateSweepInput): Promise<Sweep> {
    const rows = await this.db
      .insert(sweeps)
      .values({ ...input, failureReason: input.failureReason ?? null })
      .returning();
    return mapSweep(rows[0] as typeof sweeps.$inferSelect);
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

  async listSweeps(limit: number): Promise<Sweep[]> {
    const rows = await this.db.select().from(sweeps).orderBy(desc(sweeps.createdAt), desc(sweeps.attemptNumber)).limit(limit);
    return rows.map(mapSweep);
  }

  async updateSweepStatus(
    id: string,
    status: TransactionStatus,
    txHash: ChainTxHash | null,
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

  async createWalletTransaction(input: CreateWalletTransactionInput): Promise<WalletTransaction> {
    const rows = await this.db
      .insert(walletTransactions)
      .values({ ...input, failureReason: input.failureReason ?? null })
      .returning();
    return mapWalletTransaction(rows[0] as typeof walletTransactions.$inferSelect);
  }

  async listWalletTransactions(limit: number): Promise<WalletTransaction[]> {
    const rows = await this.db.select().from(walletTransactions).orderBy(desc(walletTransactions.createdAt)).limit(limit);
    return rows.map(mapWalletTransaction);
  }

  async listSubmittedWalletTransactions(limit: number): Promise<WalletTransaction[]> {
    const rows = await this.db
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.status, "submitted"))
      .orderBy(asc(walletTransactions.createdAt))
      .limit(limit);
    return rows.map(mapWalletTransaction);
  }

  async updateWalletTransactionStatus(
    id: string,
    status: TransactionStatus,
    txHash: ChainTxHash | null,
    failureReason?: string | null
  ): Promise<WalletTransaction | null> {
    const rows = await this.db
      .update(walletTransactions)
      .set({
        status,
        txHash,
        failureReason: failureReason ?? null,
        confirmedAt: status === "confirmed" ? new Date() : null
      })
      .where(eq(walletTransactions.id, id))
      .returning();
    const row = first(rows);
    return row ? mapWalletTransaction(row) : null;
  }

  async createWebhookEvent(input: CreateWebhookEventInput): Promise<WebhookEvent> {
    const rows = await this.db.insert(webhookEvents).values({ ...input, depositAddressId: input.depositAddressId ?? null }).returning();
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

  async listWebhookEvents(limit: number): Promise<WebhookEvent[]> {
    const rows = await this.db.select().from(webhookEvents).orderBy(desc(webhookEvents.createdAt)).limit(limit);
    return rows.map(mapWebhookEvent);
  }

  async markWebhookSent(id: string, responseStatus: number, sentAt: Date): Promise<WebhookEvent | null> {
    const rows = await this.db
      .update(webhookEvents)
      .set({ status: "sent", attempts: sql`${webhookEvents.attempts} + 1`, responseStatus, sentAt, updatedAt: sentAt })
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
