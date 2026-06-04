import { describe, expect, it } from "vitest";
import { createTestEncryptor } from "./helpers.js";
import { parseTokenAmount, formatTokenAmount } from "../src/utils/amount.js";
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
});
