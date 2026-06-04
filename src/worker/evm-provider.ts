import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  parseAbiItem,
  type Address,
  type Log
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { NetworkConfig, TokenConfig } from "../config/networks.js";
import type { ChainProvider, TokenTransferLog, TransactionReceiptSummary } from "./chain-provider.js";

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

export class ViemEvmProvider implements ChainProvider {
  private publicClient(network: NetworkConfig) {
    if (network.kind !== "evm" || !network.chain) {
      throw new Error(`${network.slug} is not an EVM network`);
    }

    return createPublicClient({
      chain: network.chain,
      transport: http(network.rpcUrl)
    });
  }

  private walletClient(network: NetworkConfig, privateKey: string) {
    if (network.kind !== "evm" || !network.chain) {
      throw new Error(`${network.slug} is not an EVM network`);
    }

    const account = privateKeyToAccount(privateKey as `0x${string}`);
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
  ): Promise<TokenTransferLog[]> {
    const logs = (await this.publicClient(network).getLogs({
      address: token.contractAddress as Address,
      event: transferEvent,
      fromBlock,
      toBlock
    })) as Log<bigint, number, false, typeof transferEvent, true>[];

    return logs
      .filter((log) => log.args.from && log.args.to && log.args.value !== undefined && log.transactionHash)
      .map((log) => ({
        network: network.slug,
        token: token.symbol,
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: log.blockNumber,
        blockHash: log.blockHash,
        from: log.args.from as string,
        to: log.args.to as string,
        value: log.args.value as bigint
      }));
  }

  async getNativeBalance(network: NetworkConfig, address: string): Promise<bigint> {
    return this.publicClient(network).getBalance({ address: address as Address });
  }

  async getTokenBalance(network: NetworkConfig, token: TokenConfig, address: string): Promise<bigint> {
    return this.publicClient(network).readContract({
      address: token.contractAddress as Address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address as Address]
    });
  }

  async sendNativeTransfer(network: NetworkConfig, fromPrivateKey: string, to: string, value: bigint): Promise<string> {
    const { account, client } = this.walletClient(network, fromPrivateKey);
    return client.sendTransaction({ account, to: to as Address, value });
  }

  async sendTokenTransfer(
    network: NetworkConfig,
    token: TokenConfig,
    fromPrivateKey: string,
    to: string,
    value: bigint
  ): Promise<string> {
    const { account, client } = this.walletClient(network, fromPrivateKey);
    return client.writeContract({
      account,
      address: token.contractAddress as Address,
      abi: erc20Abi,
      functionName: "transfer",
      args: [to as Address, value]
    });
  }

  async getTransactionReceipt(network: NetworkConfig, txHash: string): Promise<TransactionReceiptSummary | null> {
    const receipt = await this.publicClient(network)
      .getTransactionReceipt({ hash: txHash as `0x${string}` })
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
