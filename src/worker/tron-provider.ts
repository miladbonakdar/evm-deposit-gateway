import { TronWeb } from "tronweb";
import type { NetworkConfig, TokenConfig } from "../config/networks.js";
import { normalizeTronAddress } from "../utils/address.js";
import type { ChainProvider, TokenTransferLog, TransactionReceiptSummary } from "./chain-provider.js";

const trc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "value", type: "uint256" }
    ]
  }
] as const;

interface TronTransferEvent {
  block_number: number;
  event_index?: number;
  transaction_id: string;
  result?: Record<string, string>;
}

export class TronProvider implements ChainProvider {
  private client(network: NetworkConfig, privateKey?: string): TronWeb {
    if (network.kind !== "tron") {
      throw new Error(`${network.slug} is not a TRON network`);
    }

    return new TronWeb({
      fullHost: network.rpcUrl,
      eventServer: network.eventServerUrl ?? network.rpcUrl,
      privateKey: privateKey ? normalizeTronPrivateKey(privateKey) : undefined
    });
  }

  async getLatestBlockNumber(network: NetworkConfig): Promise<bigint> {
    const block = await this.client(network).trx.getCurrentBlock();
    const blockNumber = block.block_header?.raw_data?.number;
    if (typeof blockNumber !== "number") {
      throw new Error(`Unable to read latest TRON block number for ${network.slug}`);
    }

    return BigInt(blockNumber);
  }

  async getTransferLogs(
    network: NetworkConfig,
    token: TokenConfig,
    fromBlock: bigint,
    toBlock: bigint
  ): Promise<TokenTransferLog[]> {
    const tronWeb = this.client(network);
    const logs: TokenTransferLog[] = [];

    for (let block = fromBlock; block <= toBlock; block += 1n) {
      const response = await tronWeb.getEventResult(token.contractAddress, {
        eventName: "Transfer",
        blockNumber: Number(block),
        onlyConfirmed: true,
        limit: 200
      });

      if (!response.success || !response.data) {
        continue;
      }

      for (const event of response.data as TronTransferEvent[]) {
        const parsed = parseTransferEvent(event);
        if (!parsed) {
          continue;
        }

        logs.push({
          network: network.slug,
          token: token.symbol,
          txHash: event.transaction_id,
          logIndex: event.event_index ?? logs.length,
          blockNumber: BigInt(event.block_number),
          blockHash: null,
          from: parsed.from,
          to: parsed.to,
          value: parsed.value
        });
      }
    }

    return logs;
  }

  async getNativeBalance(network: NetworkConfig, address: string): Promise<bigint> {
    return BigInt(await this.client(network).trx.getBalance(normalizeTronAddress(address)));
  }

  async getTokenBalance(network: NetworkConfig, token: TokenConfig, address: string): Promise<bigint> {
    const contract = await this.client(network).contract(trc20Abi, token.contractAddress);
    const balance = await contract.balanceOf(normalizeTronAddress(address)).call();
    return BigInt(balance.toString());
  }

  async sendNativeTransfer(network: NetworkConfig, fromPrivateKey: string, to: string, value: bigint): Promise<string> {
    const tronWeb = this.client(network, fromPrivateKey);
    const result = await tronWeb.trx.sendTransaction(normalizeTronAddress(to), Number(value));

    if (!result.result) {
      throw new Error(result.message ? tronWeb.toUtf8(result.message) : "TRX transfer failed");
    }

    return result.txid;
  }

  async sendTokenTransfer(
    network: NetworkConfig,
    token: TokenConfig,
    fromPrivateKey: string,
    to: string,
    value: bigint
  ): Promise<string> {
    const tronWeb = this.client(network, fromPrivateKey);
    const contract = await tronWeb.contract(trc20Abi, token.contractAddress);
    return contract.transfer(normalizeTronAddress(to), value.toString()).send({
      feeLimit: 150_000_000,
      shouldPollResponse: false
    });
  }

  async getTransactionReceipt(network: NetworkConfig, txHash: string): Promise<TransactionReceiptSummary | null> {
    const info = await this.client(network).trx.getTransactionInfo(txHash).catch((error: unknown) => {
      if (error instanceof Error && /not found|does not exist/i.test(error.message)) {
        return null;
      }
      throw error;
    });

    if (!info?.id) {
      return null;
    }

    const reverted = info.result === "FAILED" || info.receipt?.result === "FAILED" || info.receipt?.result === "REVERT";
    return {
      status: reverted ? "reverted" : "success",
      blockNumber: BigInt(info.blockNumber)
    };
  }
}

function normalizeTronPrivateKey(privateKey: string): string {
  return privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey;
}

function parseTransferEvent(event: TronTransferEvent): { from: string; to: string; value: bigint } | null {
  const result = event.result;
  if (!result) {
    return null;
  }

  const from = result.from ?? result._from ?? result["0"];
  const to = result.to ?? result._to ?? result["1"];
  const rawValue = result.value ?? result._value ?? result["2"];

  if (!from || !to || rawValue === undefined) {
    return null;
  }

  return {
    from: normalizeTronAddress(from),
    to: normalizeTronAddress(to),
    value: BigInt(rawValue)
  };
}
