/**
 * Access to the organization's derived X25519 private key (Issue #86).
 *
 * The key is derived from the admin's password at login and cached in
 * sessionStorage — mirroring `storage-crypto.ts`'s `anonvote-sk`, so it survives
 * a reload in the same tab and is gone when the tab closes. It is never sent to
 * the server, and logout clears it.
 */
import { useCallback, useEffect, useState } from "react";
import {
  deriveOrgKeypair,
  fromBase64,
  toBase64,
} from "../utils/org-crypto";

const ORG_KEY_NAME = "anonvote-org-sk";

/** Reads the cached private key, or null when this session has none. */
export function getCachedOrgKey(): Uint8Array | null {
  try {
    const stored = sessionStorage.getItem(ORG_KEY_NAME);
    return stored ? fromBase64(stored) : null;
  } catch {
    // Private browsing or blocked storage — behave as if no key is cached.
    return null;
  }
}

export function cacheOrgKey(privateKey: Uint8Array): void {
  try {
    sessionStorage.setItem(ORG_KEY_NAME, toBase64(privateKey));
  } catch {
    // Non-fatal: the admin simply has to re-enter their password next reload.
  }
}

export function clearOrgKey(): void {
  try {
    sessionStorage.removeItem(ORG_KEY_NAME);
  } catch {
    /* nothing to clear */
  }
}

/**
 * Derives the keypair from a password + salt and caches the private key.
 * Returns the base64 public key so the caller can enroll it.
 */
export function deriveAndCacheOrgKey(
  password: string,
  saltBase64: string,
): string {
  const { privateKey, publicKeyBase64 } = deriveOrgKeypair(password, saltBase64);
  cacheOrgKey(privateKey);
  return publicKeyBase64;
}

export interface UseOrgKey {
  /** null when this session has no derived key — show a placeholder. */
  orgKey: Uint8Array | null;
  hasKey: boolean;
  refresh: () => void;
  clear: () => void;
}

export function useOrgKey(): UseOrgKey {
  const [orgKey, setOrgKey] = useState<Uint8Array | null>(null);

  const refresh = useCallback(() => setOrgKey(getCachedOrgKey()), []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const clear = useCallback(() => {
    clearOrgKey();
    setOrgKey(null);
  }, []);

  return { orgKey, hasKey: orgKey !== null, refresh, clear };
}
