import type { NetworkConfig, TokenConfig } from "../config/networks.js";
import type { ChainProvider, TokenTransferLog, TransactionReceiptSummary } from "./chain-provider.js";

export class MultiChainProvider implements ChainProvider {
  constructor(
    private readonly evmProvider: ChainProvider,
    private readonly tronProvider: ChainProvider
  ) {}

  private provider(network: NetworkConfig): ChainProvider {
    return network.kind === "tron" ? this.tronProvider : this.evmProvider;
  }

  getLatestBlockNumber(network: NetworkConfig): Promise<bigint> {
    return this.provider(network).getLatestBlockNumber(network);
  }

  getTransferLogs(
    network: NetworkConfig,
    token: TokenConfig,
    fromBlock: bigint,
    toBlock: bigint
  ): Promise<TokenTransferLog[]> {
    return this.provider(network).getTransferLogs(network, token, fromBlock, toBlock);
  }

  getNativeBalance(network: NetworkConfig, address: string): Promise<bigint> {
    return this.provider(network).getNativeBalance(network, address);
  }

  getTokenBalance(network: NetworkConfig, token: TokenConfig, address: string): Promise<bigint> {
    return this.provider(network).getTokenBalance(network, token, address);
  }

  sendNativeTransfer(network: NetworkConfig, fromPrivateKey: string, to: string, value: bigint): Promise<string> {
    return this.provider(network).sendNativeTransfer(network, fromPrivateKey, to, value);
  }

  sendTokenTransfer(
    network: NetworkConfig,
    token: TokenConfig,
    fromPrivateKey: string,
    to: string,
    value: bigint
  ): Promise<string> {
    return this.provider(network).sendTokenTransfer(network, token, fromPrivateKey, to, value);
  }

  getTransactionReceipt(network: NetworkConfig, txHash: string): Promise<TransactionReceiptSummary | null> {
    return this.provider(network).getTransactionReceipt(network, txHash);
  }
}
