export const networkSlugs = ["ethereum", "bsc", "polygon", "arbitrum", "optimism", "base", "sepolia", "bscTestnet", "polygonAmoy", "arbitrumSepolia", "optimismSepolia", "baseSepolia", "avalancheFuji", "lineaSepolia", "scrollSepolia", "tron", "nile"] as const;
export const tokenSymbols = ["USDT", "USDC"] as const;
export type NetworkSlug = (typeof networkSlugs)[number];
export type TokenSymbol = (typeof tokenSymbols)[number];
export type ChainAddress = string;
export type ChainTxHash = string;
export type MerchantStatus = "active" | "disabled";
export type ApiKeyStatus = "active" | "revoked";
export type DepositAddressStatus = "active" | "expired" | "completed" | "closed";
export type DepositFlow = "temporary_wallet" | "direct_treasury";
export type DepositMatchStatus = "pending" | "matched";
export type DepositMatchSource = "auto" | "manual";
export type TransferStatus = "detected" | "confirmed" | "late";
export type TransactionStatus = "submitted" | "confirmed" | "failed";
export type SettlementStatus = "pending" | "submitted" | "settled";
export type SettlementStep = "gas_top_up" | "sweep";
export type TreasuryTransferStatus = "unmatched" | "ambiguous" | "matched";
export type WebhookStatus = "pending" | "sent" | "failed";
export type OperationalWalletPurpose = "gas" | "treasury";
export type OperationalWalletStatus = "active" | "disabled";
export type WalletTransactionAsset = TokenSymbol | "NATIVE";
export const webhookEventTypes = ["wallet.created", "wallet.expired", "direct_deposit.created", "direct_deposit.expired", "transfer.detected", "deposit.confirmed", "deposit.late_detected", "gas.topup.submitted", "gas.topup.confirmed", "gas.topup.failed", "sweep.submitted", "sweep.confirmed", "sweep.failed"] as const;
export type WebhookEventType = (typeof webhookEventTypes)[number];
export interface Merchant { id: string; name: string; status: MerchantStatus; rejectDuplicateClientPendingDeposits: boolean; createdAt: Date; updatedAt: Date; }
export interface MerchantApiKey { id: string; merchantId: string; publicKey: string; secretEncrypted: string; status: ApiKeyStatus; createdAt: Date; lastUsedAt: Date | null; }
export interface WebhookConfig { merchantId: string; url: string; secretEncrypted: string; active: boolean; createdAt: Date; updatedAt: Date; }
export interface NotificationPreferences { merchantId: string; enabledEvents: WebhookEventType[]; createdAt: Date; updatedAt: Date; }
export interface TreasuryWallet { id: string; merchantId: string; network: NetworkSlug; token: TokenSymbol; address: ChainAddress; label: string; isDefault: boolean; operationalWalletId: string | null; createdAt: Date; updatedAt: Date; }
export interface OperationalWallet { id: string; scopeKey: string; merchantId: string | null; purpose: OperationalWalletPurpose; network: NetworkSlug; token: TokenSymbol | null; address: ChainAddress; privateKeyEncrypted: string; label: string; status: OperationalWalletStatus; createdAt: Date; updatedAt: Date; }
export interface DepositAddress { id: string; merchantId: string; network: NetworkSlug; token: TokenSymbol; address: ChainAddress; privateKeyEncrypted: string | null; treasuryWalletId: string | null; callbackUrl: string | null; callbackSecretEncrypted: string | null; status: DepositAddressStatus; flow: DepositFlow; clientId: string; requestedAmountRaw: string | null; requestedAmountFormatted: string | null; receivedAmountRaw: string | null; receivedAmountFormatted: string | null; matchStatus: DepositMatchStatus | null; matchedTransferId: string | null; matchSource: DepositMatchSource | null; matchedAt: Date | null; expiresAt: Date; externalId: string | null; metadata: unknown; createdAt: Date; updatedAt: Date; }
export interface ChainCursor { network: NetworkSlug; token: TokenSymbol; lastScannedBlock: bigint; updatedAt: Date; }
export interface TokenTransfer { id: string; merchantId: string; depositAddressId: string; network: NetworkSlug; token: TokenSymbol; txHash: ChainTxHash; logIndex: number; fromAddress: ChainAddress; toAddress: ChainAddress; amountRaw: string; amountFormatted: string; blockNumber: bigint; blockHash: ChainTxHash | null; confirmations: number; status: TransferStatus; settlementStatus: SettlementStatus; settlementStep: SettlementStep | null; settlementFailureReason: string | null; settlementUpdatedAt: Date; detectedAt: Date; confirmedAt: Date | null; }
export interface TreasuryTransfer { id: string; merchantId: string; treasuryWalletId: string; network: NetworkSlug; token: TokenSymbol; txHash: ChainTxHash; logIndex: number; fromAddress: ChainAddress; toAddress: ChainAddress; amountRaw: string; amountFormatted: string; blockNumber: bigint; blockHash: ChainTxHash | null; confirmations: number; status: TreasuryTransferStatus; candidateDepositAddressIds: string[]; matchedDepositAddressId: string | null; matchSource: DepositMatchSource | null; detectedAt: Date; matchedAt: Date | null; createdAt: Date; updatedAt: Date; }
export interface GasTopUp { id: string; transferId: string; merchantId: string; depositAddressId: string; network: NetworkSlug; txHash: ChainTxHash | null; amountWei: string; attemptNumber: number; status: TransactionStatus; failureReason: string | null; createdAt: Date; confirmedAt: Date | null; }
export interface Sweep { id: string; transferId: string; merchantId: string; depositAddressId: string; network: NetworkSlug; token: TokenSymbol; txHash: ChainTxHash | null; amountRaw: string; amountFormatted: string; toAddress: ChainAddress; attemptNumber: number; status: TransactionStatus; failureReason: string | null; createdAt: Date; confirmedAt: Date | null; }
export interface WalletTransaction { id: string; merchantId: string | null; sourceWalletId: string; network: NetworkSlug; token: TokenSymbol | null; asset: WalletTransactionAsset; txHash: ChainTxHash | null; fromAddress: ChainAddress; toAddress: ChainAddress; amountRaw: string; amountFormatted: string; status: TransactionStatus; failureReason: string | null; createdAt: Date; confirmedAt: Date | null; }
export interface WebhookEvent { id: string; merchantId: string; depositAddressId: string | null; type: WebhookEventType; url: string; secretEncrypted: string; payload: Record<string, unknown>; status: WebhookStatus; attempts: number; nextAttemptAt: Date; lastError: string | null; responseStatus: number | null; sentAt: Date | null; createdAt: Date; updatedAt: Date; }
export interface IdempotencyRecord { id: string; merchantId: string; route: string; key: string; requestHash: string; responseStatus: number; responseBody: unknown; createdAt: Date; }
export interface AuthenticatedMerchant { merchant: Merchant; apiKey: MerchantApiKey; }
