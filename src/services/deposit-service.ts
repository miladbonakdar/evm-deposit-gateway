import { assertEnabledToken, type NetworkConfig, type SupportedNetworks, type TokenConfig } from "../config/networks.js";
import { conflict, notFound, unprocessable } from "../errors.js";
import type { Encryptor } from "../security/encryption.js";
import type { DepositAddress, DepositFlow, NetworkSlug, TokenSymbol, TokenTransfer, TreasuryTransfer, TreasuryWallet } from "../types/domain.js";
import { normalizeAddress } from "../utils/address.js";
import { formatTokenAmount, parseTokenAmount } from "../utils/amount.js";
import { buildQrResult, type QrFormat } from "../utils/qr.js";
import { newId } from "../utils/id.js";
import { generateChainWallet, privateKeyToChainAddress } from "../utils/wallet.js";
import type { Repository } from "../repositories/repository.js";
import type { ChainProvider } from "../worker/chain-provider.js";
import type { WebhookService } from "./webhook-service.js";

export interface CreateDepositAddressInput {
  merchantId: string;
  network: NetworkSlug;
  token: TokenSymbol;
  clientId: string;
  flow?: DepositFlow;
  amount?: string;
  treasuryWalletId?: string;
  callbackUrl?: string;
  callbackSecret?: string;
  ttlSeconds?: number;
  externalId?: string;
  metadata?: unknown;
  qrFormat?: QrFormat;
}

interface DepositConfigurationIssue { code: string; message: string; details?: Record<string, unknown>; }

export class DepositService {
  constructor(private readonly repo: Repository, private readonly encryptor: Encryptor, private readonly networks: SupportedNetworks, private readonly webhooks: WebhookService, private readonly chainProvider?: ChainProvider) {}

  async createDepositAddress(input: CreateDepositAddressInput) {
    const { network: networkConfig, token: tokenConfig } = assertEnabledToken(this.networks, input.network, input.token);
    await this.assertClientCanOpenDeposit(input.merchantId, input.clientId);
    const flow = input.flow ?? "temporary_wallet";
    const treasury = await this.resolveTreasury(input, flow);
    const requestedAmount = flow === "direct_treasury" ? parseRequestedAmount(input.amount, tokenConfig.decimals) : null;
    const issues = this.collectTreasuryIssues(input, treasury);
    issues.push(...await this.collectCallbackIssues(input));
    if (flow === "temporary_wallet") issues.push(...await this.collectTemporaryWalletReadiness(networkConfig, tokenConfig, treasury));
    throwDepositConfigurationIssues(issues);
    if (!treasury) throw new Error("Treasury readiness check did not return a treasury");

    const wallet = flow === "temporary_wallet" ? await generateChainWallet(networkConfig.kind) : null;
    const expiresAt = new Date(Date.now() + (input.ttlSeconds ?? 86_400) * 1000);
    const depositAddress = await this.repo.createDepositAddress({
      id: newId(),
      merchantId: input.merchantId,
      network: input.network,
      token: input.token,
      address: wallet ? normalizeAddress(networkConfig, wallet.address) : treasury.address,
      privateKeyEncrypted: wallet ? this.encryptor.encryptString(wallet.privateKey) : null,
      treasuryWalletId: treasury.id,
      callbackUrl: input.callbackUrl ?? null,
      callbackSecretEncrypted: input.callbackSecret ? this.encryptor.encryptString(input.callbackSecret) : null,
      flow,
      clientId: input.clientId,
      requestedAmountRaw: requestedAmount?.raw ?? null,
      requestedAmountFormatted: requestedAmount?.formatted ?? null,
      receivedAmountRaw: null,
      receivedAmountFormatted: null,
      matchStatus: flow === "direct_treasury" ? "pending" : null,
      matchedTransferId: null,
      matchSource: null,
      matchedAt: null,
      expiresAt,
      externalId: input.externalId ?? null,
      metadata: input.metadata ?? {}
    });

    await this.webhooks.enqueueMerchantEvent(input.merchantId, flow === "direct_treasury" ? "direct_deposit.created" : "wallet.created", {
      depositAddress: publicDepositAddress(depositAddress),
      treasuryWallet: treasury.address,
      treasuryWalletId: treasury.id
    }, { depositAddressId: depositAddress.id });
    return { ...publicDepositAddress(depositAddress), qr: await buildQrResult(depositAddress.address, input.qrFormat ?? "none") };
  }

