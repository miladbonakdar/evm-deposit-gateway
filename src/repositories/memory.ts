import type {
  ApiKeyStatus,
  ChainAddress,
  ChainCursor,
  DepositAddress,
  GasTopUp,
  IdempotencyRecord,
  Merchant,
  MerchantApiKey,
  NetworkSlug,
  OperationalWallet,
  OperationalWalletPurpose,
  Sweep,
  TokenSymbol,
  TokenTransfer,
  TransactionStatus,
  TreasuryWallet,
  TransferStatus,
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
  CreateWebhookEventInput,
  CreateWalletTransactionInput,
  ListDepositAddressesFilter,
  ListDepositsFilter,
  ListOperationalWalletsFilter,
  ListTransfersFilter,
  Repository,
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
  return `${assetKey(network, token)}:${address}`;
}

function operationalWalletScopeKey(
  purpose: OperationalWalletPurpose,
  merchantId: string | null,
  network: NetworkSlug,
  token: TokenSymbol | null
): string {
  return [purpose, merchantId ?? "platform", network, token ?? "native"].join(":");
}

export class MemoryRepository implements Repository {
  private readonly merchants = new Map<string, Merchant>();
  private readonly apiKeys = new Map<string, MerchantApiKey>();
  private readonly apiKeysByPublicKey = new Map<string, string>();
  private readonly nonces = new Set<string>();
  private readonly webhookConfigs = new Map<string, WebhookConfig>();
  private readonly treasuryWallets = new Map<string, TreasuryWallet>();
  private readonly operationalWallets = new Map<string, OperationalWallet>();
  private readonly operationalWalletsByScope = new Map<string, string>();
  private readonly depositAddresses = new Map<string, DepositAddress>();
  private readonly depositAddressesByAddress = new Map<string, string>();
  private readonly chainCursors = new Map<string, ChainCursor>();
  private readonly tokenTransfers = new Map<string, TokenTransfer>();
  private readonly tokenTransfersByLog = new Map<string, string>();
  private readonly gasTopUps = new Map<string, GasTopUp>();
  private readonly gasTopUpsByTransfer = new Map<string, string>();
  private readonly sweeps = new Map<string, Sweep>();
  private readonly sweepsByTransfer = new Map<string, string>();
  private readonly walletTransactions = new Map<string, WalletTransaction>();
  private readonly webhookEvents = new Map<string, WebhookEvent>();
  private readonly idempotencyRecords = new Map<string, IdempotencyRecord>();

