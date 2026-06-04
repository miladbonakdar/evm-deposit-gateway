import { isAddress, type Address, type Chain, type Hex } from "viem";
import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  bsc,
  bscTestnet,
  mainnet,
  optimism,
  optimismSepolia,
  polygon,
  polygonAmoy,
  sepolia
} from "viem/chains";
import { z } from "zod";
import { badRequest } from "../errors.js";
import { networkSlugs, tokenSymbols, type NetworkSlug, type TokenSymbol } from "../types/domain.js";

export interface TokenConfig {
  symbol: TokenSymbol;
  contractAddress: Address;
  decimals: number;
}

export interface NetworkConfig {
  slug: NetworkSlug;
  chain: Chain;
  rpcUrl: string;
  confirmations: number;
  scanFromBlock: bigint;
  maxScanBlocks: bigint;
  gasWalletPrivateKey?: Hex;
  minGasWei: bigint;
  gasTopUpWei: bigint;
  tokens: Record<TokenSymbol, TokenConfig | undefined>;
}

export type SupportedNetworks = Record<NetworkSlug, NetworkConfig | undefined>;

const chainBySlug = {
  ethereum: mainnet,
  bsc,
  polygon,
  arbitrum,
  optimism,
  base,
  sepolia,
  bscTestnet,
  polygonAmoy,
  arbitrumSepolia,
  optimismSepolia,
  baseSepolia
} satisfies Record<NetworkSlug, Chain>;

const envSuffixBySlug = {
  ethereum: "ETHEREUM",
  bsc: "BSC",
  polygon: "POLYGON",
  arbitrum: "ARBITRUM",
  optimism: "OPTIMISM",
  base: "BASE",
  sepolia: "SEPOLIA",
  bscTestnet: "BSC_TESTNET",
  polygonAmoy: "POLYGON_AMOY",
  arbitrumSepolia: "ARBITRUM_SEPOLIA",
  optimismSepolia: "OPTIMISM_SEPOLIA",
  baseSepolia: "BASE_SEPOLIA"
} satisfies Record<NetworkSlug, string>;

const upperSlug = (network: NetworkSlug): string => envSuffixBySlug[network];

function parseBigIntEnv(env: NodeJS.ProcessEnv, key: string, fallback: bigint): bigint {
  const raw = env[key];
  if (!raw) {
    return fallback;
  }

  if (!/^\d+$/.test(raw)) {
    throw new Error(`${key} must be an unsigned integer string`);
  }

  return BigInt(raw);
}

function parseNumberEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${key} must be a non-negative integer`);
  }

  return parsed;
}

function parseToken(env: NodeJS.ProcessEnv, network: NetworkSlug, token: TokenSymbol): TokenConfig | undefined {
  const suffix = upperSlug(network);
  const address = env[`${token}_CONTRACT_${suffix}`];
  const decimalsRaw = env[`${token}_DECIMALS_${suffix}`];

  if (!address) {
    return undefined;
  }

  if (!isAddress(address)) {
    throw new Error(`${token}_CONTRACT_${suffix} must be a valid EVM address`);
  }

  if (!decimalsRaw) {
    throw new Error(`${token}_DECIMALS_${suffix} is required when ${token}_CONTRACT_${suffix} is set`);
  }

  const decimals = Number(decimalsRaw);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(`${token}_DECIMALS_${suffix} must be an integer from 0 to 36`);
  }

  return { symbol: token, contractAddress: address, decimals };
}

export function loadSupportedNetworks(env: NodeJS.ProcessEnv = process.env): SupportedNetworks {
  const networks = {} as SupportedNetworks;

  for (const network of networkSlugs) {
    const suffix = upperSlug(network);
    const rpcUrl = env[`RPC_URL_${suffix}`];

    if (!rpcUrl) {
      networks[network] = undefined;
      continue;
    }

    const tokens = {} as Record<TokenSymbol, TokenConfig | undefined>;
    for (const token of tokenSymbols) {
      tokens[token] = parseToken(env, network, token);
    }

    if (!tokens.USDT && !tokens.USDC) {
      throw new Error(`At least one token contract must be set when RPC_URL_${suffix} is set`);
    }

    const gasWalletPrivateKey = env[`GAS_WALLET_PRIVATE_KEY_${suffix}`] as Hex | undefined;
    if (gasWalletPrivateKey && !/^0x[a-fA-F0-9]{64}$/.test(gasWalletPrivateKey)) {
      throw new Error(`GAS_WALLET_PRIVATE_KEY_${suffix} must be a 0x-prefixed 32-byte private key`);
    }

    networks[network] = {
      slug: network,
      chain: chainBySlug[network],
      rpcUrl,
      confirmations: parseNumberEnv(env, `CONFIRMATIONS_${suffix}`, 12),
      scanFromBlock: parseBigIntEnv(env, `SCAN_FROM_BLOCK_${suffix}`, 0n),
      maxScanBlocks: parseBigIntEnv(env, `MAX_SCAN_BLOCKS_${suffix}`, 1000n),
      gasWalletPrivateKey,
      minGasWei: parseBigIntEnv(env, `MIN_GAS_WEI_${suffix}`, 2_000_000_000_000_000n),
      gasTopUpWei: parseBigIntEnv(env, `GAS_TOPUP_WEI_${suffix}`, 5_000_000_000_000_000n),
      tokens
    };
  }

  return networks;
}

export const networkSchema = z.enum(networkSlugs);
export const tokenSchema = z.enum(tokenSymbols);

export function assertEnabledToken(
  supportedNetworks: SupportedNetworks,
  network: NetworkSlug,
  token: TokenSymbol
): { network: NetworkConfig; token: TokenConfig } {
  const networkConfig = supportedNetworks[network];
  const tokenConfig = networkConfig?.tokens[token];

  if (!networkConfig || !tokenConfig) {
    throw badRequest("unsupported_network_token", `${token} on ${network} is not enabled`);
  }

  return { network: networkConfig, token: tokenConfig };
}

export function enabledNetworks(supportedNetworks: SupportedNetworks): NetworkConfig[] {
  return Object.values(supportedNetworks).filter((network): network is NetworkConfig => Boolean(network));
}

export function enabledTokens(network: NetworkConfig): TokenConfig[] {
  return Object.values(network.tokens).filter((token): token is TokenConfig => Boolean(token));
}