  async getDepositAddress(merchantId: string, id: string) {
    const depositAddress = await this.repo.getDepositAddressForMerchant(merchantId, id);
    if (!depositAddress) throw notFound("deposit_address_not_found", "Deposit address was not found");
    const transfers = await this.repo.listTransfersForDepositAddress(depositAddress.id);
    return { ...publicDepositAddress(depositAddress), transfers: transfers.map(publicTransfer) };
  }

  async closeDepositAddress(merchantId: string, id: string) {
    const depositAddress = await this.repo.getDepositAddressForMerchant(merchantId, id);
    if (!depositAddress) throw notFound("deposit_address_not_found", "Deposit request was not found");
    if (depositAddress.status !== "active") throw conflict("deposit_request_not_active", "Deposit request is not active", { status: depositAddress.status });
    const closed = await this.repo.closeDepositAddress(merchantId, id, new Date());
    return publicDepositAddress(closed ?? depositAddress);
  }

  async listDeposits(merchantId: string, status: TokenTransfer["status"] | undefined, limit: number) {
    return { deposits: (await this.repo.listTransfersForMerchant(merchantId, { status, limit })).map(publicTransfer) };
  }

  async matchTreasuryTransfer(merchantId: string, treasuryTransferId: string, depositAddressId: string) {
    const treasuryTransfer = await this.repo.getTreasuryTransfer(treasuryTransferId);
    if (!treasuryTransfer || treasuryTransfer.merchantId !== merchantId) throw notFound("treasury_transfer_not_found", "Treasury transfer was not found");
    if (treasuryTransfer.status === "matched") throw conflict("treasury_transfer_already_matched", "Treasury transfer is already matched");
    const depositAddress = await this.repo.getDepositAddressForMerchant(merchantId, depositAddressId);
    if (!depositAddress) throw notFound("deposit_address_not_found", "Deposit request was not found");
    if (depositAddress.flow !== "direct_treasury") throw unprocessable("deposit_flow_mismatch", "Only direct treasury deposit requests can be manually matched");
    if (depositAddress.matchStatus !== "pending") throw conflict("deposit_request_already_matched", "Deposit request is already matched");
    if (depositAddress.network !== treasuryTransfer.network || depositAddress.token !== treasuryTransfer.token || depositAddress.treasuryWalletId !== treasuryTransfer.treasuryWalletId) throw unprocessable("treasury_transfer_mismatch", "Treasury transfer must match the deposit request asset and treasury wallet");

    const existing = await this.repo.getTokenTransferByChainLog(treasuryTransfer.network, treasuryTransfer.txHash, treasuryTransfer.logIndex);
    if (existing && existing.depositAddressId !== depositAddress.id) throw conflict("treasury_transfer_already_attached", "Treasury transfer is already attached to another deposit request");
    const { transfer, created } = existing ? { transfer: existing, created: false } : await this.repo.createTokenTransferIfNotExists({
      id: newId(), merchantId, depositAddressId: depositAddress.id, network: treasuryTransfer.network, token: treasuryTransfer.token,
      txHash: treasuryTransfer.txHash, logIndex: treasuryTransfer.logIndex, fromAddress: treasuryTransfer.fromAddress, toAddress: treasuryTransfer.toAddress,
      amountRaw: treasuryTransfer.amountRaw, amountFormatted: treasuryTransfer.amountFormatted, blockNumber: treasuryTransfer.blockNumber,
      blockHash: treasuryTransfer.blockHash, confirmations: treasuryTransfer.confirmations, status: "confirmed"
    });
    const matchedAt = new Date();
    const [matchedDepositAddress, matchedTreasuryTransfer] = await Promise.all([
      this.repo.markDepositAddressMatched(depositAddress.id, { transferId: transfer.id, receivedAmountRaw: transfer.amountRaw, receivedAmountFormatted: transfer.amountFormatted, matchSource: "manual", matchedAt }),
      this.repo.updateTreasuryTransferStatus(treasuryTransfer.id, "matched", depositAddress.id, "manual", matchedAt),
      this.repo.updateTransferSettlement(transfer.id, { settlementStatus: "settled", settlementStep: null, settlementFailureReason: null })
    ]);
    const updatedTransfer = await this.repo.getTokenTransfer(transfer.id) ?? transfer;
    const publicMatchedDeposit = publicDepositAddress(matchedDepositAddress ?? depositAddress);
    const publicMatchedTransfer = publicTransfer(updatedTransfer);
    if (created) {
      await this.webhooks.enqueueMerchantEvent(merchantId, "transfer.detected", { transfer: publicMatchedTransfer, depositAddress: publicMatchedDeposit }, { depositAddressId: depositAddress.id });
      await this.webhooks.enqueueMerchantEvent(merchantId, "deposit.confirmed", { transfer: publicMatchedTransfer, depositAddress: publicMatchedDeposit }, { depositAddressId: depositAddress.id });
    }
    return { treasuryTransfer: publicTreasuryTransfer(matchedTreasuryTransfer ?? treasuryTransfer), depositAddress: publicMatchedDeposit, transfer: publicMatchedTransfer };
  }

