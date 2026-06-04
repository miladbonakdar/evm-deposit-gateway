import { formatUnits, parseUnits } from "viem";

export function formatTokenAmount(rawAmount: bigint, decimals: number): string {
  return formatUnits(rawAmount, decimals);
}

export function parseTokenAmount(amount: string, decimals: number): bigint {
  return parseUnits(amount, decimals);
}

export function bigintToDecimalString(value: bigint): string {
  return value.toString(10);
}
