/**
 * Cross-runtime randomness and hex encoding.
 *
 * Lives in its own module so every entry point can share one implementation.
 * Previously `src/crypto.ts` had a careful lazy-loading version while
 * `src/client.ts` and `src/client/index.ts` imported Node's `crypto` at the
 * top level — and because `src/index.ts` re-exports the client, importing the
 * package at all pulled Node's `crypto` into the bundle. That is what made the
 * library unusable on Cloudflare Workers and Vercel Edge, regardless of which
 * functions the consumer actually called.
 */

/**
 * Minimal shape of the Web Crypto API's `crypto` global that this module
 * relies on. Declared locally instead of pulling in `lib.dom` so the
 * package's TypeScript config doesn't have to assume a browser-like `lib`.
 */
interface MinimalWebCrypto {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

/**
 * Returns the Web Crypto API's `crypto` global when it exposes
 * `getRandomValues`. This is present in browsers, Deno, Cloudflare Workers,
 * Vercel Edge Functions, and Node.js 19+ (as `globalThis.crypto`).
 *
 * Returns `undefined` in older Node.js runtimes that don't expose a global
 * `crypto`, in which case callers fall back to Node's `crypto` module.
 */
function getWebCrypto(): MinimalWebCrypto | undefined {
  const g = globalThis as { crypto?: MinimalWebCrypto };
  if (g.crypto && typeof g.crypto.getRandomValues === "function") {
    return g.crypto;
  }
  return undefined;
}

/**
 * Lazily loads Node's built-in `crypto` module.
 *
 * This must only ever be called from inside a function body, never at module
 * load time. Bundlers targeting edge runtimes resolve top-level imports
 * eagerly, so a top-level `import "crypto"` — or even a top-level
 * `try { require("crypto") }` — causes them to bundle Node's crypto module
 * into edge output even when it is never called. A `require()` inside a
 * function body is only evaluated if that function actually runs.
 */
export function getNodeCrypto(): typeof import("crypto") {
  return require("crypto");
}

/**
 * Cross-runtime cryptographically secure random bytes.
 *
 * Prefers the Web Crypto API (`globalThis.crypto.getRandomValues`), which
 * works in Node.js 19+, browsers, Deno, Cloudflare Workers, and Vercel Edge
 * Functions without any bundler configuration. Falls back to Node's
 * `crypto.randomBytes` only when no global Web Crypto is available.
 *
 * Both paths are backed by the platform CSPRNG. There is deliberately no
 * `Math.random()` fallback: a caller in an environment with neither source
 * should get a hard failure, not silently weak randomness.
 */
export function getRandomBytes(size: number): Uint8Array {
  const webCrypto = getWebCrypto();
  if (webCrypto) {
    return webCrypto.getRandomValues(new Uint8Array(size));
  }
  return new Uint8Array(getNodeCrypto().randomBytes(size));
}

/**
 * Hex-encodes bytes without relying on Node's `Buffer`, which is not
 * guaranteed to exist in edge runtimes.
 */
export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Builds an RFC 4122 version 4 UUID from 16 cryptographically random bytes.
 *
 * Shared by the two client entry points, which each had their own copy.
 */
export function randomUUID(): string {
  const bytes = getRandomBytes(16);
  // Version 4 in the high nibble of byte 6; RFC 4122 variant in byte 8.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
