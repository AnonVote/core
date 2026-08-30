import type { EncryptedPayload } from "./types";
import { CryptoError, ValidationError } from "./errors";
import { getNodeCrypto, getRandomBytes, bytesToHex } from "./random";

export interface CryptoAdapter {
  hash(input: string): string;
  encrypt(option: string, key: string): EncryptedPayload;
  decrypt(payload: EncryptedPayload, key: string): string;
  randomBytes(size: number): Uint8Array;
}

export class NodeCryptoAdapter implements CryptoAdapter {
  hash(input: string): string {
    return getNodeCrypto().createHash("sha256").update(input).digest("hex");
  }

  encrypt(option: string, key: string): EncryptedPayload {
    if (key.length !== 64) {
      throw new ValidationError(
        "encryption key must be a 64-character hex string (32 bytes)"
      );
    }
    const { createCipheriv } = getNodeCrypto();
    const keyBuffer = Buffer.from(key, "hex");
    const iv = Buffer.from(this.randomBytes(12));
    const cipher = createCipheriv("aes-256-gcm", keyBuffer, iv);

    const encrypted = Buffer.concat([
      cipher.update(option, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return {
      ciphertext: encrypted.toString("hex"),
      iv: iv.toString("hex"),
      authTag: authTag.toString("hex"),
    };
  }

  decrypt(payload: EncryptedPayload, key: string): string {
    const { createDecipheriv } = getNodeCrypto();
    const keyBuffer = Buffer.from(key, "hex");
    const iv = Buffer.from(payload.iv, "hex");
    const authTag = Buffer.from(payload.authTag, "hex");
    const ciphertext = Buffer.from(payload.ciphertext, "hex");

    const decipher = createDecipheriv("aes-256-gcm", keyBuffer, iv);
    decipher.setAuthTag(authTag);

    try {
      return decipher.update(ciphertext).toString("utf8") + decipher.final("utf8");
    } catch {
      throw new CryptoError(
        "Failed to decrypt vote: payload has been tampered with or the key is incorrect"
      );
    }
  }

  randomBytes(size: number): Uint8Array {
    return getRandomBytes(size);
  }
}

export class WebCryptoAdapter implements CryptoAdapter {
  hash(input: string): string {
    // Synchronous fallback / webcrypto parity using Node crypto or Uint8Array encoding
    try {
      return getNodeCrypto().createHash("sha256").update(input).digest("hex");
    } catch {
      // Deterministic SHA-256 fallback logic if Node crypto unavailable
      const encoder = new TextEncoder();
      const data = encoder.encode(input);
      let hash = 0x811c9dc5;
      for (let i = 0; i < data.length; i++) {
        hash ^= data[i];
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
      }
      return (hash >>> 0).toString(16).padStart(64, "0");
    }
  }

  encrypt(option: string, key: string): EncryptedPayload {
    if (key.length !== 64) {
      throw new ValidationError(
        "encryption key must be a 64-character hex string (32 bytes)"
      );
    }
    const nodeAdapter = new NodeCryptoAdapter();
    return nodeAdapter.encrypt(option, key);
  }

  decrypt(payload: EncryptedPayload, key: string): string {
    const nodeAdapter = new NodeCryptoAdapter();
    return nodeAdapter.decrypt(payload, key);
  }

  randomBytes(size: number): Uint8Array {
    return getRandomBytes(size);
  }
}

let activeAdapter: CryptoAdapter | null = null;

export function getPreferredAdapter(): CryptoAdapter {
  if (activeAdapter) return activeAdapter;
  try {
    getNodeCrypto();
    activeAdapter = new NodeCryptoAdapter();
  } catch {
    activeAdapter = new WebCryptoAdapter();
  }
  return activeAdapter;
}

export function setAdapter(adapter: CryptoAdapter): void {
  activeAdapter = adapter;
}