  async listTreasuryWallets(merchantId: string, network: NetworkSlug | undefined, token: TokenSymbol | undefined, limit: number) {
    return { treasuryWallets: (await this.repo.listTreasuryWallets({ merchantId, network, token, limit })).map(publicTreasuryWallet) };
  }

  async listTreasuryTransfers(merchantId: string, status: TreasuryTransfer["status"] | undefined, network: NetworkSlug | undefined, token: TokenSymbol | undefined, limit: number) {
    return { treasuryTransfers: (await this.repo.listTreasuryTransfers({ merchantId, status, network, token, limit })).map(publicTreasuryTransfer) };
  }

  async assertIdempotency(merchantId: string, route: string, key: string | undefined, requestHash: string): Promise<{ replay: boolean; response?: unknown; status?: number }> {
    if (!key) return { replay: false };
    const existing = await this.repo.getIdempotencyRecord(merchantId, route, key);
    if (!existing) return { replay: false };
    if (existing.requestHash !== requestHash) throw conflict("idempotency_key_conflict", "Idempotency key was reused with a different request body");
    return { replay: true, response: existing.responseBody, status: existing.responseStatus };
  }

  async storeIdempotency(merchantId: string, route: string, key: string | undefined, requestHash: string, responseStatus: number, responseBody: unknown): Promise<void> {
    if (!key) return;
    await this.repo.createIdempotencyRecord({ id: newId(), merchantId, route, key, requestHash, responseStatus, responseBody });
  }

  private async resolveTreasury(input: CreateDepositAddressInput, flow: DepositFlow): Promise<TreasuryWallet | null> {
    return input.treasuryWalletId
      ? await this.repo.getTreasuryWalletById(input.merchantId, input.treasuryWalletId)
      : flow === "direct_treasury"
        ? await this.selectLeastPendingTreasury(input.merchantId, input.network, input.token)
        : await this.repo.getTreasuryWallet(input.merchantId, input.network, input.token);
  }

  private async assertClientCanOpenDeposit(merchantId: string, clientId: string): Promise<void> {
    const merchant = await this.repo.getMerchant(merchantId);
    if (merchant && !merchant.rejectDuplicateClientPendingDeposits) return;
    const existing = await this.repo.getActiveDepositAddressByClientId(merchantId, clientId);
    if (!existing) return;
    throw conflict("client_pending_deposit_exists", "A pending transaction already exists for this client", {
      clientId, depositAddressId: existing.id, status: existing.status, createdAt: existing.createdAt.toISOString(), expiresAt: existing.expiresAt.toISOString()
    });
  }

