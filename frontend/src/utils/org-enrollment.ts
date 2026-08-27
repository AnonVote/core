/**
 * Login-time organization key enrollment (Issue #86).
 *
 * Enrollment happens at login rather than registration because registration
 * does not establish a session, and `POST /organizations/me/public-key`
 * requires one. This same path backfills organizations that predate the
 * feature — they enroll on their next login.
 */
import { getMe, getOrgPublicKey, enrollOrgPublicKey } from "../api/client";
import { deriveOrgKeypair } from "./org-crypto";
import { cacheOrgKey } from "../hooks/useOrgKey";

export type EnrollmentOutcome =
  | "enrolled"
  | "restored"
  | "password-mismatch"
  | "unavailable";

/**
 * Derives the org keypair from the just-used password and caches the private
 * key for this session, enrolling the public key if the org has none.
 *
 * Never throws: a failure here must not block a successful login. The admin
 * simply sees encrypted descriptions as placeholders.
 */
export async function enrollOrgKeyAfterLogin(
  password: string,
): Promise<EnrollmentOutcome> {
  try {
    const me = await getMe();
    const organizationId = me.data.data.id;

    const keyRes = await getOrgPublicKey(organizationId);
    const { publicKey, keyDerivationSalt } = keyRes.data.data;

    if (!keyDerivationSalt) return "unavailable";

    const derived = deriveOrgKeypair(password, keyDerivationSalt);

    if (!publicKey) {
      await enrollOrgPublicKey({ publicKey: derived.publicKeyBase64 });
      cacheOrgKey(derived.privateKey);
      return "enrolled";
    }

    if (publicKey !== derived.publicKeyBase64) {
      // The stored key was derived from a different password. Caching this key
      // would only produce failed decryptions, so don't.
      return "password-mismatch";
    }

    cacheOrgKey(derived.privateKey);
    return "restored";
  } catch {
    return "unavailable";
  }
}
