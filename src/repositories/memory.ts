import type {
  ApiKeyStatus,
  ChainAddress,
  ChainCursor,
  ChainTxHash,
  DepositAddress,
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
  ListTransfersFilter,
  ListTreasuryTransfersFilter,
  ListTreasuryWalletsFilter,
  MarkDepositAddressMatchedInput,
  Repository,
  UpdateMerchantSettingsInput,
  UpdateTransferSettlementInput,
  UpsertNotificationPreferencesInput,
  UpsertOperationalWalletInput,
  UpsertTreasuryWalletInput,
  UpsertWebhookConfigInput
} from "./repository.js";

function now(): Date {
  return new Date();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function assetKey(network: NetworkSlug, token: TokenSymbol): string {
  return `${network}:${token}`;
}

function addressKey(network: NetworkSlug, token: TokenSymbol, address: ChainAddress): string {
  return `${assetKey(network, token)}:${address.toLowerCase()}`;
}

function logKey(network: NetworkSlug, txHash: ChainTxHash, logIndex: number): string {
  return `${network}:${txHash.toLowerCase()}:${logIndex}`;
}

function gasScopeKey(network: NetworkSlug): string {
  return `gas:platform:${network}:native`;
}

function idempotencyKey(merchantId: string, route: string, key: string): string {
  return `${merchantId}:${route}:${key}`;
}

export class MemoryRepository implements Repository {
  private readonly merchants = new Map<string, Merchant>();
  private readonly apiKeys = new Map<string, MerchantApiKey>();
  private readonly apiKeysByPublicKey = new Map<string, string>();
  private readonly nonces = new Set<string>();
  private readonly webhookConfigs = new Map<string, WebhookConfig>();
  private readonly notificationPreferences = new Map<string, NotificationPreferences>();
  private readonly treasuryWallets = new Map<string, TreasuryWallet>();
  private readonly operationalWallets = new Map<string, OperationalWallet>();
  private readonly operationalWalletsByScope = new Map<string, string>();
  private readonly depositAddresses = new Map<string, DepositAddress>();
  private readonly depositAddressesByAddress = new Map<string, string>();
  private readonly chainCursors = new Map<string, ChainCursor>();
  private readonly tokenTransfers = new Map<string, TokenTransfer>();
  private readonly tokenTransfersByLog = new Map<string, string>();
  private readonly treasuryTransfers = new Map<string, TreasuryTransfer>();
  private readonly treasuryTransfersByLog = new Map<string, string>();
  private readonly gasTopUps = new Map<string, GasTopUp>();
  private readonly sweeps = new Map<string, Sweep>();
  private readonly walletTransactions = new Map<string, WalletTransaction>();
  private readonly webhookEvents = new Map<string, WebhookEvent>();
  private readonly idempotencyRecords = new Map<string, IdempotencyRecord>();

  async createMerchant(input: CreateMerchantInput): Promise<Merchant> {
    const timestamp = now();
    const merchant: Merchant = {
      id: input.id,
      name: input.name,
      status: "active",
      rejectDuplicateClientPendingDeposits: input.rejectDuplicateClientPendingDeposits ?? true,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.merchants.set(merchant.id, merchant);
    return clone(merchant);
  }

  async getMerchant(id: string): Promise<Merchant | null> {
    return clone(this.merchants.get(id) ?? null);
  }

  async listMerchants(limit: number): Promise<Merchant[]> {
    return clone([...this.merchants.values()].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()).slice(0, limit));
  }

  async updateMerchantSettings(merchantId: string, input: UpdateMerchantSettingsInput): Promise<Merchant | null> {
    const merchant = this.merchants.get(merchantId);
    if (!merchant) return null;
    merchant.rejectDuplicateClientPendingDeposits = input.rejectDuplicateClientPendingDeposits;
    merchant.updatedAt = now();
    return clone(merchant);
  }

  async createApiKey(input: CreateApiKeyInput): Promise<MerchantApiKey> {
    const timestamp = now();
    const apiKey: MerchantApiKey = {
      id: input.id,
      merchantId: input.merchantId,
      publicKey: input.publicKey,
      secretEncrypted: input.secretEncrypted,
      status: "active",
      createdAt: timestamp,
      lastUsedAt: null
    };
    this.apiKeys.set(apiKey.id, apiKey);
    this.apiKeysByPublicKey.set(apiKey.publicKey, apiKey.id);
    return clone(apiKey);
  }

  async getApiKeyByPublicKey(publicKey: string): Promise<MerchantApiKey | null> {
    const id = this.apiKeysByPublicKey.get(publicKey);
    return clone(id ? this.apiKeys.get(id) ?? null : null);
  }

  async listApiKeys(merchantId: string | undefined, limit: number): Promise<MerchantApiKey[]> {
    return clone([...this.apiKeys.values()].filter((apiKey) => !merchantId || apiKey.merchantId === merchantId).sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()).slice(0, limit));
  }

  async updateApiKeyLastUsed(id: string, usedAt: Date): Promise<void> {
    const apiKey = this.apiKeys.get(id);
    if (apiKey) apiKey.lastUsedAt = usedAt;
  }

  async updateApiKeySecret(id: string, secretEncrypted: string): Promise<MerchantApiKey | null> {
    const apiKey = this.apiKeys.get(id);
    if (!apiKey) return null;
    apiKey.secretEncrypted = secretEncrypted;
    return clone(apiKey);
  }

  async updateApiKeyStatus(id: string, status: ApiKeyStatus): Promise<MerchantApiKey | null> {
    const apiKey = this.apiKeys.get(id);
    if (!apiKey) return null;
    apiKey.status = status;
    return clone(apiKey);
  }

  async insertRequestNonce(apiKeyId: string, nonce: string, timestamp: Date): Promise<boolean> {
    const key = `${apiKeyId}:${nonce}`;
    if (this.nonces.has(key)) return false;
    this.nonces.add(key);
    void timestamp;
    return true;
  }

  async upsertWebhookConfig(input: UpsertWebhookConfigInput): Promise<WebhookConfig> {
    const existing = this.webhookConfigs.get(input.merchantId);
    const timestamp = now();
    const config: WebhookConfig = {
      merchantId: input.merchantId,
      url: input.url,
      secretEncrypted: input.secretEncrypted,
      active: input.active,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    this.webhookConfigs.set(input.merchantId, config);
    return clone(config);
  }

  async getWebhookConfig(merchantId: string): Promise<WebhookConfig | null> {
    return clone(this.webhookConfigs.get(merchantId) ?? null);
  }

  async listWebhookConfigs(limit: number): Promise<WebhookConfig[]> {
    return clone([...this.webhookConfigs.values()].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()).slice(0, limit));
  }

  async upsertNotificationPreferences(input: UpsertNotificationPreferencesInput): Promise<NotificationPreferences> {
    const existing = this.notificationPreferences.get(input.merchantId);
    const timestamp = now();
    const preferences: NotificationPreferences = {
      merchantId: input.merchantId,
      enabledEvents: [...new Set(input.enabledEvents)],
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    this.notificationPreferences.set(input.merchantId, preferences);
    return clone(preferences);
  }

  async getNotificationPreferences(merchantId: string): Promise<NotificationPreferences | null> {
    return clone(this.notificationPreferences.get(merchantId) ?? null);
  }

  async upsertTreasuryWallet(input: UpsertTreasuryWalletInput): Promise<TreasuryWallet> {
    const existing = [...this.treasuryWallets.values()].find((wallet) => wallet.merchantId === input.merchantId && wallet.network === input.network && wallet.token === input.token && wallet.address === input.address);
    const existingDefault = [...this.treasuryWallets.values()].find((wallet) => wallet.merchantId === input.merchantId && wallet.network === input.network && wallet.token === input.token && wallet.isDefault);
    const shouldBeDefault = input.isDefault === true || !existingDefault;
    const timestamp = now();

    if (shouldBeDefault) {
      for (const wallet of this.treasuryWallets.values()) {
        if (wallet.merchantId === input.merchantId && wallet.network === input.network && wallet.token === input.token) {
          wallet.isDefault = false;
          wallet.updatedAt = timestamp;
        }
      }
    }

    const wallet: TreasuryWallet = {
      id: existing?.id ?? input.id,
      merchantId: input.merchantId,
      network: input.network,
      token: input.token,
      address: input.address,
      label: input.label,
      isDefault: shouldBeDefault ? true : existing?.isDefault ?? false,
      operationalWalletId: input.operationalWalletId ?? existing?.operationalWalletId ?? null,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    this.treasuryWallets.set(wallet.id, wallet);
    return clone(wallet);
  }

  async getTreasuryWallet(merchantId: string, network: NetworkSlug, token: TokenSymbol): Promise<TreasuryWallet | null> {
    const matches = [...this.treasuryWallets.values()].filter((wallet) => wallet.merchantId === merchantId && wallet.network === network && wallet.token === token);
    return clone(matches.find((wallet) => wallet.isDefault) ?? matches[0] ?? null);
  }

  async getTreasuryWalletById(merchantId: string, id: string): Promise<TreasuryWallet | null> {
    const wallet = this.treasuryWallets.get(id);
    return clone(wallet && wallet.merchantId === merchantId ? wallet : null);
  }

  async listTreasuryWalletsByAddress(network: NetworkSlug, token: TokenSymbol, address: ChainAddress): Promise<TreasuryWallet[]> {
    return clone([...this.treasuryWallets.values()].filter((wallet) => wallet.network === network && wallet.token === token && wallet.address === address).sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id)));
  }

  async listTreasuryWallets(filter: ListTreasuryWalletsFilter): Promise<TreasuryWallet[]> {
    return clone([...this.treasuryWallets.values()].filter((wallet) => !filter.merchantId || wallet.merchantId === filter.merchantId).filter((wallet) => !filter.network || wallet.network === filter.network).filter((wallet) => !filter.token || wallet.token === filter.token).sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || right.updatedAt.getTime() - left.updatedAt.getTime()).slice(0, filter.limit));
  }

  async countActiveDirectDepositRequestsByTreasury(merchantId: string, network: NetworkSlug, token: TokenSymbol): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const address of this.depositAddresses.values()) {
      if (address.merchantId === merchantId && address.network === network && address.token === token && address.flow === "direct_treasury" && address.status === "active" && address.matchStatus === "pending" && address.treasuryWalletId) {
        counts.set(address.treasuryWalletId, (counts.get(address.treasuryWalletId) ?? 0) + 1);
      }
    }
    return counts;
  }

  async setDefaultTreasuryWallet(merchantId: string, id: string): Promise<TreasuryWallet | null> {
    const wallet = this.treasuryWallets.get(id);
    if (!wallet || wallet.merchantId !== merchantId) return null;
    const timestamp = now();
    for (const candidate of this.treasuryWallets.values()) {
      if (candidate.merchantId === merchantId && candidate.network === wallet.network && candidate.token === wallet.token) {
        candidate.isDefault = candidate.id === wallet.id;
        candidate.updatedAt = timestamp;
      }
    }
    return clone(this.treasuryWallets.get(id) ?? null);
  }

  async upsertOperationalWallet(input: UpsertOperationalWalletInput): Promise<OperationalWallet> {
    const existingId = this.operationalWalletsByScope.get(input.scopeKey);
    const existing = existingId ? this.operationalWallets.get(existingId) : undefined;
    const timestamp = now();
    const wallet: OperationalWallet = {
      id: existing?.id ?? input.id,
      scopeKey: input.scopeKey,
      merchantId: input.merchantId,
      purpose: input.purpose,
      network: input.network,
      token: input.token,
      address: input.address,
      privateKeyEncrypted: input.privateKeyEncrypted,
      label: input.label,
      status: "active",
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    this.operationalWallets.set(wallet.id, wallet);
    this.operationalWalletsByScope.set(wallet.scopeKey, wallet.id);
    return clone(wallet);
  }

  async getOperationalWallet(id: string): Promise<OperationalWallet | null> {
    return clone(this.operationalWallets.get(id) ?? null);
  }

  async getOperationalGasWallet(network: NetworkSlug): Promise<OperationalWallet | null> {
    const id = this.operationalWalletsByScope.get(gasScopeKey(network));
    return clone(id ? this.operationalWallets.get(id) ?? null : null);
  }

  async listOperationalWallets(filter: ListOperationalWalletsFilter): Promise<OperationalWallet[]> {
    return clone([...this.operationalWallets.values()].filter((wallet) => filter.includeDisabled || wallet.status === "active").filter((wallet) => !filter.merchantId || wallet.merchantId === filter.merchantId).filter((wallet) => !filter.purpose || wallet.purpose === filter.purpose).filter((wallet) => !filter.network || wallet.network === filter.network).filter((wallet) => !filter.token || wallet.token === filter.token).sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()).slice(0, filter.limit));
  }

  async createDepositAddress(input: CreateDepositAddressInput): Promise<DepositAddress> {
    const timestamp = now();
    const depositAddress: DepositAddress = {
      id: input.id,
      merchantId: input.merchantId,
      network: input.network,
      token: input.token,
      address: input.address,
      privateKeyEncrypted: input.privateKeyEncrypted,
      treasuryWalletId: input.treasuryWalletId,
      callbackUrl: input.callbackUrl,
      callbackSecretEncrypted: input.callbackSecretEncrypted,
      status: "active",
      flow: input.flow,
      clientId: input.clientId,
      requestedAmountRaw: input.requestedAmountRaw ?? null,
      requestedAmountFormatted: input.requestedAmountFormatted ?? null,
      receivedAmountRaw: input.receivedAmountRaw ?? null,
      receivedAmountFormatted: input.receivedAmountFormatted ?? null,
      matchStatus: input.matchStatus ?? null,
      matchedTransferId: input.matchedTransferId ?? null,
      matchSource: input.matchSource ?? null,
      matchedAt: input.matchedAt ?? null,
      expiresAt: input.expiresAt,
      externalId: input.externalId,
      metadata: input.metadata ?? {},
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.depositAddresses.set(depositAddress.id, depositAddress);
    if (depositAddress.flow === "temporary_wallet") {
      this.depositAddressesByAddress.set(addressKey(input.network, input.token, input.address), depositAddress.id);
    }
    return clone(depositAddress);
  }

  async getDepositAddressForMerchant(merchantId: string, id: string): Promise<DepositAddress | null> {
    const depositAddress = this.depositAddresses.get(id);
    return clone(depositAddress && depositAddress.merchantId === merchantId ? depositAddress : null);
  }

  async getActiveDepositAddressByClientId(merchantId: string, clientId: string): Promise<DepositAddress | null> {
    return clone([...this.depositAddresses.values()].filter((address) => address.merchantId === merchantId && address.clientId === clientId && address.status === "active").sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null);
  }

  async getDepositAddressByAddress(network: NetworkSlug, token: TokenSymbol, address: ChainAddress): Promise<DepositAddress | null> {
    const id = this.depositAddressesByAddress.get(addressKey(network, token, address));
    return clone(id ? this.depositAddresses.get(id) ?? null : null);
  }

  async listDepositAddresses(filter: ListDepositAddressesFilter): Promise<DepositAddress[]> {
    return clone([...this.depositAddresses.values()]
      .filter((address) => !filter.merchantId || address.merchantId === filter.merchantId)
      .filter((address) => !filter.status || address.status === filter.status)
      .filter((address) => !filter.flow || address.flow === filter.flow)
      .filter((address) => !filter.matchStatus || address.matchStatus === filter.matchStatus)
      .filter((address) => !filter.network || address.network === filter.network)
      .filter((address) => !filter.token || address.token === filter.token)
      .filter((address) => !filter.treasuryWalletId || address.treasuryWalletId === filter.treasuryWalletId)
      .filter((address) => !filter.clientId || address.clientId === filter.clientId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, filter.limit));
  }

  async markDepositAddressMatched(id: string, input: MarkDepositAddressMatchedInput): Promise<DepositAddress | null> {
    const depositAddress = this.depositAddresses.get(id);
    if (!depositAddress) return null;
    depositAddress.receivedAmountRaw = input.receivedAmountRaw;
    depositAddress.receivedAmountFormatted = input.receivedAmountFormatted;
    depositAddress.matchStatus = "matched";
    depositAddress.matchedTransferId = input.transferId;
    depositAddress.matchSource = input.matchSource;
    depositAddress.matchedAt = input.matchedAt;
    if (depositAddress.flow === "direct_treasury") depositAddress.status = "completed";
    depositAddress.updatedAt = input.matchedAt;
    return clone(depositAddress);
  }

  async closeDepositAddress(merchantId: string, id: string, closedAt: Date): Promise<DepositAddress | null> {
    const depositAddress = this.depositAddresses.get(id);
    if (!depositAddress || depositAddress.merchantId !== merchantId) return null;
    depositAddress.status = "closed";
    depositAddress.updatedAt = closedAt;
    return clone(depositAddress);
  }

  async expireDepositAddresses(currentTime: Date): Promise<DepositAddress[]> {
    const expired: DepositAddress[] = [];
    for (const depositAddress of this.depositAddresses.values()) {
      if (depositAddress.status === "active" && depositAddress.expiresAt <= currentTime) {
        depositAddress.status = "expired";
        depositAddress.updatedAt = currentTime;
        expired.push(depositAddress);
      }
    }
    return clone(expired);
  }

  async getChainCursor(network: NetworkSlug, token: TokenSymbol): Promise<ChainCursor | null> {
    return clone(this.chainCursors.get(assetKey(network, token)) ?? null);
  }

  async upsertChainCursor(network: NetworkSlug, token: TokenSymbol, lastScannedBlock: bigint): Promise<ChainCursor> {
    const cursor: ChainCursor = { network, token, lastScannedBlock, updatedAt: now() };
    this.chainCursors.set(assetKey(network, token), cursor);
    return clone(cursor);
  }

  async createTokenTransferIfNotExists(input: CreateTokenTransferInput): Promise<{ transfer: TokenTransfer; created: boolean }> {
    const key = logKey(input.network, input.txHash, input.logIndex);
    const existingId = this.tokenTransfersByLog.get(key);
    if (existingId) return { transfer: clone(this.tokenTransfers.get(existingId) as TokenTransfer), created: false };
    const timestamp = now();
    const transfer: TokenTransfer = {
      ...input,
      settlementStatus: "pending",
      settlementStep: null,
      settlementFailureReason: null,
      settlementUpdatedAt: timestamp,
      detectedAt: timestamp,
      confirmedAt: input.status === "confirmed" ? timestamp : null
    };
    this.tokenTransfers.set(transfer.id, transfer);
    this.tokenTransfersByLog.set(key, transfer.id);
    return { transfer: clone(transfer), created: true };
  }

  async getTokenTransfer(id: string): Promise<TokenTransfer | null> {
    return clone(this.tokenTransfers.get(id) ?? null);
  }

  async getTokenTransferByChainLog(network: NetworkSlug, txHash: ChainTxHash, logIndex: number): Promise<TokenTransfer | null> {
    const id = this.tokenTransfersByLog.get(logKey(network, txHash, logIndex));
    return clone(id ? this.tokenTransfers.get(id) ?? null : null);
  }

  async listTransfersForDepositAddress(depositAddressId: string): Promise<TokenTransfer[]> {
    return clone([...this.tokenTransfers.values()].filter((transfer) => transfer.depositAddressId === depositAddressId).sort((left, right) => Number(right.blockNumber - left.blockNumber)));
  }

  async listTransfersForMerchant(merchantId: string, filter: ListDepositsFilter): Promise<TokenTransfer[]> {
    return clone([...this.tokenTransfers.values()].filter((transfer) => transfer.merchantId === merchantId).filter((transfer) => !filter.status || transfer.status === filter.status).sort((left, right) => right.detectedAt.getTime() - left.detectedAt.getTime()).slice(0, filter.limit));
  }

  async listTokenTransfers(filter: ListTransfersFilter): Promise<TokenTransfer[]> {
    return clone([...this.tokenTransfers.values()].filter((transfer) => !filter.merchantId || transfer.merchantId === filter.merchantId).filter((transfer) => !filter.status || transfer.status === filter.status).sort((left, right) => right.detectedAt.getTime() - left.detectedAt.getTime()).slice(0, filter.limit));
  }

  async listTransfersReadyForConfirmation(network: NetworkSlug, token: TokenSymbol, maxBlockNumber: bigint): Promise<TokenTransfer[]> {
    return clone([...this.tokenTransfers.values()].filter((transfer) => transfer.network === network && transfer.token === token && transfer.status === "detected" && transfer.blockNumber <= maxBlockNumber).sort((left, right) => Number(left.blockNumber - right.blockNumber)).slice(0, 100));
  }

  async markTransferConfirmed(id: string, confirmations: number, confirmedAt: Date): Promise<TokenTransfer | null> {
    const transfer = this.tokenTransfers.get(id);
    if (!transfer) return null;
    transfer.status = "confirmed";
    transfer.confirmations = confirmations;
    transfer.confirmedAt = confirmedAt;
    return clone(transfer);
  }

  async updateTransferSettlement(id: string, input: UpdateTransferSettlementInput): Promise<TokenTransfer | null> {
    const transfer = this.tokenTransfers.get(id);
    if (!transfer) return null;
    transfer.settlementStatus = input.settlementStatus;
    transfer.settlementStep = input.settlementStep ?? null;
    transfer.settlementFailureReason = input.settlementFailureReason ?? null;
    transfer.settlementUpdatedAt = now();
    return clone(transfer);
  }

  async createTreasuryTransferIfNotExists(input: CreateTreasuryTransferInput): Promise<{ transfer: TreasuryTransfer; created: boolean }> {
    const key = logKey(input.network, input.txHash, input.logIndex);
    const existingId = this.treasuryTransfersByLog.get(key);
    if (existingId) return { transfer: clone(this.treasuryTransfers.get(existingId) as TreasuryTransfer), created: false };
    const timestamp = now();
    const transfer: TreasuryTransfer = {
      ...input,
      candidateDepositAddressIds: [...input.candidateDepositAddressIds],
      matchedDepositAddressId: null,
      matchSource: null,
      detectedAt: timestamp,
      matchedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.treasuryTransfers.set(transfer.id, transfer);
    this.treasuryTransfersByLog.set(key, transfer.id);
    return { transfer: clone(transfer), created: true };
  }

  async getTreasuryTransfer(id: string): Promise<TreasuryTransfer | null> {
    return clone(this.treasuryTransfers.get(id) ?? null);
  }

  async listTreasuryTransfers(filter: ListTreasuryTransfersFilter): Promise<TreasuryTransfer[]> {
    return clone([...this.treasuryTransfers.values()].filter((transfer) => !filter.merchantId || transfer.merchantId === filter.merchantId).filter((transfer) => !filter.status || transfer.status === filter.status).filter((transfer) => !filter.network || transfer.network === filter.network).filter((transfer) => !filter.token || transfer.token === filter.token).sort((left, right) => right.detectedAt.getTime() - left.detectedAt.getTime()).slice(0, filter.limit));
  }

  async updateTreasuryTransferStatus(id: string, status: TreasuryTransferStatus, matchedDepositAddressId: string | null = null, matchSource = null, matchedAt: Date | null = null): Promise<TreasuryTransfer | null> {
    const transfer = this.treasuryTransfers.get(id);
    if (!transfer) return null;
    transfer.status = status;
    transfer.matchedDepositAddressId = matchedDepositAddressId;
    transfer.matchSource = matchSource;
    transfer.matchedAt = matchedAt;
    transfer.updatedAt = matchedAt ?? now();
    return clone(transfer);
  }

  async getSweepByTxHash(network: NetworkSlug, token: TokenSymbol, txHash: ChainTxHash): Promise<Sweep | null> {
    return clone([...this.sweeps.values()].find((sweep) => sweep.network === network && sweep.token === token && sweep.txHash === txHash) ?? null);
  }

  async getLatestGasTopUpByTransfer(transferId: string): Promise<GasTopUp | null> {
    return clone([...this.gasTopUps.values()].filter((topUp) => topUp.transferId === transferId).sort((left, right) => right.attemptNumber - left.attemptNumber)[0] ?? null);
  }

  async createGasTopUp(input: CreateGasTopUpInput): Promise<GasTopUp> {
    const topUp: GasTopUp = { ...input, failureReason: input.failureReason ?? null, createdAt: now(), confirmedAt: input.status === "confirmed" ? now() : null };
    this.gasTopUps.set(topUp.id, topUp);
    return clone(topUp);
  }

  async listSubmittedGasTopUps(limit: number): Promise<GasTopUp[]> {
    return clone([...this.gasTopUps.values()].filter((topUp) => topUp.status === "submitted").sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime()).slice(0, limit));
  }

  async listGasTopUps(limit: number): Promise<GasTopUp[]> {
    return clone([...this.gasTopUps.values()].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.attemptNumber - left.attemptNumber).slice(0, limit));
  }

  async updateGasTopUpStatus(id: string, status: TransactionStatus, txHash: ChainTxHash | null, failureReason?: string | null): Promise<GasTopUp | null> {
    const topUp = this.gasTopUps.get(id);
    if (!topUp) return null;
    topUp.status = status;
    topUp.txHash = txHash;
    topUp.failureReason = failureReason ?? null;
    topUp.confirmedAt = status === "confirmed" ? now() : null;
    return clone(topUp);
  }

  async getLatestSweepByTransfer(transferId: string): Promise<Sweep | null> {
    return clone([...this.sweeps.values()].filter((sweep) => sweep.transferId === transferId).sort((left, right) => right.attemptNumber - left.attemptNumber)[0] ?? null);
  }

  async createSweep(input: CreateSweepInput): Promise<Sweep> {
    const sweep: Sweep = { ...input, failureReason: input.failureReason ?? null, createdAt: now(), confirmedAt: input.status === "confirmed" ? now() : null };
    this.sweeps.set(sweep.id, sweep);
    return clone(sweep);
  }

  async listSubmittedSweeps(limit: number): Promise<Sweep[]> {
    return clone([...this.sweeps.values()].filter((sweep) => sweep.status === "submitted").sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime()).slice(0, limit));
  }

  async listSweeps(limit: number): Promise<Sweep[]> {
    return clone([...this.sweeps.values()].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.attemptNumber - left.attemptNumber).slice(0, limit));
  }

  async updateSweepStatus(id: string, status: TransactionStatus, txHash: ChainTxHash | null, failureReason?: string | null): Promise<Sweep | null> {
    const sweep = this.sweeps.get(id);
    if (!sweep) return null;
    sweep.status = status;
    sweep.txHash = txHash;
    sweep.failureReason = failureReason ?? null;
    sweep.confirmedAt = status === "confirmed" ? now() : null;
    return clone(sweep);
  }

  async createWalletTransaction(input: CreateWalletTransactionInput): Promise<WalletTransaction> {
    const transaction: WalletTransaction = { ...input, failureReason: input.failureReason ?? null, createdAt: now(), confirmedAt: input.status === "confirmed" ? now() : null };
    this.walletTransactions.set(transaction.id, transaction);
    return clone(transaction);
  }

  async listWalletTransactions(limit: number): Promise<WalletTransaction[]> {
    return clone([...this.walletTransactions.values()].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()).slice(0, limit));
  }

  async listSubmittedWalletTransactions(limit: number): Promise<WalletTransaction[]> {
    return clone([...this.walletTransactions.values()].filter((transaction) => transaction.status === "submitted").sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime()).slice(0, limit));
  }

  async updateWalletTransactionStatus(id: string, status: TransactionStatus, txHash: ChainTxHash | null, failureReason?: string | null): Promise<WalletTransaction | null> {
    const transaction = this.walletTransactions.get(id);
    if (!transaction) return null;
    transaction.status = status;
    transaction.txHash = txHash;
    transaction.failureReason = failureReason ?? null;
    transaction.confirmedAt = status === "confirmed" ? now() : null;
    return clone(transaction);
  }

  async createWebhookEvent(input: CreateWebhookEventInput): Promise<WebhookEvent> {
    const timestamp = now();
    const event: WebhookEvent = {
      id: input.id,
      merchantId: input.merchantId,
      depositAddressId: input.depositAddressId ?? null,
      type: input.type,
      url: input.url,
      secretEncrypted: input.secretEncrypted,
      payload: input.payload,
      status: "pending",
      attempts: 0,
      nextAttemptAt: timestamp,
      lastError: null,
      responseStatus: null,
      sentAt: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.webhookEvents.set(event.id, event);
    return clone(event);
  }

  async listDueWebhookEvents(currentTime: Date, limit: number): Promise<WebhookEvent[]> {
    return clone([...this.webhookEvents.values()].filter((event) => event.status === "pending" && event.nextAttemptAt <= currentTime).sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime()).slice(0, limit));
  }

  async listWebhookEvents(limit: number): Promise<WebhookEvent[]> {
    return clone([...this.webhookEvents.values()].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()).slice(0, limit));
  }

  async markWebhookSent(id: string, responseStatus: number, sentAt: Date): Promise<WebhookEvent | null> {
    const event = this.webhookEvents.get(id);
    if (!event) return null;
    event.status = "sent";
    event.attempts += 1;
    event.responseStatus = responseStatus;
    event.sentAt = sentAt;
    event.updatedAt = sentAt;
    return clone(event);
  }

  async markWebhookRetry(id: string, attempts: number, status: "pending" | "failed", nextAttemptAt: Date, error: string, responseStatus: number | null): Promise<WebhookEvent | null> {
    const event = this.webhookEvents.get(id);
    if (!event) return null;
    event.attempts = attempts;
    event.status = status;
    event.nextAttemptAt = nextAttemptAt;
    event.lastError = error;
    event.responseStatus = responseStatus;
    event.updatedAt = now();
    return clone(event);
  }

  async getIdempotencyRecord(merchantId: string, route: string, key: string): Promise<IdempotencyRecord | null> {
    return clone(this.idempotencyRecords.get(idempotencyKey(merchantId, route, key)) ?? null);
  }

  async createIdempotencyRecord(input: CreateIdempotencyInput): Promise<IdempotencyRecord> {
    const record: IdempotencyRecord = { ...input, createdAt: now() };
    this.idempotencyRecords.set(idempotencyKey(input.merchantId, input.route, input.key), record);
    return clone(record);
  }
}