  private collectTreasuryIssues(input: CreateDepositAddressInput, treasury: TreasuryWallet | null): DepositConfigurationIssue[] {
    if (!treasury) return [{ code: "treasury_wallet_missing", message: `Treasury wallet must be configured before creating ${input.token} deposit requests on ${input.network}`, details: { network: input.network, token: input.token } }];
    if (treasury.network !== input.network || treasury.token !== input.token) return [{ code: "treasury_wallet_mismatch", message: "Treasury wallet must match the requested network and token", details: { requestedNetwork: input.network, requestedToken: input.token, treasuryWalletId: treasury.id, treasuryNetwork: treasury.network, treasuryToken: treasury.token } }];
    return [];
  }

  private async collectCallbackIssues(input: CreateDepositAddressInput): Promise<DepositConfigurationIssue[]> {
    if (input.callbackSecret && !input.callbackUrl) return [{ code: "callback_url_missing", message: "Callback URL is required when a per-deposit callback secret is provided" }];
    if (input.callbackSecret) return [];
    const config = await this.repo.getWebhookConfig(input.merchantId);
    if (!input.callbackUrl && !config?.active) return [{ code: "webhook_config_missing", message: "Active dashboard callback configuration or per-request callback URL is required before creating deposit requests" }];
    return [];
  }

