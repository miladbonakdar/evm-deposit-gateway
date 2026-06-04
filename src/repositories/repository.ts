import type { Address, Hex } from "viem";
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
  TransferStatus,
  WebhookConfig,
  WebhookEvent,
  WebhookEventType
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
  address: Address;
}

export interface CreateDepositAddressInput {
  id: string;
  merchantId: string;
  network: NetworkSlug;
  token: TokenSymbol;
  address: Address;
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
  txHash: Hex;
  logIndex: number;
  fromAddress: Address;
  toAddress: Address;
  amountRaw: string;
  amountFormatted: string;
  blockNumber: bigint;
  blockHash: Hex | null;
  confirmations: number;
  status: TransferStatus;
}

export interface CreateGasTopUpInput {
  id: string;
  transferId: string;
  merchantId: string;
  depositAddressId: string;
  network: NetworkSlug;
  txHash: Hex | null;
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
  txHash: Hex | null;
  amountRaw: string;
  amountFormatted: string;
  toAddress: Address;
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

export interface Repository {
  createMerchant(input: CreateMerchantInput): Promise<Merchant>;
  getMerchant(id: string): Promise<Merchant | null>;
  createApiKey(input: CreateApiKeyInput): Promise<MerchantApiKey>;
  getApiKeyByPublicKey(publicKey: string): Promise<MerchantApiKey | null>;
  updateApiKeyLastUsed(id: string, usedAt: Date): Promise<void>;
  updateApiKeySecret(id: string, secretEncrypted: string): Promise<MerchantApiKey | null>;
  updateApiKeyStatus(id: string, status: ApiKeyStatus): Promise<MerchantApiKey | null>;
  insertRequestNonce(apiKeyId: string, nonce: string, timestamp: Date): Promise<boolean>;

  upsertWebhookConfig(input: UpsertWebhookConfigInput): Promise<WebhookConfig>;
  getWebhookConfig(merchantId: string): Promise<WebhookConfig | null>;
  upsertTreasuryWallet(input: UpsertTreasuryWalletInput): Promise<TreasuryWallet>;
  getTreasuryWallet(merchantId: string, network: NetworkSlug, token: TokenSymbol): Promise<TreasuryWallet | null>;

  createDepositAddress(input: CreateDepositAddressInput): Promise<DepositAddress>;
  getDepositAddressForMerchant(merchantId: string, id: string): Promise<DepositAddress | null>;
  getDepositAddressByAddress(network: NetworkSlug, token: TokenSymbol, address: Address): Promise<DepositAddress | null>;
  expireDepositAddresses(now: Date): Promise<number>;

  getChainCursor(network: NetworkSlug, token: TokenSymbol): Promise<ChainCursor | null>;
  upsertChainCursor(network: NetworkSlug, token: TokenSymbol, lastScannedBlock: bigint): Promise<ChainCursor>;
  createTokenTransferIfNotExists(input: CreateTokenTransferInput): Promise<{ transfer: TokenTransfer; created: boolean }>;
  getTokenTransfer(id: string): Promise<TokenTransfer | null>;
  listTransfersForDepositAddress(depositAddressId: string): Promise<TokenTransfer[]>;
  listTransfersForMerchant(merchantId: string, filter: ListDepositsFilter): Promise<TokenTransfer[]>;
  listTransfersReadyForConfirmation(network: NetworkSlug, token: TokenSymbol, maxBlockNumber: bigint): Promise<TokenTransfer[]>;
  markTransferConfirmed(id: string, confirmations: number, confirmedAt: Date): Promise<TokenTransfer | null>;

  getGasTopUpByTransfer(transferId: string): Promise<GasTopUp | null>;
  createGasTopUpIfNotExists(input: CreateGasTopUpInput): Promise<{ gasTopUp: GasTopUp; created: boolean }>;
  listSubmittedGasTopUps(limit: number): Promise<GasTopUp[]>;
  updateGasTopUpStatus(id: string, status: TransactionStatus, txHash: Hex | null, failureReason?: string | null): Promise<GasTopUp | null>;

  getSweepByTransfer(transferId: string): Promise<Sweep | null>;
  createSweepIfNotExists(input: CreateSweepInput): Promise<{ sweep: Sweep; created: boolean }>;
  listSubmittedSweeps(limit: number): Promise<Sweep[]>;
  updateSweepStatus(id: string, status: TransactionStatus, txHash: Hex | null, failureReason?: string | null): Promise<Sweep | null>;

  createWebhookEvent(input: CreateWebhookEventInput): Promise<WebhookEvent>;
  listDueWebhookEvents(now: Date, limit: number): Promise<WebhookEvent[]>;
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
