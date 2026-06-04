import type { Address, Hex } from "viem";

export const networkSlugs = ["ethereum", "bsc", "polygon", "arbitrum", "optimism", "base"] as const;
export const tokenSymbols = ["USDT", "USDC"] as const;

export type NetworkSlug = (typeof networkSlugs)[number];
export type TokenSymbol = (typeof tokenSymbols)[number];
export type MerchantStatus = "active" | "disabled";
export type ApiKeyStatus = "active" | "revoked";
export type DepositAddressStatus = "active" | "expired";
export type TransferStatus = "detected" | "confirmed" | "late";
export type TransactionStatus = "submitted" | "confirmed" | "failed";
export type WebhookStatus = "pending" | "sent" | "failed";
export type WebhookEventType =
  | "wallet.created"
  | "transfer.detected"
  | "deposit.confirmed"
  | "deposit.late_detected"
  | "gas.topup.submitted"
  | "gas.topup.confirmed"
  | "gas.topup.failed"
  | "sweep.submitted"
  | "sweep.confirmed"
  | "sweep.failed";

export interface Merchant {
  id: string;
  name: string;
  status: MerchantStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface MerchantApiKey {
  id: string;
  merchantId: string;
  publicKey: string;
  secretEncrypted: string;
  status: ApiKeyStatus;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export interface WebhookConfig {
  merchantId: string;
  url: string;
  secretEncrypted: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TreasuryWallet {
  id: string;
  merchantId: string;
  network: NetworkSlug;
  token: TokenSymbol;
  address: Address;
  createdAt: Date;
  updatedAt: Date;
}

export interface DepositAddress {
  id: string;
  merchantId: string;
  network: NetworkSlug;
  token: TokenSymbol;
  address: Address;
  privateKeyEncrypted: string;
  status: DepositAddressStatus;
  expiresAt: Date;
  externalId: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChainCursor {
  network: NetworkSlug;
  token: TokenSymbol;
  lastScannedBlock: bigint;
  updatedAt: Date;
}

export interface TokenTransfer {
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
  detectedAt: Date;
  confirmedAt: Date | null;
}

export interface GasTopUp {
  id: string;
  transferId: string;
  merchantId: string;
  depositAddressId: string;
  network: NetworkSlug;
  txHash: Hex | null;
  amountWei: string;
  status: TransactionStatus;
  failureReason: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
}

export interface Sweep {
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
  failureReason: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
}

export interface WebhookEvent {
  id: string;
  merchantId: string;
  type: WebhookEventType;
  url: string;
  secretEncrypted: string;
  payload: Record<string, unknown>;
  status: WebhookStatus;
  attempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
  responseStatus: number | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IdempotencyRecord {
  id: string;
  merchantId: string;
  route: string;
  key: string;
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
  createdAt: Date;
}

export interface AuthenticatedMerchant {
  merchant: Merchant;
  apiKey: MerchantApiKey;
}