  private async selectLeastPendingTreasury(merchantId: string, network: NetworkSlug, token: TokenSymbol): Promise<TreasuryWallet | null> {
    const wallets = await this.repo.listTreasuryWallets({ merchantId, network, token, limit: 1_000 });
    if (wallets.length === 0) return null;
    const counts = await this.repo.countActiveDirectDepositRequestsByTreasury(merchantId, network, token);
    return wallets.slice().sort((left, right) => (counts.get(left.id) ?? 0) - (counts.get(right.id) ?? 0) || left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id))[0] ?? null;
  }

  private async collectTemporaryWalletReadiness(network: NetworkConfig, token: TokenConfig, treasury: TreasuryWallet | null): Promise<DepositConfigurationIssue[]> {
    const issues: DepositConfigurationIssue[] = [];
    if (network.maxScanBlocks <= 0n) issues.push({ code: "worker_scan_window_invalid", message: `Worker scan window for ${network.slug} must be greater than zero`, details: { network: network.slug, maxScanBlocks: network.maxScanBlocks.toString(10) } });
    if (network.minGasWei <= 0n) issues.push({ code: "minimum_gas_not_configured", message: `Minimum gas threshold for ${network.slug} must be greater than zero`, details: { network: network.slug, minGasWei: network.minGasWei.toString(10) } });
    if (network.gasTopUpWei <= 0n) issues.push({ code: "gas_top_up_not_configured", message: `Gas top-up amount for ${network.slug} must be greater than zero`, details: { network: network.slug, gasTopUpWei: network.gasTopUpWei.toString(10) } });
    else if (network.gasTopUpWei < network.minGasWei) issues.push({ code: "gas_top_up_below_minimum", message: `Gas top-up amount for ${network.slug} must be at least the minimum gas threshold before creating ${token.symbol} deposit addresses`, details: { network: network.slug, minGasWei: network.minGasWei.toString(10), gasTopUpWei: network.gasTopUpWei.toString(10) } });
    if (!this.chainProvider) return issues;
    let latestBlock: bigint | null = null;
    try { latestBlock = await this.chainProvider.getLatestBlockNumber(network); } catch (error) { issues.push({ code: "network_rpc_unavailable", message: `Unable to verify ${network.slug} RPC connectivity before creating ${token.symbol} deposit addresses`, details: { network: network.slug, reason: error instanceof Error ? error.message : "Unknown latest block check failure" } }); }
    if (latestBlock !== null && network.scanFromBlock > latestBlock) issues.push({ code: "worker_scan_start_block_ahead", message: `Worker scan start block for ${network.slug} is ahead of the current chain head`, details: { network: network.slug, scanFromBlock: network.scanFromBlock.toString(10), latestBlock: latestBlock.toString(10) } });
    if (treasury && treasury.network === network.slug && treasury.token === token.symbol) {
      try { await this.chainProvider.getTokenBalance(network, token, treasury.address); } catch (error) { issues.push({ code: "token_contract_unavailable", message: `Unable to verify ${token.symbol} contract on ${network.slug} before creating deposit addresses`, details: { network: network.slug, token: token.symbol, contractAddress: token.contractAddress, reason: error instanceof Error ? error.message : "Unknown token contract check failure" } }); }
    }
    const gasWalletAddress = await this.getGasWalletAddress(network, issues);
    if (!gasWalletAddress || network.gasTopUpWei <= 0n) return issues;
    try {
      const balance = await this.chainProvider.getNativeBalance(network, gasWalletAddress);
      if (balance < network.gasTopUpWei) issues.push({ code: "gas_wallet_insufficient_balance", message: `Gas wallet for ${network.slug} must hold at least ${network.gasTopUpWei.toString(10)} wei before creating ${token.symbol} deposit addresses`, details: { network: network.slug, gasWalletAddress, balanceWei: balance.toString(10), requiredWei: network.gasTopUpWei.toString(10) } });
    } catch (error) { issues.push({ code: "gas_wallet_balance_unavailable", message: `Unable to verify gas wallet balance for ${network.slug} before creating ${token.symbol} deposit addresses`, details: { network: network.slug, gasWalletAddress, reason: error instanceof Error ? error.message : "Unknown balance check failure" } }); }
    return issues;
  }

  private async getGasWalletAddress(network: NetworkConfig, issues: DepositConfigurationIssue[]): Promise<string | null> {
    if (network.gasWalletPrivateKey) {
      try { return normalizeAddress(network, privateKeyToChainAddress(network.kind, network.gasWalletPrivateKey)); } catch (error) { issues.push({ code: "gas_wallet_invalid", message: `Configured gas wallet private key for ${network.slug} is invalid`, details: { network: network.slug, reason: error instanceof Error ? error.message : "Unknown gas wallet key failure" } }); return null; }
    }
    const wallet = await this.repo.getOperationalGasWallet(network.slug);
    if (!wallet || wallet.status !== "active") { issues.push({ code: "gas_wallet_missing", message: `Gas wallet must be configured before creating deposit addresses on ${network.slug}`, details: { network: network.slug } }); return null; }
    try {
      const privateKey = this.encryptor.decryptString(wallet.privateKeyEncrypted);
      const derivedAddress = normalizeAddress(network, privateKeyToChainAddress(network.kind, privateKey));
      const storedAddress = normalizeAddress(network, wallet.address);
      if (derivedAddress !== storedAddress) { issues.push({ code: "gas_wallet_key_mismatch", message: `Stored gas wallet private key does not match the configured gas wallet address for ${network.slug}`, details: { network: network.slug, gasWalletAddress: storedAddress, derivedAddress } }); return null; }
      return derivedAddress;
    } catch (error) { issues.push({ code: "gas_wallet_invalid", message: `Stored gas wallet for ${network.slug} cannot be used for gas top-ups`, details: { network: network.slug, gasWalletAddress: wallet.address, reason: error instanceof Error ? error.message : "Unknown stored gas wallet failure" } }); return null; }
  }
}

function throwDepositConfigurationIssues(issues: DepositConfigurationIssue[]): void {
  if (issues.length === 0) return;
  if (issues.length === 1) { const issue = issues[0] as DepositConfigurationIssue; throw unprocessable(issue.code, issue.message, issue.details); }
  throw unprocessable("deposit_configuration_incomplete", "Deposit request cannot be created until required configuration is fixed", { issues });
}

