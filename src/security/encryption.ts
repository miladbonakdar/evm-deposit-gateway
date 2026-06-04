import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";

export class Encryptor {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) {
      throw new Error("ENCRYPTION_MASTER_KEY_BASE64 must decode to 32 bytes");
    }
  }

  encryptString(plainText: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
  }

  decryptString(encrypted: string): string {
    const [version, ivBase64, tagBase64, ciphertextBase64] = encrypted.split(".");

    if (version !== VERSION || !ivBase64 || !tagBase64 || !ciphertextBase64) {
      throw new Error("Unsupported encrypted payload format");
    }

    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivBase64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagBase64, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(ciphertextBase64, "base64url")),
      decipher.final()
    ]);

    return decrypted.toString("utf8");
  }
}

export function createEncryptorFromBase64(base64Key: string): Encryptor {
  return new Encryptor(Buffer.from(base64Key, "base64"));
}
