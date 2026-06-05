import { describe, expect, it } from "vitest";
import { TronWeb } from "tronweb";
import { loadSupportedNetworks } from "../src/config/networks.js";
import { createAdminSessionToken, verifyAdminSessionToken } from "../src/security/admin-session.js";
import { createTestEncryptor, testTronTokenAddress } from "./helpers.js";
import { parseTokenAmount, formatTokenAmount } from "../src/utils/amount.js";
import { normalizeTronAddress } from "../src/utils/address.js";
import { buildQrResult } from "../src/utils/qr.js";
import { buildCanonicalRequest, signCanonicalRequest, signRequest, timingSafeEqualHex } from "../src/security/hmac.js";

describe("security utilities", () => {
  it("encrypts and decrypts secrets with authenticated encryption", () => {
    const encryptor = createTestEncryptor();
    const encrypted = encryptor.encryptString("super-secret");

    expect(encrypted).not.toBe("super-secret");
    expect(encryptor.decryptString(encrypted)).toBe("super-secret");
  });

  it("builds stable request signatures", () => {
    const canonical = buildCanonicalRequest({
      method: "post",
      pathWithQuery: "/v1/deposit-addresses?x=1",
      timestamp: "1710000000",
      nonce: "n-1",
      body: "{\"hello\":\"world\"}"
    });
    const signature = signCanonicalRequest("secret", canonical);

    expect(signature).toHaveLength(64);
    expect(timingSafeEqualHex(`sha256=${signature}`, signRequest("secret", {
      method: "POST",
      pathWithQuery: "/v1/deposit-addresses?x=1",
      timestamp: "1710000000",
      nonce: "n-1",
      body: "{\"hello\":\"world\"}"
    }))).toBe(true);
    expect(timingSafeEqualHex(signature, "00")).toBe(false);
  });

  it("signs and verifies dashboard admin sessions", () => {
    const token = createAdminSessionToken("admin", "test-dashboard-session-secret-123456", 60);
    expect(verifyAdminSessionToken(token, "test-dashboard-session-secret-123456").sub).toBe("admin");
    expect(() => verifyAdminSessionToken(token, "different-dashboard-session-secret")).toThrow();
  });

  it("formats and parses token base units", () => {
    expect(formatTokenAmount(12_345_678n, 6)).toBe("12.345678");
    expect(parseTokenAmount("12.345678", 6)).toBe(12_345_678n);
  });

  it("generates optional QR outputs", async () => {
    const png = await buildQrResult("0xabc", "pngDataUrl");
    const svg = await buildQrResult("0xabc", "svg");
    const base64 = await buildQrResult("0xabc", "base64");

    expect(png.pngDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(svg.svg).toContain("<svg");
    expect(base64.base64).not.toContain("data:image");
  });

  it("normalizes TRON addresses and TRON token configuration", () => {
    const tronHexAddress = TronWeb.address.toHex(testTronTokenAddress);
    const networks = loadSupportedNetworks({
      RPC_URL_NILE: "https://api.nileex.io",
      USDT_CONTRACT_NILE: `0x${tronHexAddress}`,
      USDT_DECIMALS_NILE: "6"
    });

    expect(normalizeTronAddress(tronHexAddress)).toBe(testTronTokenAddress);
    expect(normalizeTronAddress(`0x${tronHexAddress}`)).toBe(testTronTokenAddress);
    expect(networks.nile?.kind).toBe("tron");
    expect(networks.nile?.tokens.USDT?.contractAddress).toBe(testTronTokenAddress);
    expect(networks.nile?.minGasWei).toBe(5_000_000n);
  });
});
