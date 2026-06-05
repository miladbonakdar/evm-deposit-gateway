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
  WebhookEventType,
  WalletTransaction,
  WalletTransactionAsset
} from "../types/domain.js";

export interface CreateMerchantInput {
  id: string;
  name: string;
}

export interface CreateApiKeyInput {
  id: string;
  merchantId: string;
  publicKey: string;
  secretEncrypted: string;
}

export interface UpsertWebhookConfigInput {
  merchantId: string;
  url: string;
  secretEncrypted: string;
  active: boolean;
}

export interface UpsertTreasuryWalletInput {
  id: string;
  merchantId: string;
  network: NetworkSlug;
  token: TokenSymbol;
  address: ChainAddress;
}

export interface UpsertOperationalWalletInput {
  id: string;
  scopeKey: string;
  merchantId: string | null;
  purpose: OperationalWalletPurpose;
  network: NetworkSlug;
  token: TokenSymbol | null;
  address: ChainAddress;
  privateKeyEncrypted: string;
  label: string;
}

export interface CreateDepositAddressInput {
  id: string;
  merchantId: string;
  network: NetworkSlug;
  token: TokenSymbol;
  address: ChainAddress;
  privateKeyEncrypted: string;
  expiresAt: Date;
  externalId: string | null;
  metadata: unknown;
}

export interface CreateTokenTransferInput {
  id: string;
  merchantId: string;
  depositAddressId: string;
  network: NetworkSlug;
  token: TokenSymbol;
  txHash: ChainTxHash;
  logIndex: number;
  fromAddress: ChainAddress;
  toAddress: ChainAddress;
  amountRaw: string;
  amountFormatted: string;
  blockNumber: bigint;
  blockHash: ChainTxHash | null;
  confirmations: number;
  status: TransferStatus;
}

export interface CreateGasTopUpInput {
  id: string;
  transferId: string;
  merchantId: string;
  depositAddressId: string;
  network: NetworkSlug;
  txHash: ChainTxHash | null;
  amountWei: string;
  status: TransactionStatus;
  failureReason?: string | null;
}

export interface CreateSweepInput {
  id: string;
  transferId: string;
  merchantId: string;
  depositAddressId: string;
  network: NetworkSlug;
  token: TokenSymbol;
  txHash: ChainTxHash | null;
  amountRaw: string;
  amountFormatted: string;
  toAddress: ChainAddress;
  status: TransactionStatus;
  failureReason?: string | null;
}

export interface CreateWalletTransactionInput {
  id: string;
  merchantId: string | null;
  sourceWalletId: string;
  network: NetworkSlug;
  token: TokenSymbol | null;
  asset: WalletTransactionAsset;
  txHash: ChainTxHash | null;
  fromAddress: ChainAddress;
  toAddress: ChainAddress;
  amountRaw: string;
  amountFormatted: string;
  status: TransactionStatus;
  failureReason?: string | null;
}

export interface CreateWebhookEventInput {
  id: string;
  merchantId: string;
  type: WebhookEventType;
  url: string;
  secretEncrypted: string;
  payload: Record<string, unknown>;
}

export interface CreateIdempotencyInput {
  id: string;
  merchantId: string;
  route: string;
  key: string;
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
}

export interface ListDepositsFilter {
  status?: TransferStatus;
  limit: number;
  cursor?: string;
}

export interface ListDepositAddressesFilter {
  merchantId?: string;
  status?: DepositAddress["status"];
  limit: number;
}

export interface ListOperationalWalletsFilter {
  merchantId?: string;
  purpose?: OperationalWalletPurpose;
  network?: NetworkSlug;
  token?: TokenSymbol;
  includeDisabled?: boolean;
  limit: number;
}

export interface ListTransfersFilter {
  merchantId?: string;
  status?: TransferStatus;
  limit: number;
}

export interface Repository {
  createMerchant(input: CreateMerchantInput): Promise<Merchant>;
  getMerchant(id: string): Promise<Merchant | null>;
  listMerchants(limit: number): Promise<Merchant[]>;
  createApiKey(input: CreateApiKeyInput): Promise<MerchantApiKey>;
  getApiKeyByPublicKey(publicKey: string): Promise<MerchantApiKey | null>;
  listApiKeys(merchantId: string | undefined, limit: number): Promise<MerchantApiKey[]>;
  updateApiKeyLastUsed(id: string, usedAt: Date): Promise<void>;
  updateApiKeySecret(id: string, secretEncrypted: string): Promise<MerchantApiKey | null>;
  updateApiKeyStatus(id: string, status: ApiKeyStatus): Promise<MerchantApiKey | null>;
  insertRequestNonce(apiKeyId: string, nonce: string, timestamp: Date): Promise<boolean>;

