const SESSION_KEY_NAME = "anonvote-sk";

async function generateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

async function importKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

/**
 * Returns the AES-GCM session key for this browser session.
 *
 * The key is generated once per session and stored in sessionStorage as a JWK
 * so it survives page reloads within the same tab. It is gone after the tab
 * closes, which means any data encrypted with it becomes unreadable — this is
 * the desired behaviour for privacy-sensitive storage.
 */
export async function getOrCreateSessionKey(): Promise<CryptoKey> {
  const stored = sessionStorage.getItem(SESSION_KEY_NAME);
  if (stored) {
    try {
      const jwk = JSON.parse(stored) as JsonWebKey;
      return await importKey(jwk);
    } catch {
      sessionStorage.removeItem(SESSION_KEY_NAME);
    }
  }
  const key = await generateKey();
  const jwk = await crypto.subtle.exportKey("jwk", key);
  sessionStorage.setItem(SESSION_KEY_NAME, JSON.stringify(jwk));
  return key;
}

/**
 * Encrypts any JSON-serialisable value with AES-GCM.
 * Returns a base64-encoded string of `IV (12 bytes) || ciphertext`.
 */
export async function encryptJSON(
  data: unknown,
  key: CryptoKey,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext,
  );
  const combined = new Uint8Array(12 + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), 12);
  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypts a value previously encrypted by `encryptJSON`.
 * Throws if the ciphertext has been tampered with or the key is wrong.
 */
export async function decryptJSON<T = unknown>(
  encoded: string,
  key: CryptoKey,
): Promise<T> {
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const iv = bytes.slice(0, 12);
  const ciphertext = bytes.slice(12);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}
