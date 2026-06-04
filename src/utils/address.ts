import { getAddress, isAddress, type Address } from "viem";
import { TronWeb } from "tronweb";
import type { NetworkConfig } from "../config/networks.js";
import { badRequest } from "../errors.js";

export function normalizeEvmAddress(address: string): Address {
  if (!isAddress(address)) {
    throw badRequest("invalid_address", "Expected a valid EVM address");
  }

  return getAddress(address).toLowerCase() as Address;
}

export function normalizeTronAddress(address: string): string {
  const cleanAddress = address.startsWith("0x") ? address.slice(2) : address;
  if (/^41[a-fA-F0-9]{40}$/.test(cleanAddress)) {
    return TronWeb.address.fromHex(cleanAddress);
  }

  if (!TronWeb.isAddress(address)) {
    throw badRequest("invalid_address", "Expected a valid TRON address");
  }

  return address;
}

export function normalizeAddress(network: NetworkConfig, address: string): string {
  return network.kind === "evm" ? normalizeEvmAddress(address) : normalizeTronAddress(address);
}
