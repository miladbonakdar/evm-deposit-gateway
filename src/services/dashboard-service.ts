import { assertEnabledToken, enabledNetworks, enabledTokens, type SupportedNetworks } from "../config/networks.js";
import { badRequest, notFound, unprocessable } from "../errors.js";
import type { Encryptor } from "../security/encryption.js";
import type {
  Merchant,
  NetworkSlug,
  OperationalWallet,
  TokenSymbol,
  TokenTransfer,
  TreasuryWallet,
  WebhookEvent,
  WalletTransaction,
  WalletTransactionAsset
} from "../types/domain.js";
import { formatTokenAmount, parseTokenAmount } from "../utils/amount.js";
import { normalizeAddress } from "../utils/address.js";
import { newId } from "../utils/id.js";
import { generateChainWallet, operationalWalletScopeKey } from "../utils/wallet.js";
import type { Repository } from "../repositories/repository.js";
import type { ChainProvider } from "../worker/chain-provider.js";

interface GenerateGasWalletInput {
  network: NetworkSlug;
  label?: string;
}

interface GenerateTreasuryWalletInput {
  merchantId: string;
  network: NetworkSlug;
  token: TokenSymbol;
  label?: string;
}

interface RegisterTreasuryWalletInput {
  merchantId: string;
  network: NetworkSlug;
  token: TokenSymbol;
  address: string;
}

interface CreateWalletTransactionInput {
  sourceWalletId: string;
  asset: WalletTransactionAsset;
  toAddress: string;
  amount: string;
}

export class DashboardService {
  constructor(
    private readonly repo: Repository,
    private readonly encryptor: Encryptor,
    private readonly networks: SupportedNetworks,
    private readonly chainProvider: ChainProvider
  ) {}

  async getOverview() {
    const [merchants, depositAddresses, deposits, gasTopUps, sweeps, walletTransactions, webhooks, operationalWallets] =
      await Promise.all([
        this.repo.listMerchants(250),
        this.repo.listDepositAddresses({ limit: 500 }),
        this.repo.listTokenTransfers({ limit: 500 }),
        this.repo.listGasTopUps(200),
        this.repo.listSweeps(200),
        this.repo.listWalletTransactions(200),
        this.repo.listWebhookEvents(200),
        this.repo.listOperationalWallets({ includeDisabled: false, limit: 250 })
      ]);

    return {
      stats: {
        merchants: merchants.length,
        activeDepositAddresses: depositAddresses.filter((address) => address.status === "active").length,
        confirmedDeposits: deposits.filter((deposit) => deposit.status === "confirmed").length,
        pendingWebhooks: webhooks.filter((event) => event.status === "pending").length,
        operationalWallets: operationalWallets.length,
        submittedWalletTransactions: walletTransactions.filter((transaction) => transaction.status === "submitted").length
      },
      recentDeposits: deposits.slice(0, 12).map(publicTransferForDashboard),
      recentWalletTransactions: walletTransactions.slice(0, 12).map(publicWalletTransaction),
      recentWebhooks: webhooks.slice(0, 12).map(publicWebhookEvent)
    };
  }

  async listDashboardData(limit: number) {
    const [merchants, treasuryWallets, operationalWallets, depositAddresses, deposits, gasTopUps, sweeps, walletTransactions, webhooks] =
      await Promise.all([
        this.repo.listMerchants(limit),
        this.repo.listTreasuryWallets(undefined, limit),
        this.repo.listOperationalWallets({ includeDisabled: false, limit }),
        this.repo.listDepositAddresses({ limit }),
        this.repo.listTokenTransfers({ limit }),
        this.repo.listGasTopUps(limit),
        this.repo.listSweeps(limit),
        this.repo.listWalletTransactions(limit),
        this.repo.listWebhookEvents(limit)
      ]);

    return {
      merchants: merchants.map(publicMerchant),
      networks: enabledNetworks(this.networks).map((network) => ({
        network: network.slug,
        kind: network.kind,
        chainId: network.chainId ?? null,
        confirmations: network.confirmations,
        tokens: enabledTokens(network).map((token) => ({
          symbol: token.symbol,
          contractAddress: token.contractAddress,
          decimals: token.decimals
        }))
      })),
      treasuryWallets: treasuryWallets.map(publicTreasuryWallet),
      operationalWallets: operationalWallets.map(publicOperationalWallet),
      depositAddresses: depositAddresses.map((address) => ({
        id: address.id,
        merchantId: address.merchantId,
        network: address.network,
        token: address.token,
        address: address.address,
        status: address.status,
        externalId: address.externalId,
        expiresAt: address.expiresAt.toISOString(),
        createdAt: address.createdAt.toISOString()
      })),
      deposits: deposits.map(publicTransferForDashboard),
      gasTopUps: gasTopUps.map((topUp) => ({
        id: topUp.id,
        transferId: topUp.transferId,
        merchantId: topUp.merchantId,
        depositAddressId: topUp.depositAddressId,
        network: topUp.network,
        txHash: topUp.txHash,
        amountWei: topUp.amountWei,
        status: topUp.status,
        failureReason: topUp.failureReason,
        createdAt: topUp.createdAt.toISOString(),
        confirmedAt: topUp.confirmedAt?.toISOString() ?? null
      })),
      sweeps: sweeps.map((sweep) => ({
        id: sweep.id,
        transferId: sweep.transferId,
        merchantId: sweep.merchantId,
        depositAddressId: sweep.depositAddressId,
        network: sweep.network,
        token: sweep.token,
        txHash: sweep.txHash,
        amountRaw: sweep.amountRaw,
        amountFormatted: sweep.amountFormatted,
        toAddress: sweep.toAddress,
        status: sweep.status,
        failureReason: sweep.failureReason,
        createdAt: sweep.createdAt.toISOString(),
        confirmedAt: sweep.confirmedAt?.toISOString() ?? null
      })),
      walletTransactions: walletTransactions.map(publicWalletTransaction),
      webhooks: webhooks.map(publicWebhookEvent)
    };
  }

