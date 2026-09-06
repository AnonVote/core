/**
 * Login-time organization key enrollment (Issue #86).
 *
 * Enrollment happens at login rather than registration because registration
 * does not establish a session, and `POST /organizations/me/public-key`
 * requires one. This same path backfills organizations that predate the
 * feature — they enroll on their next login.
 */
import {
  getMe,
  getOrgPublicKey,
  enrollOrgPublicKey,
  getBallots,
} from "../api/client";
import {
  deriveOrgKeypair,
  decryptDescription,
  encryptDescription,
} from "./org-crypto";
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

export class DescriptionRekeyError extends Error {}

export interface PasswordChangePayload {
  publicKey: string;
  reencrypted: { ballotId: string; descriptionCiphertext: string }[];
  /** Private key for the NEW password — cache only after the server accepts. */
  newPrivateKey: Uint8Array;
}

/**
 * Re-keys every encrypted description from the old password to the new one.
 *
 * Changing the password changes the derived keypair, so the server refuses a
 * password change that would orphan descriptions. This builds the payload that
 * satisfies that check.
 *
 * Throws `DescriptionRekeyError` — rather than silently dropping anything — if a
 * description cannot be decrypted. Losing one here is unrecoverable, so the
 * admin must be told instead of quietly having data destroyed.
 */
export async function buildPasswordChangePayload(
  currentPassword: string,
  newPassword: string,
): Promise<PasswordChangePayload> {
  const me = await getMe();
  const keyRes = await getOrgPublicKey(me.data.data.id);
  const { keyDerivationSalt } = keyRes.data.data;

  if (!keyDerivationSalt) {
    throw new DescriptionRekeyError(
      "This organization has no encryption salt. Log out and back in, then try again.",
    );
  }

  // The salt does not change on a password change, so both keypairs derive from
  // the same salt.
  const oldKeys = deriveOrgKeypair(currentPassword, keyDerivationSalt);
  const newKeys = deriveOrgKeypair(newPassword, keyDerivationSalt);

  const ballotsRes = await getBallots();
  const encrypted = ballotsRes.data.data.filter((b) => b.descriptionCiphertext);

  const reencrypted = encrypted.map((b) => {
    let plaintext: string;
    try {
      plaintext = decryptDescription(b.descriptionCiphertext!, oldKeys.privateKey);
    } catch {
      throw new DescriptionRekeyError(
        `The description on "${b.topic}" could not be decrypted with your current ` +
          "password, so it cannot be carried over. Your password was not changed.",
      );
    }
    return {
      ballotId: b.id,
      descriptionCiphertext: encryptDescription(
        plaintext,
        newKeys.publicKey,
      ),
    };
  });

  return {
    publicKey: newKeys.publicKeyBase64,
    reencrypted,
    newPrivateKey: newKeys.privateKey,
  };
}
