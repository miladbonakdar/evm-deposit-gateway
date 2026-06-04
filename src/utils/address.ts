import { getAddress, isAddress, type Address } from "viem";
import { badRequest } from "../errors.js";

export function normalizeAddress(address: string): Address {
  if (!isAddress(address)) {
    throw badRequest("invalid_address", "Expected a valid EVM address");
  }

  return getAddress(address).toLowerCase() as Address;
}