  async generateGasWallet(input: GenerateGasWalletInput) {
    const network = this.networks[input.network];
    if (!network) {
      throw badRequest("unsupported_network", `${input.network} is not enabled`);
    }

    const generated = await generateChainWallet(network.kind);
    const address = normalizeAddress(network, generated.address);
    const wallet = await this.repo.upsertOperationalWallet({
      id: newId(),
      scopeKey: operationalWalletScopeKey("gas", null, network.slug, null),
      merchantId: null,
      purpose: "gas",
      network: network.slug,
      token: null,
      address,
      privateKeyEncrypted: this.encryptor.encryptString(generated.privateKey),
      label: input.label ?? `${network.slug} gas wallet`
    });

    return publicOperationalWallet(wallet);
  }

  async generateTreasuryWallet(input: GenerateTreasuryWalletInput) {
    const merchant = await this.assertMerchant(input.merchantId);
    const { network } = assertEnabledToken(this.networks, input.network, input.token);
    const generated = await generateChainWallet(network.kind);
    const address = normalizeAddress(network, generated.address);
    const scopeKey = operationalWalletScopeKey("treasury", merchant.id, network.slug, input.token);

    const wallet = await this.repo.upsertOperationalWallet({
      id: newId(),
      scopeKey,
      merchantId: merchant.id,
      purpose: "treasury",
      network: network.slug,
      token: input.token,
      address,
      privateKeyEncrypted: this.encryptor.encryptString(generated.privateKey),
      label: input.label ?? `${merchant.name} ${network.slug} ${input.token} treasury`
    });
    const treasuryWallet = await this.repo.upsertTreasuryWallet({
      id: newId(),
      merchantId: merchant.id,
      network: network.slug,
      token: input.token,
      address
    });

    return {
      operationalWallet: publicOperationalWallet(wallet),
      treasuryWallet: publicTreasuryWallet(treasuryWallet)
    };
  }

  async registerTreasuryWallet(input: RegisterTreasuryWalletInput) {
    const merchant = await this.assertMerchant(input.merchantId);
    const { network } = assertEnabledToken(this.networks, input.network, input.token);
    const address = normalizeAddress(network, input.address);
    const wallet = await this.repo.upsertTreasuryWallet({
      id: newId(),
      merchantId: merchant.id,
      network: network.slug,
      token: input.token,
      address
    });
    return publicTreasuryWallet(wallet);
  }

