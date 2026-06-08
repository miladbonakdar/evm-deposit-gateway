import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { TronWeb } from "tronweb";
import type { NetworkKind } from "../config/networks.js";
import type { NetworkSlug, OperationalWalletPurpose, TokenSymbol } from "../types/domain.js";

export interface GeneratedChainWallet {
  address: string;
  privateKey: string;
}

export async function generateChainWallet(kind: NetworkKind): Promise<GeneratedChainWallet> {
  if (kind === "evm") {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    return { address: account.address, privateKey };
  }
  const account = await TronWeb.createAccount();
  return { address: account.address.base58, privateKey: account.privateKey };
}

export function privateKeyToChainAddress(kind: NetworkKind, privateKey: string): string {
  if (kind === "evm") return privateKeyToAccount(privateKey as `0x${string}`).address;
  const normalizedPrivateKey = privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey;
  const address = TronWeb.address.fromPrivateKey(normalizedPrivateKey);
  if (!address) throw new Error("Invalid TRON private key");
  return address;
}

export function operationalWalletScopeKey(
  purpose: OperationalWalletPurpose,
  merchantId: string | null,
  network: NetworkSlug,
  token: TokenSymbol | null
): string {
  return [purpose, merchantId ?? "platform", network, token ?? "native"].join(":");
}
