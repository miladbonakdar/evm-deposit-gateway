import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  parseAbiItem,
  type Address,
  type Hex,
  type Log
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { NetworkConfig, TokenConfig } from "../config/networks.js";
import type { NetworkSlug, TokenSymbol } from "../types/domain.js";

export interface Erc20TransferLog {
  network: NetworkSlug;
  token: TokenSymbol;
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockHash: Hex | null;
  from: Address;
  to: Address;
  value: bigint;
}

export interface TransactionReceiptSummary {
  status: "success" | "reverted";
  blockNumber: bigint;
}

export interface EvmProvider {
  getLatestBlockNumber(network: NetworkConfig): Promise<bigint>;
  getTransferLogs(network: NetworkConfig, token: TokenConfig, fromBlock: bigint, toBlock: bigint): Promise<Erc20TransferLog[]>;
  getNativeBalance(network: NetworkConfig, address: Address): Promise<bigint>;
  getTokenBalance(network: NetworkConfig, token: TokenConfig, address: Address): Promise<bigint>;
  sendNativeTransfer(network: NetworkConfig, fromPrivateKey: Hex, to: Address, value: bigint): Promise<Hex>;
  sendTokenTransfer(network: NetworkConfig, token: TokenConfig, fromPrivateKey: Hex, to: Address, value: bigint): Promise<Hex>;
  getTransactionReceipt(network: NetworkConfig, txHash: Hex): Promise<TransactionReceiptSummary | null>;
}

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

export class ViemEvmProvider implements EvmProvider {
  private publicClient(network: NetworkConfig) {
    return createPublicClient({
      chain: network.chain,
      transport: http(network.rpcUrl)
    });
  }

  private walletClient(network: NetworkConfig, privateKey: Hex) {
    const account = privateKeyToAccount(privateKey);
    return {
      account,
      client: createWalletClient({
        account,
        chain: network.chain,
        transport: http(network.rpcUrl)
      })
    };
  }

  async getLatestBlockNumber(network: NetworkConfig): Promise<bigint> {
    return this.publicClient(network).getBlockNumber();
  }

  async getTransferLogs(
    network: NetworkConfig,
    token: TokenConfig,
    fromBlock: bigint,
    toBlock: bigint
  ): Promise<Erc20TransferLog[]> {
    const logs = (await this.publicClient(network).getLogs({
      address: token.contractAddress,
      event: transferEvent,
      fromBlock,
      toBlock
    })) as Log<bigint, number, false, typeof transferEvent, true>[];

    return logs
      .filter((log) => log.args.from && log.args.to && log.args.value !== undefined && log.transactionHash)
      .map((log) => ({
        network: network.slug,
        token: token.symbol,
        txHash: log.transactionHash as Hex,
        logIndex: log.logIndex,
        blockNumber: log.blockNumber,
        blockHash: log.blockHash,
        from: log.args.from as Address,
        to: log.args.to as Address,
        value: log.args.value as bigint
      }));
  }

  async getNativeBalance(network: NetworkConfig, address: Address): Promise<bigint> {
    return this.publicClient(network).getBalance({ address });
  }

  async getTokenBalance(network: NetworkConfig, token: TokenConfig, address: Address): Promise<bigint> {
    return this.publicClient(network).readContract({
      address: token.contractAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address]
    });
  }

  async sendNativeTransfer(network: NetworkConfig, fromPrivateKey: Hex, to: Address, value: bigint): Promise<Hex> {
    const { account, client } = this.walletClient(network, fromPrivateKey);
    return client.sendTransaction({ account, to, value });
  }

  async sendTokenTransfer(
    network: NetworkConfig,
    token: TokenConfig,
    fromPrivateKey: Hex,
    to: Address,
    value: bigint
  ): Promise<Hex> {
    const { account, client } = this.walletClient(network, fromPrivateKey);
    return client.writeContract({
      account,
      address: token.contractAddress,
      abi: erc20Abi,
      functionName: "transfer",
      args: [to, value]
    });
  }

  async getTransactionReceipt(network: NetworkConfig, txHash: Hex): Promise<TransactionReceiptSummary | null> {
    const receipt = await this.publicClient(network)
      .getTransactionReceipt({ hash: txHash })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name.includes("NotFound")) {
          return null;
        }
        throw error;
      });

    if (!receipt) {
      return null;
    }

    return {
      status: receipt.status,
      blockNumber: receipt.blockNumber
    };
  }
}