  async createWalletTransaction(input: CreateWalletTransactionInput) {
    const sourceWallet = await this.repo.getOperationalWallet(input.sourceWalletId);
    if (!sourceWallet || sourceWallet.status !== "active") {
      throw notFound("source_wallet_not_found", "Source wallet was not found");
    }

    const network = this.networks[sourceWallet.network];
    if (!network) {
      throw badRequest("unsupported_network", `${sourceWallet.network} is not enabled`);
    }

    if (sourceWallet.purpose === "gas" && input.asset !== "NATIVE") {
      throw unprocessable("unsupported_wallet_asset", "Gas wallets can only send the native gas asset");
    }

    if (sourceWallet.purpose === "treasury" && input.asset !== "NATIVE" && sourceWallet.token !== input.asset) {
      throw unprocessable("unsupported_wallet_asset", `This treasury wallet is configured for ${sourceWallet.token}`);
    }

    const toAddress = normalizeAddress(network, input.toAddress);
    const privateKey = this.encryptor.decryptString(sourceWallet.privateKeyEncrypted);
    const amount = input.asset === "NATIVE"
      ? parseTokenAmount(input.amount, nativeDecimals(network.kind))
      : parseTokenAmount(input.amount, assertEnabledToken(this.networks, sourceWallet.network, input.asset).token.decimals);

    if (amount <= 0n) {
      throw badRequest("invalid_amount", "Amount must be greater than zero");
    }

    const tokenConfig = input.asset === "NATIVE" ? null : assertEnabledToken(this.networks, sourceWallet.network, input.asset).token;
    const amountFormatted = input.asset === "NATIVE"
      ? formatTokenAmount(amount, nativeDecimals(network.kind))
      : formatTokenAmount(amount, tokenConfig?.decimals ?? 0);

    try {
      const txHash = input.asset === "NATIVE"
        ? await this.chainProvider.sendNativeTransfer(network, privateKey, toAddress, amount)
        : await this.chainProvider.sendTokenTransfer(network, tokenConfig as NonNullable<typeof tokenConfig>, privateKey, toAddress, amount);

      const transaction = await this.repo.createWalletTransaction({
        id: newId(),
        merchantId: sourceWallet.merchantId,
        sourceWalletId: sourceWallet.id,
        network: sourceWallet.network,
        token: input.asset === "NATIVE" ? null : input.asset,
        asset: input.asset,
        txHash,
        fromAddress: sourceWallet.address,
        toAddress,
        amountRaw: amount.toString(10),
        amountFormatted,
        status: "submitted"
      });
      return publicWalletTransaction(transaction);
    } catch (error) {
      const transaction = await this.repo.createWalletTransaction({
        id: newId(),
        merchantId: sourceWallet.merchantId,
        sourceWalletId: sourceWallet.id,
        network: sourceWallet.network,
        token: input.asset === "NATIVE" ? null : input.asset,
        asset: input.asset,
        txHash: null,
        fromAddress: sourceWallet.address,
        toAddress,
        amountRaw: amount.toString(10),
        amountFormatted,
        status: "failed",
        failureReason: error instanceof Error ? error.message : "Wallet transaction failed"
      });
      return publicWalletTransaction(transaction);
    }
  }

  private async assertMerchant(merchantId: string): Promise<Merchant> {
    const merchant = await this.repo.getMerchant(merchantId);
    if (!merchant || merchant.status !== "active") {
      throw notFound("merchant_not_found", "Merchant was not found");
    }
    return merchant;
  }
}

function nativeDecimals(kind: "evm" | "tron"): number {
  return kind === "tron" ? 6 : 18;
}

function publicMerchant(merchant: Merchant) {
  return {
    id: merchant.id,
    name: merchant.name,
    status: merchant.status,
    createdAt: merchant.createdAt.toISOString(),
    updatedAt: merchant.updatedAt.toISOString()
  };
}

function publicTreasuryWallet(wallet: TreasuryWallet) {
  return {
    id: wallet.id,
    merchantId: wallet.merchantId,
    network: wallet.network,
    token: wallet.token,
    address: wallet.address,
    createdAt: wallet.createdAt.toISOString(),
    updatedAt: wallet.updatedAt.toISOString()
  };
}

function publicOperationalWallet(wallet: OperationalWallet) {
  return {
    id: wallet.id,
    merchantId: wallet.merchantId,
    purpose: wallet.purpose,
    network: wallet.network,
    token: wallet.token,
    address: wallet.address,
    label: wallet.label,
    status: wallet.status,
    hasStoredPrivateKey: true,
    createdAt: wallet.createdAt.toISOString(),
    updatedAt: wallet.updatedAt.toISOString()
  };
}

function publicTransferForDashboard(transfer: TokenTransfer) {
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
    blockHash: transfer.blockHash,
    confirmations: transfer.confirmations,
    status: transfer.status,
    detectedAt: transfer.detectedAt.toISOString(),
    confirmedAt: transfer.confirmedAt?.toISOString() ?? null
  };
}

function publicWalletTransaction(transaction: WalletTransaction) {
  return {
    id: transaction.id,
    merchantId: transaction.merchantId,
    sourceWalletId: transaction.sourceWalletId,
    network: transaction.network,
    token: transaction.token,
    asset: transaction.asset,
    txHash: transaction.txHash,
    fromAddress: transaction.fromAddress,
    toAddress: transaction.toAddress,
    amountRaw: transaction.amountRaw,
    amountFormatted: transaction.amountFormatted,
    status: transaction.status,
    failureReason: transaction.failureReason,
    createdAt: transaction.createdAt.toISOString(),
    confirmedAt: transaction.confirmedAt?.toISOString() ?? null
  };
}

function publicWebhookEvent(event: WebhookEvent) {
  return {
    id: event.id,
    merchantId: event.merchantId,
    type: event.type,
    url: event.url,
    payload: event.payload,
    status: event.status,
    attempts: event.attempts,
    lastError: event.lastError,
    responseStatus: event.responseStatus,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
    nextAttemptAt: event.nextAttemptAt.toISOString(),
    sentAt: event.sentAt?.toISOString() ?? null
  };
}
