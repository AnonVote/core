/**
 * Organization X25519 keypair enrollment (Issue #86).
 *
 * The server never sees or stores the private key. It only:
 *   - generates the public, per-organization PBKDF2 salt, and
 *   - stores the public key the browser derives from (password, salt).
 *
 * This is deliberately separate from `organizationKeyService`, which manages the
 * server-side AES keys used for tenant data isolation. The two hierarchies are
 * unrelated — see CLAUDE.md, "Two independent key hierarchies".
 */
import { randomBytes } from "crypto";
import { prisma } from "../prisma/client";
import { badRequest, notFound } from "../utils/errors";
import { logger } from "../utils/logger";

/** 16 random bytes, base64 — matches the browser's PBKDF2 salt length. */
export function generateKeyDerivationSalt(): string {
  return randomBytes(16).toString("base64");
}

/**
 * Returns the public enrollment material for an organization.
 *
 * Deliberately unauthenticated: a voter's browser needs the salt to derive a key,
 * and a public key is public by definition. No secret is exposed.
 */
export async function getOrgPublicKey(organizationId: string) {
  if (!organizationId || typeof organizationId !== "string") {
    throw badRequest("Missing or malformed field: organizationId");
  }

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      publicKey: true,
      keyDerivationSalt: true,
      keyVersion: true,
    },
  });

  if (!org) throw notFound("Organization not found");

  // A not-yet-enrolled org still returns its salt: the browser needs it to
  // derive a keypair before it can enroll one. The salt is public by design and
  // worthless without the password.
  return {
    organizationId: org.id,
    publicKey: org.publicKey,
    keyDerivationSalt:
      org.keyDerivationSalt ?? (await ensureSalt(organizationId)),
    keyVersion: org.keyVersion,
    algorithm: "X25519" as const,
  };
}

/** Mints and persists a salt for an organization created before this feature. */
async function ensureSalt(organizationId: string): Promise<string> {
  const keyDerivationSalt = generateKeyDerivationSalt();
  await prisma.organization.update({
    where: { id: organizationId },
    data: { keyDerivationSalt },
  });
  return keyDerivationSalt;
}

/**
 * Enrolls (or rotates) an organization's public key.
 *
 * A salt is minted here if the organization predates this feature — that is the
 * backfill path for legacy organizations, which enroll on their next login.
 */
export async function enrollOrgPublicKey(
  organizationId: string,
  publicKey: string,
  keyVersion?: number,
) {
  if (!organizationId || typeof organizationId !== "string") {
    throw badRequest("Missing or malformed field: organizationId");
  }
  if (!publicKey || typeof publicKey !== "string") {
    throw badRequest("Missing or malformed field: publicKey");
  }

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { keyDerivationSalt: true, keyVersion: true },
  });
  if (!org) throw notFound("Organization not found");

  const updated = await prisma.organization.update({
    where: { id: organizationId },
    data: {
      publicKey,
      keyDerivationSalt: org.keyDerivationSalt ?? generateKeyDerivationSalt(),
      keyVersion: keyVersion ?? org.keyVersion,
    },
    select: {
      id: true,
      publicKey: true,
      keyDerivationSalt: true,
      keyVersion: true,
    },
  });

  // Public key only — never the salt-derived private material, which the server
  // does not possess.
  logger.info("org_public_key_enrolled", {
    organizationId,
    keyVersion: updated.keyVersion,
  });

  return {
    organizationId: updated.id,
    publicKey: updated.publicKey,
    keyDerivationSalt: updated.keyDerivationSalt,
    keyVersion: updated.keyVersion,
    algorithm: "X25519" as const,
  };
}