export function publicDepositAddress(depositAddress: DepositAddress) {
  const amountDeltaRaw = depositAddress.requestedAmountRaw && depositAddress.receivedAmountRaw ? safeBigIntDifference(depositAddress.receivedAmountRaw, depositAddress.requestedAmountRaw) : null;
  return {
    id: depositAddress.id, merchantId: depositAddress.merchantId, network: depositAddress.network, token: depositAddress.token, address: depositAddress.address,
    treasuryWalletId: depositAddress.treasuryWalletId, callbackUrl: depositAddress.callbackUrl, status: depositAddress.status, flow: depositAddress.flow,
    clientId: depositAddress.clientId, requestedAmountRaw: depositAddress.requestedAmountRaw, requestedAmountFormatted: depositAddress.requestedAmountFormatted,
    receivedAmountRaw: depositAddress.receivedAmountRaw, receivedAmountFormatted: depositAddress.receivedAmountFormatted, amountDeltaRaw,
    matchStatus: depositAddress.matchStatus, matchedTransferId: depositAddress.matchedTransferId, matchSource: depositAddress.matchSource,
    matchedAt: depositAddress.matchedAt?.toISOString() ?? null, expiresAt: depositAddress.expiresAt.toISOString(), externalId: depositAddress.externalId,
    metadata: depositAddress.metadata, createdAt: depositAddress.createdAt.toISOString()
  };
}

export function publicTreasuryTransfer(transfer: TreasuryTransfer) {
  return {
    id: transfer.id, merchantId: transfer.merchantId, treasuryWalletId: transfer.treasuryWalletId, network: transfer.network, token: transfer.token,
    txHash: transfer.txHash, logIndex: transfer.logIndex, fromAddress: transfer.fromAddress, toAddress: transfer.toAddress,
    amountRaw: transfer.amountRaw, amountFormatted: transfer.amountFormatted, blockNumber: transfer.blockNumber.toString(10), blockHash: transfer.blockHash,
    confirmations: transfer.confirmations, status: transfer.status, candidateDepositAddressIds: transfer.candidateDepositAddressIds,
    matchedDepositAddressId: transfer.matchedDepositAddressId, matchSource: transfer.matchSource, detectedAt: transfer.detectedAt.toISOString(),
    matchedAt: transfer.matchedAt?.toISOString() ?? null, createdAt: transfer.createdAt.toISOString(), updatedAt: transfer.updatedAt.toISOString()
  };
}

export function publicTransfer(transfer: TokenTransfer) {
  return {
    id: transfer.id, merchantId: transfer.merchantId, depositAddressId: transfer.depositAddressId, network: transfer.network, token: transfer.token,
    txHash: transfer.txHash, logIndex: transfer.logIndex, fromAddress: transfer.fromAddress, toAddress: transfer.toAddress,
    amountRaw: transfer.amountRaw, amountFormatted: transfer.amountFormatted, blockNumber: transfer.blockNumber.toString(10), confirmations: transfer.confirmations,
    status: transfer.status, settlementStatus: transfer.settlementStatus, settlementStep: transfer.settlementStep,
    settlementFailureReason: transfer.settlementFailureReason, settlementUpdatedAt: transfer.settlementUpdatedAt.toISOString(),
    detectedAt: transfer.detectedAt.toISOString(), confirmedAt: transfer.confirmedAt?.toISOString() ?? null
  };
}

export function publicTreasuryWallet(wallet: TreasuryWallet) {
  return {
    id: wallet.id, merchantId: wallet.merchantId, network: wallet.network, token: wallet.token, address: wallet.address, label: wallet.label,
    isDefault: wallet.isDefault, operationalWalletId: wallet.operationalWalletId, createdAt: wallet.createdAt.toISOString(), updatedAt: wallet.updatedAt.toISOString()
  };
}

function parseRequestedAmount(amount: string | undefined, decimals: number): { raw: string; formatted: string } {
  if (!amount) throw unprocessable("amount_required", "Amount is required for direct treasury deposit requests");
  const [, fractional = ""] = amount.split(".");
  if (fractional.length > decimals) throw unprocessable("invalid_amount", `Amount must fit the token decimal precision of ${decimals}`);
  try {
    const raw = parseTokenAmount(amount, decimals);
    if (raw <= 0n) throw new Error("Amount must be greater than zero");
    return { raw: raw.toString(10), formatted: formatTokenAmount(raw, decimals) };
  } catch {
    throw unprocessable("invalid_amount", "Amount must be a positive decimal string");
  }
}

function safeBigIntDifference(left: string, right: string): string | null {
  try { return (BigInt(left) - BigInt(right)).toString(10); } catch { return null; }
}