  upsertWebhookConfig(input: UpsertWebhookConfigInput): Promise<WebhookConfig>;
  getWebhookConfig(merchantId: string): Promise<WebhookConfig | null>;
  listWebhookConfigs(limit: number): Promise<WebhookConfig[]>;
  upsertTreasuryWallet(input: UpsertTreasuryWalletInput): Promise<TreasuryWallet>;
  getTreasuryWallet(merchantId: string, network: NetworkSlug, token: TokenSymbol): Promise<TreasuryWallet | null>;
  listTreasuryWallets(merchantId: string | undefined, limit: number): Promise<TreasuryWallet[]>;
  upsertOperationalWallet(input: UpsertOperationalWalletInput): Promise<OperationalWallet>;
  getOperationalWallet(id: string): Promise<OperationalWallet | null>;
  getOperationalGasWallet(network: NetworkSlug): Promise<OperationalWallet | null>;
  listOperationalWallets(filter: ListOperationalWalletsFilter): Promise<OperationalWallet[]>;

  createDepositAddress(input: CreateDepositAddressInput): Promise<DepositAddress>;
  getDepositAddressForMerchant(merchantId: string, id: string): Promise<DepositAddress | null>;
  getDepositAddressByAddress(network: NetworkSlug, token: TokenSymbol, address: ChainAddress): Promise<DepositAddress | null>;
  listDepositAddresses(filter: ListDepositAddressesFilter): Promise<DepositAddress[]>;
  expireDepositAddresses(now: Date): Promise<DepositAddress[]>;

  getChainCursor(network: NetworkSlug, token: TokenSymbol): Promise<ChainCursor | null>;
  upsertChainCursor(network: NetworkSlug, token: TokenSymbol, lastScannedBlock: bigint): Promise<ChainCursor>;
  createTokenTransferIfNotExists(input: CreateTokenTransferInput): Promise<{ transfer: TokenTransfer; created: boolean }>;
  getTokenTransfer(id: string): Promise<TokenTransfer | null>;
  listTransfersForDepositAddress(depositAddressId: string): Promise<TokenTransfer[]>;
  listTransfersForMerchant(merchantId: string, filter: ListDepositsFilter): Promise<TokenTransfer[]>;
  listTokenTransfers(filter: ListTransfersFilter): Promise<TokenTransfer[]>;
  listTransfersReadyForConfirmation(network: NetworkSlug, token: TokenSymbol, maxBlockNumber: bigint): Promise<TokenTransfer[]>;
  markTransferConfirmed(id: string, confirmations: number, confirmedAt: Date): Promise<TokenTransfer | null>;

  getGasTopUpByTransfer(transferId: string): Promise<GasTopUp | null>;
  createGasTopUpIfNotExists(input: CreateGasTopUpInput): Promise<{ gasTopUp: GasTopUp; created: boolean }>;
  listSubmittedGasTopUps(limit: number): Promise<GasTopUp[]>;
  listGasTopUps(limit: number): Promise<GasTopUp[]>;
  updateGasTopUpStatus(id: string, status: TransactionStatus, txHash: ChainTxHash | null, failureReason?: string | null): Promise<GasTopUp | null>;

  getSweepByTransfer(transferId: string): Promise<Sweep | null>;
  createSweepIfNotExists(input: CreateSweepInput): Promise<{ sweep: Sweep; created: boolean }>;
  listSubmittedSweeps(limit: number): Promise<Sweep[]>;
  listSweeps(limit: number): Promise<Sweep[]>;
  updateSweepStatus(id: string, status: TransactionStatus, txHash: ChainTxHash | null, failureReason?: string | null): Promise<Sweep | null>;

  createWalletTransaction(input: CreateWalletTransactionInput): Promise<WalletTransaction>;
  listWalletTransactions(limit: number): Promise<WalletTransaction[]>;
  listSubmittedWalletTransactions(limit: number): Promise<WalletTransaction[]>;
  updateWalletTransactionStatus(id: string, status: TransactionStatus, txHash: ChainTxHash | null, failureReason?: string | null): Promise<WalletTransaction | null>;

  createWebhookEvent(input: CreateWebhookEventInput): Promise<WebhookEvent>;
  listDueWebhookEvents(now: Date, limit: number): Promise<WebhookEvent[]>;
  listWebhookEvents(limit: number): Promise<WebhookEvent[]>;
  markWebhookSent(id: string, responseStatus: number, sentAt: Date): Promise<WebhookEvent | null>;
  markWebhookRetry(
    id: string,
    attempts: number,
    status: "pending" | "failed",
    nextAttemptAt: Date,
    error: string,
    responseStatus: number | null
  ): Promise<WebhookEvent | null>;

  getIdempotencyRecord(merchantId: string, route: string, key: string): Promise<IdempotencyRecord | null>;
  createIdempotencyRecord(input: CreateIdempotencyInput): Promise<IdempotencyRecord>;
}