  async createMerchant(input: CreateMerchantInput): Promise<Merchant> {
    const timestamp = now();
    const merchant: Merchant = {
      id: input.id,
      name: input.name,
      status: "active",
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
    return clone(
      [...this.merchants.values()]
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        .slice(0, limit)
    );
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
    return clone(id ? (this.apiKeys.get(id) ?? null) : null);
  }

  async updateApiKeyLastUsed(id: string, usedAt: Date): Promise<void> {
    const apiKey = this.apiKeys.get(id);
    if (apiKey) {
      apiKey.lastUsedAt = usedAt;
    }
  }

  async updateApiKeySecret(id: string, secretEncrypted: string): Promise<MerchantApiKey | null> {
    const apiKey = this.apiKeys.get(id);
    if (!apiKey) {
      return null;
    }
    apiKey.secretEncrypted = secretEncrypted;
    return clone(apiKey);
  }

  async updateApiKeyStatus(id: string, status: ApiKeyStatus): Promise<MerchantApiKey | null> {
    const apiKey = this.apiKeys.get(id);
    if (!apiKey) {
      return null;
    }
    apiKey.status = status;
    return clone(apiKey);
  }

  async insertRequestNonce(apiKeyId: string, nonce: string, timestamp: Date): Promise<boolean> {
    const key = `${apiKeyId}:${nonce}`;
    if (this.nonces.has(key)) {
      return false;
    }
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

  async upsertTreasuryWallet(input: UpsertTreasuryWalletInput): Promise<TreasuryWallet> {
    const key = `${input.merchantId}:${assetKey(input.network, input.token)}`;
    const existing = this.treasuryWallets.get(key);
    const timestamp = now();
    const wallet: TreasuryWallet = {
      id: existing?.id ?? input.id,
      merchantId: input.merchantId,
      network: input.network,
      token: input.token,
      address: input.address,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    this.treasuryWallets.set(key, wallet);
    return clone(wallet);
  }

  async getTreasuryWallet(merchantId: string, network: NetworkSlug, token: TokenSymbol): Promise<TreasuryWallet | null> {
    return clone(this.treasuryWallets.get(`${merchantId}:${assetKey(network, token)}`) ?? null);
  }

  async listTreasuryWallets(merchantId: string | undefined, limit: number): Promise<TreasuryWallet[]> {
    return clone(
      [...this.treasuryWallets.values()]
        .filter((wallet) => !merchantId || wallet.merchantId === merchantId)
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
        .slice(0, limit)
    );
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
    const id = this.operationalWalletsByScope.get(operationalWalletScopeKey("gas", null, network, null));
    return clone(id ? (this.operationalWallets.get(id) ?? null) : null);
  }

  async listOperationalWallets(filter: ListOperationalWalletsFilter): Promise<OperationalWallet[]> {
    return clone(
      [...this.operationalWallets.values()]
        .filter((wallet) => filter.includeDisabled || wallet.status === "active")
        .filter((wallet) => !filter.merchantId || wallet.merchantId === filter.merchantId)
        .filter((wallet) => !filter.purpose || wallet.purpose === filter.purpose)
        .filter((wallet) => !filter.network || wallet.network === filter.network)
        .filter((wallet) => !filter.token || wallet.token === filter.token)
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
        .slice(0, filter.limit)
    );
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
      status: "active",
      expiresAt: input.expiresAt,
      externalId: input.externalId,
      metadata: input.metadata ?? {},
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.depositAddresses.set(depositAddress.id, depositAddress);
    this.depositAddressesByAddress.set(addressKey(input.network, input.token, input.address), depositAddress.id);
    return clone(depositAddress);
  }

  async getDepositAddressForMerchant(merchantId: string, id: string): Promise<DepositAddress | null> {
    const depositAddress = this.depositAddresses.get(id);
    if (!depositAddress || depositAddress.merchantId !== merchantId) {
      return null;
    }
    return clone(depositAddress);
  }

  async getDepositAddressByAddress(
    network: NetworkSlug,
    token: TokenSymbol,
    address: ChainAddress
  ): Promise<DepositAddress | null> {
    const id = this.depositAddressesByAddress.get(addressKey(network, token, address));
    return clone(id ? (this.depositAddresses.get(id) ?? null) : null);
  }

  async listDepositAddresses(filter: ListDepositAddressesFilter): Promise<DepositAddress[]> {
    return clone(
      [...this.depositAddresses.values()]
        .filter((address) => !filter.merchantId || address.merchantId === filter.merchantId)
        .filter((address) => !filter.status || address.status === filter.status)
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        .slice(0, filter.limit)
    );
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

  async createTokenTransferIfNotExists(
    input: CreateTokenTransferInput
  ): Promise<{ transfer: TokenTransfer; created: boolean }> {
    const key = `${input.network}:${input.txHash.toLowerCase()}:${input.logIndex}`;
    const existingId = this.tokenTransfersByLog.get(key);
    if (existingId) {
      return { transfer: clone(this.tokenTransfers.get(existingId) as TokenTransfer), created: false };
    }

    const transfer: TokenTransfer = {
      ...input,
      detectedAt: now(),
      confirmedAt: input.status === "confirmed" ? now() : null
    };
    this.tokenTransfers.set(transfer.id, transfer);
    this.tokenTransfersByLog.set(key, transfer.id);
    return { transfer: clone(transfer), created: true };
  }

  async getTokenTransfer(id: string): Promise<TokenTransfer | null> {
    return clone(this.tokenTransfers.get(id) ?? null);
  }

  async listTransfersForDepositAddress(depositAddressId: string): Promise<TokenTransfer[]> {
    return clone(
      [...this.tokenTransfers.values()]
        .filter((transfer) => transfer.depositAddressId === depositAddressId)
        .sort((left, right) => Number(right.blockNumber - left.blockNumber))
    );
  }

  async listTransfersForMerchant(merchantId: string, filter: ListDepositsFilter): Promise<TokenTransfer[]> {
    return clone(
      [...this.tokenTransfers.values()]
        .filter((transfer) => transfer.merchantId === merchantId)
        .filter((transfer) => !filter.status || transfer.status === filter.status)
        .sort((left, right) => right.detectedAt.getTime() - left.detectedAt.getTime())
        .slice(0, filter.limit)
    );
  }

  async listTokenTransfers(filter: ListTransfersFilter): Promise<TokenTransfer[]> {
    return clone(
      [...this.tokenTransfers.values()]
        .filter((transfer) => !filter.merchantId || transfer.merchantId === filter.merchantId)
        .filter((transfer) => !filter.status || transfer.status === filter.status)
        .sort((left, right) => right.detectedAt.getTime() - left.detectedAt.getTime())
        .slice(0, filter.limit)
    );
  }

  async listTransfersReadyForConfirmation(
    network: NetworkSlug,
    token: TokenSymbol,
    maxBlockNumber: bigint
  ): Promise<TokenTransfer[]> {
    return clone(
      [...this.tokenTransfers.values()].filter(
        (transfer) =>
          transfer.network === network &&
          transfer.token === token &&
          transfer.status === "detected" &&
          transfer.blockNumber <= maxBlockNumber
      )
    );
  }

  async markTransferConfirmed(id: string, confirmations: number, confirmedAt: Date): Promise<TokenTransfer | null> {
    const transfer = this.tokenTransfers.get(id);
    if (!transfer) {
      return null;
    }
    transfer.status = "confirmed";
    transfer.confirmations = confirmations;
    transfer.confirmedAt = confirmedAt;
    return clone(transfer);
  }

  async getGasTopUpByTransfer(transferId: string): Promise<GasTopUp | null> {
    const id = this.gasTopUpsByTransfer.get(transferId);
    return clone(id ? (this.gasTopUps.get(id) ?? null) : null);
  }

  async createGasTopUpIfNotExists(input: CreateGasTopUpInput): Promise<{ gasTopUp: GasTopUp; created: boolean }> {
    const existingId = this.gasTopUpsByTransfer.get(input.transferId);
    if (existingId) {
      return { gasTopUp: clone(this.gasTopUps.get(existingId) as GasTopUp), created: false };
    }

    const gasTopUp: GasTopUp = {
      ...input,
      failureReason: input.failureReason ?? null,
      createdAt: now(),
      confirmedAt: input.status === "confirmed" ? now() : null
    };
    this.gasTopUps.set(gasTopUp.id, gasTopUp);
    this.gasTopUpsByTransfer.set(gasTopUp.transferId, gasTopUp.id);
    return { gasTopUp: clone(gasTopUp), created: true };
  }

  async listSubmittedGasTopUps(limit: number): Promise<GasTopUp[]> {
    return clone([...this.gasTopUps.values()].filter((topUp) => topUp.status === "submitted").slice(0, limit));
  }

  async listGasTopUps(limit: number): Promise<GasTopUp[]> {
    return clone(
      [...this.gasTopUps.values()]
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        .slice(0, limit)
    );
  }

  async updateGasTopUpStatus(
    id: string,
    status: TransactionStatus,
    txHash: string | null,
    failureReason?: string | null
  ): Promise<GasTopUp | null> {
    const topUp = this.gasTopUps.get(id);
    if (!topUp) {
      return null;
    }
    topUp.status = status;
    topUp.txHash = txHash;
    topUp.failureReason = failureReason ?? null;
    topUp.confirmedAt = status === "confirmed" ? now() : topUp.confirmedAt;
    return clone(topUp);
  }

  async getSweepByTransfer(transferId: string): Promise<Sweep | null> {
    const id = this.sweepsByTransfer.get(transferId);
    return clone(id ? (this.sweeps.get(id) ?? null) : null);
  }

  async createSweepIfNotExists(input: CreateSweepInput): Promise<{ sweep: Sweep; created: boolean }> {
    const existingId = this.sweepsByTransfer.get(input.transferId);
    if (existingId) {
      return { sweep: clone(this.sweeps.get(existingId) as Sweep), created: false };
    }

    const sweep: Sweep = {
      ...input,
      failureReason: input.failureReason ?? null,
      createdAt: now(),
      confirmedAt: input.status === "confirmed" ? now() : null
    };
    this.sweeps.set(sweep.id, sweep);
    this.sweepsByTransfer.set(sweep.transferId, sweep.id);
    return { sweep: clone(sweep), created: true };
  }

  async listSubmittedSweeps(limit: number): Promise<Sweep[]> {
    return clone([...this.sweeps.values()].filter((sweep) => sweep.status === "submitted").slice(0, limit));
  }

  async listSweeps(limit: number): Promise<Sweep[]> {
    return clone(
      [...this.sweeps.values()]
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        .slice(0, limit)
    );
  }

  async updateSweepStatus(
    id: string,
    status: TransactionStatus,
    txHash: string | null,
    failureReason?: string | null
  ): Promise<Sweep | null> {
    const sweep = this.sweeps.get(id);
    if (!sweep) {
      return null;
    }
    sweep.status = status;
    sweep.txHash = txHash;
    sweep.failureReason = failureReason ?? null;
    sweep.confirmedAt = status === "confirmed" ? now() : sweep.confirmedAt;
    return clone(sweep);
  }

  async createWalletTransaction(input: CreateWalletTransactionInput): Promise<WalletTransaction> {
    const transaction: WalletTransaction = {
      ...input,
      failureReason: input.failureReason ?? null,
      createdAt: now(),
      confirmedAt: input.status === "confirmed" ? now() : null
    };
    this.walletTransactions.set(transaction.id, transaction);
    return clone(transaction);
  }

  async listWalletTransactions(limit: number): Promise<WalletTransaction[]> {
    return clone(
      [...this.walletTransactions.values()]
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        .slice(0, limit)
    );
  }

  async listSubmittedWalletTransactions(limit: number): Promise<WalletTransaction[]> {
    return clone(
      [...this.walletTransactions.values()]
        .filter((transaction) => transaction.status === "submitted")
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
        .slice(0, limit)
    );
  }

  async updateWalletTransactionStatus(
    id: string,
    status: TransactionStatus,
    txHash: string | null,
    failureReason?: string | null
  ): Promise<WalletTransaction | null> {
    const transaction = this.walletTransactions.get(id);
    if (!transaction) {
      return null;
    }
    transaction.status = status;
    transaction.txHash = txHash;
    transaction.failureReason = failureReason ?? null;
    transaction.confirmedAt = status === "confirmed" ? now() : transaction.confirmedAt;
    return clone(transaction);
  }

  async createWebhookEvent(input: CreateWebhookEventInput): Promise<WebhookEvent> {
    const timestamp = now();
    const event: WebhookEvent = {
      ...input,
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
    return clone(
      [...this.webhookEvents.values()]
        .filter((event) => event.status === "pending" && event.nextAttemptAt <= currentTime)
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
        .slice(0, limit)
    );
  }

  async listWebhookEvents(limit: number): Promise<WebhookEvent[]> {
    return clone(
      [...this.webhookEvents.values()]
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        .slice(0, limit)
    );
  }

  async markWebhookSent(id: string, responseStatus: number, sentAt: Date): Promise<WebhookEvent | null> {
    const event = this.webhookEvents.get(id);
    if (!event) {
      return null;
    }
    event.status = "sent";
    event.attempts += 1;
    event.responseStatus = responseStatus;
    event.sentAt = sentAt;
    event.updatedAt = sentAt;
    return clone(event);
  }

  async markWebhookRetry(
    id: string,
    attempts: number,
    status: "pending" | "failed",
    nextAttemptAt: Date,
    error: string,
    responseStatus: number | null
  ): Promise<WebhookEvent | null> {
    const event = this.webhookEvents.get(id);
    if (!event) {
      return null;
    }
    event.attempts = attempts;
    event.status = status;
    event.nextAttemptAt = nextAttemptAt;
    event.lastError = error;
    event.responseStatus = responseStatus;
    event.updatedAt = now();
    return clone(event);
  }

  async getIdempotencyRecord(merchantId: string, route: string, key: string): Promise<IdempotencyRecord | null> {
    return clone(this.idempotencyRecords.get(`${merchantId}:${route}:${key}`) ?? null);
  }

  async createIdempotencyRecord(input: CreateIdempotencyInput): Promise<IdempotencyRecord> {
    const record: IdempotencyRecord = { ...input, createdAt: now() };
    this.idempotencyRecords.set(`${record.merchantId}:${record.route}:${record.key}`, record);
    return clone(record);
  }
}
