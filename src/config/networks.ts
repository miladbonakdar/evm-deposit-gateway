import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAddress, isAddress, type Chain } from "viem";
import {
  arbitrum,
  arbitrumSepolia,
  avalancheFuji,
  base,
  baseSepolia,
  bsc,
  bscTestnet,
  lineaSepolia,
  mainnet,
  optimism,
  optimismSepolia,
  polygon,
  polygonAmoy,
  scrollSepolia,
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
  baseSepolia,
  avalancheFuji,
  lineaSepolia,
  scrollSepolia
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
  avalancheFuji: "evm",
  lineaSepolia: "evm",
  scrollSepolia: "evm",
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
  avalancheFuji: "AVALANCHE_FUJI",
  lineaSepolia: "LINEA_SEPOLIA",
  scrollSepolia: "SCROLL_SEPOLIA",
  tron: "TRON",
  nile: "NILE"
} satisfies Record<NetworkSlug, string>;

const upperSlug = (network: NetworkSlug): string => envSuffixBySlug[network];

const unsignedIntegerValueSchema = z
  .union([z.string(), z.number().int().nonnegative()])
  .transform((value) => String(value).trim())
  .refine((value) => /^\d+$/.test(value), "must be an unsigned integer string");

const configuredTokenSchema = z
  .object({
    contractAddress: z.string().trim().optional(),
    decimals: z.number().int().min(0).max(36).optional()
  })
  .strict();

const configuredNetworkSchema = z
  .object({
    confirmations: z.number().int().nonnegative().optional(),
    scanFromBlock: unsignedIntegerValueSchema.optional(),
    maxScanBlocks: unsignedIntegerValueSchema.optional(),
    minGasWei: unsignedIntegerValueSchema.optional(),
    gasTopUpWei: unsignedIntegerValueSchema.optional(),
    tokens: z
      .object({
        USDT: configuredTokenSchema.optional(),
        USDC: configuredTokenSchema.optional()
      })
      .strict()
      .optional()
  })
  .strict();

const networkBusinessConfigSchema = z
  .object({
    networks: z.record(z.enum(networkSlugs), configuredNetworkSchema).default({})
  })
  .strict();

export type NetworkBusinessConfig = z.infer<typeof networkBusinessConfigSchema>;
export type NetworkBusinessConfigInput = NetworkBusinessConfig | string;

function formatZodIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ");
}

export function loadNetworkBusinessConfig(configPath = "config/networks.example.json"): NetworkBusinessConfig {
  const resolvedPath = resolve(process.cwd(), configPath);
  let raw: string;

  try {
    raw = readFileSync(resolvedPath, "utf8");
  } catch (error) {
    throw new Error(`Unable to read network config at ${configPath}: ${(error as Error).message}`);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Unable to parse network config at ${configPath}: ${(error as Error).message}`);
  }

  const parsed = networkBusinessConfigSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error(`Invalid network config at ${configPath}: ${formatZodIssues(parsed.error)}`);
  }

  return parsed.data;
}

function resolveNetworkBusinessConfig(input?: NetworkBusinessConfigInput): NetworkBusinessConfig {
  if (!input || typeof input === "string") {
    return loadNetworkBusinessConfig(input);
  }

  const parsed = networkBusinessConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid network config: ${formatZodIssues(parsed.error)}`);
  }

  return parsed.data;
}

function parseBigIntConfig(raw: string | undefined, fallback: bigint): bigint {
  return raw === undefined ? fallback : BigInt(raw);
}

function parseNumberConfig(raw: number | undefined, fallback: number): number {
  return raw === undefined ? fallback : raw;
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
  configuredNetwork: z.infer<typeof configuredNetworkSchema> | undefined,
  network: NetworkSlug,
  kind: NetworkKind,
  token: TokenSymbol
): TokenConfig | undefined {
  const configKey = `networks.${network}.tokens.${token}`;
  const tokenConfig = configuredNetwork?.tokens?.[token];
  if (!tokenConfig) {
    return undefined;
  }

  const address = tokenConfig.contractAddress?.trim();

  if (!address) {
    return undefined;
  }

  if (tokenConfig.decimals === undefined) {
    throw new Error(`${configKey}.decimals is required when ${configKey}.contractAddress is set`);
  }

  return {
    symbol: token,
    contractAddress: normalizeConfiguredAddress(kind, address, `${configKey}.contractAddress`),
    decimals: tokenConfig.decimals
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

export function loadSupportedNetworks(
  env: NodeJS.ProcessEnv = process.env,
  configInput: NetworkBusinessConfigInput = env.NETWORK_CONFIG_PATH ?? "config/networks.example.json"
): SupportedNetworks {
  const businessConfig = resolveNetworkBusinessConfig(configInput);
  const networks = {} as SupportedNetworks;

  for (const network of networkSlugs) {
    const suffix = upperSlug(network);
    const rpcUrl = env[`RPC_URL_${suffix}`];
    const kind = kindBySlug[network];

    if (!rpcUrl) {
      networks[network] = undefined;
      continue;
    }

    const configuredNetwork = businessConfig.networks[network];
    if (!configuredNetwork) {
      throw new Error(`networks.${network} must be configured when RPC_URL_${suffix} is set`);
    }

    const tokens = {} as Record<TokenSymbol, TokenConfig | undefined>;
    for (const token of tokenSymbols) {
      tokens[token] = parseToken(configuredNetwork, network, kind, token);
    }

    if (!tokens.USDT && !tokens.USDC) {
      throw new Error(`At least one token contract must be configured for networks.${network} when RPC_URL_${suffix} is set`);
    }

    const gasWalletPrivateKey = env[`GAS_WALLET_PRIVATE_KEY_${suffix}`] || undefined;
    validateGasPrivateKey(kind, suffix, gasWalletPrivateKey);

    const chain = chainBySlug[network];
    networks[network] = {
      slug: network,
      kind,
      chain,
      chainId: chain?.id,
      rpcUrl,
      eventServerUrl: env[`EVENT_SERVER_URL_${suffix}`] || undefined,
      confirmations: parseNumberConfig(configuredNetwork.confirmations, kind === "tron" ? 20 : 12),
      scanFromBlock: parseBigIntConfig(configuredNetwork.scanFromBlock, 0n),
      maxScanBlocks: parseBigIntConfig(configuredNetwork.maxScanBlocks, kind === "tron" ? 500n : 1000n),
      gasWalletPrivateKey,
      minGasWei: parseBigIntConfig(configuredNetwork.minGasWei, kind === "tron" ? 5_000_000n : 2_000_000_000_000_000n),
      gasTopUpWei: parseBigIntConfig(configuredNetwork.gasTopUpWei, kind === "tron" ? 10_000_000n : 5_000_000_000_000_000n),
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
