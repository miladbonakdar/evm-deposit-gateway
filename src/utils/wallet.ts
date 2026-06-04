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

export function operationalWalletScopeKey(
  purpose: OperationalWalletPurpose,
  merchantId: string | null,
  network: NetworkSlug,
  token: TokenSymbol | null
): string {
  return [purpose, merchantId ?? "platform", network, token ?? "native"].join(":");
}
