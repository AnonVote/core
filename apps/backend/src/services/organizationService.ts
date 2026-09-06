import { prisma } from "../prisma/client";
import bcrypt from "bcrypt";
import { badRequest, notFound } from "../utils/errors";
import { logger } from "../utils/logger";

/**
 * Update organization name or email
 */
export async function updateOrg(
  orgId: string,
  data: { name?: string; email?: string },
) {
  return prisma.organization.update({
    where: { id: orgId },
    data: {
      ...(data.name && { name: data.name }),
      ...(data.email && { email: data.email }),
    },
  });
}

/**
 * Change organization password
 */
export interface ReencryptedDescription {
  ballotId: string;
  descriptionCiphertext: string;
}

export interface ChangePasswordOptions {
  /** New X25519 public key derived from (newPassword, salt). */
  publicKey?: string;
  /** Every description re-encrypted to the new key. */
  reencrypted?: ReencryptedDescription[];
  /** Explicit opt-in to destroying descriptions that were not re-encrypted. */
  discardEncryptedDescriptions?: boolean;
}

/**
 * Changes an organization's password, re-keying its encrypted ballot descriptions
 * in the same transaction.
 *
 * The org's private key is derived from (password, salt) in the browser, so a new
 * password means a new keypair — every existing `descriptionCiphertext` becomes
 * undecryptable unless it is re-encrypted here.
 *
 * Invariants:
 *   1. Every ballot holding a description ends up either re-encrypted to the new
 *      key, or explicitly discarded via `discardEncryptedDescriptions`.
 *   2. Password hash, public key and all ciphertexts commit atomically — a new
 *      password is never persisted alongside ciphertexts only the old key can read.
 *   3. Only ballots belonging to `orgId` are ever written.
 *
 * Failure modes guarded against:
 *   - Partial write (new password, stale ciphertexts) → single `$transaction`.
 *   - Incomplete `reencrypted` set → completeness check, re-run inside the
 *     transaction so a ballot gaining a description mid-flight cannot slip past.
 *   - Cross-tenant write via a forged ballotId → every update is filtered on
 *     `organizationId` and unknown ids are rejected up front.
 */
export async function changeOrgPassword(
  orgId: string,
  currentPassword: string,
  newPassword: string,
  options: ChangePasswordOptions = {},
) {
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) throw notFound("Organization not found");

  const valid = await bcrypt.compare(currentPassword, org.passwordHash);
  if (!valid) throw badRequest("Current password is incorrect");

  const { publicKey, reencrypted = [], discardEncryptedDescriptions } = options;

  // Reject duplicates and cross-tenant ids before touching anything.
  const submitted = new Map<string, string>();
  for (const entry of reencrypted) {
    if (
      !entry ||
      typeof entry.ballotId !== "string" ||
      typeof entry.descriptionCiphertext !== "string" ||
      !entry.descriptionCiphertext.trim()
    ) {
      throw badRequest(
        "Each reencrypted entry needs a ballotId and a non-empty descriptionCiphertext",
      );
    }
    if (submitted.has(entry.ballotId)) {
      throw badRequest(
        `Duplicate reencrypted entry for ballot ${entry.ballotId}`,
      );
    }
    submitted.set(entry.ballotId, entry.descriptionCiphertext);
  }

  const hash = await bcrypt.hash(newPassword, 12);

  await prisma.$transaction(async (tx) => {
    // Re-read inside the transaction: the set of encrypted ballots must be
    // evaluated against the same snapshot we write.
    const encryptedBallots = await tx.ballot.findMany({
      where: { organizationId: orgId, descriptionCiphertext: { not: null } },
      select: { id: true },
    });
    const needsRekey = new Set(encryptedBallots.map((b) => b.id));

    const foreign = [...submitted.keys()].filter((id) => !needsRekey.has(id));
    if (foreign.length > 0) {
      throw badRequest(
        `Unknown or ineligible ballot(s) in reencrypted: ${foreign.join(", ")}`,
      );
    }

    const missing = [...needsRekey].filter((id) => !submitted.has(id));
    if (missing.length > 0 && !discardEncryptedDescriptions) {
      // Refusing here is the whole point: applying the new password now would
      // orphan these ciphertexts permanently.
      throw badRequest(
        `Password change would orphan ${missing.length} encrypted description(s). ` +
          "Re-encrypt them and resubmit, or pass discardEncryptedDescriptions to " +
          "destroy them deliberately.",
      );
    }

    await tx.organization.update({
      where: { id: orgId },
      data: {
        passwordHash: hash,
        ...(publicKey ? { publicKey, keyVersion: { increment: 1 } } : {}),
      },
    });

    for (const [ballotId, descriptionCiphertext] of submitted) {
      await tx.ballot.updateMany({
        where: { id: ballotId, organizationId: orgId },
        data: { descriptionCiphertext },
      });
    }

    if (missing.length > 0 && discardEncryptedDescriptions) {
      await tx.ballot.updateMany({
        where: { id: { in: missing }, organizationId: orgId },
        data: { descriptionCiphertext: null, descriptionKeyVersion: null },
      });
    }

    logger.info("org_password_changed", {
      organizationId: orgId,
      rekeyed: submitted.size,
      discarded: discardEncryptedDescriptions ? missing.length : 0,
      publicKeyRotated: Boolean(publicKey),
    });
  });
}

/**
 * Delete organization account and all associated data
 */
export async function deleteOrgAccount(orgId: string) {
  const ballots = await prisma.ballot.findMany({
    where: { organizationId: orgId },
  });

  for (const ballot of ballots) {
    await prisma.auditEvent.deleteMany({ where: { ballotId: ballot.id } });
    await prisma.result.deleteMany({ where: { ballotId: ballot.id } });
    await prisma.vote.deleteMany({ where: { ballotId: ballot.id } });
    await prisma.option.deleteMany({ where: { ballotId: ballot.id } });
    await prisma.voterToken.deleteMany({ where: { ballotId: ballot.id } });
  }

  await prisma.ballot.deleteMany({ where: { organizationId: orgId } });
  await prisma.session.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
}
