import type { NetworkConfig, TokenConfig } from "../config/networks.js";
import type { NetworkSlug, TokenSymbol } from "../types/domain.js";

export interface TokenTransferLog {
  network: NetworkSlug;
  token: TokenSymbol;
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  blockHash: string | null;
  from: string;
  to: string;
  value: bigint;
}

export interface TransactionReceiptSummary {
  status: "success" | "reverted";
  blockNumber: bigint;
}

export interface ChainProvider {
  getLatestBlockNumber(network: NetworkConfig): Promise<bigint>;
  getTransferLogs(network: NetworkConfig, token: TokenConfig, fromBlock: bigint, toBlock: bigint): Promise<TokenTransferLog[]>;
  getNativeBalance(network: NetworkConfig, address: string): Promise<bigint>;
  getTokenBalance(network: NetworkConfig, token: TokenConfig, address: string): Promise<bigint>;
  sendNativeTransfer(network: NetworkConfig, fromPrivateKey: string, to: string, value: bigint): Promise<string>;
  sendTokenTransfer(network: NetworkConfig, token: TokenConfig, fromPrivateKey: string, to: string, value: bigint): Promise<string>;
  getTransactionReceipt(network: NetworkConfig, txHash: string): Promise<TransactionReceiptSummary | null>;
}
