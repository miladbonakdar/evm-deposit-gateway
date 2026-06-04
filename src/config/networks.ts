import { getAddress, isAddress, type Chain } from "viem";
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
import { TronWeb } from "tronweb";
import { z } from "zod";
import { badRequest } from "../errors.js";
import { networkSlugs, tokenSymbols, type NetworkSlug, type TokenSymbol } from "../types/domain.js";

export type NetworkKind = "evm" | "tron";

export interface TokenConfig {
  symbol: TokenSymbol;
  contractAddress: string;
  decimals: number;
}

export interface NetworkConfig {
  slug: NetworkSlug;
  kind: NetworkKind;
  chain?: Chain;
  chainId?: number;
  rpcUrl: string;
  eventServerUrl?: string;
  confirmations: number;
  scanFromBlock: bigint;
  maxScanBlocks: bigint;
  gasWalletPrivateKey?: string;
  minGasWei: bigint;
  gasTopUpWei: bigint;
  tokens: Record<TokenSymbol, TokenConfig | undefined>;
}

export type SupportedNetworks = Record<NetworkSlug, NetworkConfig | undefined>;

const chainBySlug: Partial<Record<NetworkSlug, Chain>> = {
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
};

const kindBySlug = {
  ethereum: "evm",
  bsc: "evm",
  polygon: "evm",
  arbitrum: "evm",
  optimism: "evm",
  base: "evm",
  sepolia: "evm",
  bscTestnet: "evm",
  polygonAmoy: "evm",
  arbitrumSepolia: "evm",
  optimismSepolia: "evm",
  baseSepolia: "evm",
  tron: "tron",
  nile: "tron"
} satisfies Record<NetworkSlug, NetworkKind>;

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
  baseSepolia: "BASE_SEPOLIA",
  tron: "TRON",
  nile: "NILE"
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

function normalizeConfiguredAddress(kind: NetworkKind, address: string, envKey: string): string {
  if (kind === "evm") {
    if (!isAddress(address)) {
      throw new Error(`${envKey} must be a valid EVM address`);
    }

    return getAddress(address).toLowerCase();
  }

  const cleanAddress = address.startsWith("0x") ? address.slice(2) : address;
  if (/^41[a-fA-F0-9]{40}$/.test(cleanAddress)) {
    return TronWeb.address.fromHex(cleanAddress);
  }

  if (!TronWeb.isAddress(address)) {
    throw new Error(`${envKey} must be a valid TRON address`);
  }

  return address;
}

function parseToken(
  env: NodeJS.ProcessEnv,
  network: NetworkSlug,
  kind: NetworkKind,
  token: TokenSymbol
): TokenConfig | undefined {
  const suffix = upperSlug(network);
  const addressKey = `${token}_CONTRACT_${suffix}`;
  const decimalsKey = `${token}_DECIMALS_${suffix}`;
  const address = env[addressKey];
  const decimalsRaw = env[decimalsKey];

  if (!address) {
    return undefined;
  }

  if (!decimalsRaw) {
    throw new Error(`${decimalsKey} is required when ${addressKey} is set`);
  }

  const decimals = Number(decimalsRaw);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(`${decimalsKey} must be an integer from 0 to 36`);
  }

  return {
    symbol: token,
    contractAddress: normalizeConfiguredAddress(kind, address, addressKey),
    decimals
  };
}

function validateGasPrivateKey(kind: NetworkKind, suffix: string, privateKey: string | undefined): void {
  if (!privateKey) {
    return;
  }

  const valid = kind === "evm" ? /^0x[a-fA-F0-9]{64}$/.test(privateKey) : /^(0x)?[a-fA-F0-9]{64}$/.test(privateKey);

  if (!valid) {
    throw new Error(
      kind === "evm"
        ? `GAS_WALLET_PRIVATE_KEY_${suffix} must be a 0x-prefixed 32-byte private key`
        : `GAS_WALLET_PRIVATE_KEY_${suffix} must be a 32-byte TRON private key, with or without 0x prefix`
    );
  }
}

export function loadSupportedNetworks(env: NodeJS.ProcessEnv = process.env): SupportedNetworks {
  const networks = {} as SupportedNetworks;

  for (const network of networkSlugs) {
    const suffix = upperSlug(network);
    const rpcUrl = env[`RPC_URL_${suffix}`];
    const kind = kindBySlug[network];

    if (!rpcUrl) {
      networks[network] = undefined;
      continue;
    }

    const tokens = {} as Record<TokenSymbol, TokenConfig | undefined>;
    for (const token of tokenSymbols) {
      tokens[token] = parseToken(env, network, kind, token);
    }

    if (!tokens.USDT && !tokens.USDC) {
      throw new Error(`At least one token contract must be set when RPC_URL_${suffix} is set`);
    }

    const gasWalletPrivateKey = env[`GAS_WALLET_PRIVATE_KEY_${suffix}`];
    validateGasPrivateKey(kind, suffix, gasWalletPrivateKey);

    const chain = chainBySlug[network];
    networks[network] = {
      slug: network,
      kind,
      chain,
      chainId: chain?.id,
      rpcUrl,
      eventServerUrl: env[`EVENT_SERVER_URL_${suffix}`] || undefined,
      confirmations: parseNumberEnv(env, `CONFIRMATIONS_${suffix}`, kind === "tron" ? 20 : 12),
      scanFromBlock: parseBigIntEnv(env, `SCAN_FROM_BLOCK_${suffix}`, 0n),
      maxScanBlocks: parseBigIntEnv(env, `MAX_SCAN_BLOCKS_${suffix}`, kind === "tron" ? 500n : 1000n),
      gasWalletPrivateKey,
      minGasWei: parseBigIntEnv(env, `MIN_GAS_WEI_${suffix}`, kind === "tron" ? 5_000_000n : 2_000_000_000_000_000n),
      gasTopUpWei: parseBigIntEnv(env, `GAS_TOPUP_WEI_${suffix}`, kind === "tron" ? 10_000_000n : 5_000_000_000_000_000n),
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
