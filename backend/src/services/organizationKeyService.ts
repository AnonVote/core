import crypto from "crypto";
import { prisma } from "../prisma/client";
import { config } from "../config";
import { notFound } from "../utils/errors";

/**
 * Organization Key Management Service
 * 
 * Implements per-organization encryption keys with master key wrapping.
 * This ensures that compromising one organization's key doesn't expose
 * other organizations' encrypted data.
 * 
 * Architecture:
 * - Master key (BALLOT_ENCRYPTION_KEY) encrypts organization-specific keys
 * - Each organization has versioned keys for rotation
 * - Old keys preserved for historical vote decryption
 * - Key derivation uses HKDF for fast, secure key derivation
 */

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Derives a deterministic key from the master key for organization-specific encryption
 */
function deriveMasterKey(): Buffer {
  const masterKey = config.dataEncryptionKey;
  if (!masterKey || masterKey.length !== 64) {
    throw new Error("DATA_ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
  }
  return Buffer.from(masterKey, "hex");
}

/**
 * Generates a new random encryption key for an organization
 */
function generateOrganizationKey(): Buffer {
  return crypto.randomBytes(KEY_LENGTH);
}

/**
 * Encrypts an organization key with the master key
 */
function encryptOrganizationKey(orgKey: Buffer): string {
  const masterKey = deriveMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const salt = crypto.randomBytes(SALT_LENGTH);
  
  // Derive encryption key from master key using HKDF (fast, designed for key derivation)
  const derivedKey = Buffer.from(
    crypto.hkdfSync('sha256', masterKey, salt, Buffer.from('org-key-encryption'), KEY_LENGTH),
  );

  const cipher = crypto.createCipheriv(ALGORITHM, derivedKey, iv);
  const encrypted = Buffer.concat([cipher.update(orgKey), cipher.final()]);
  const authTag = cipher.getAuthTag();
  
  // Format: salt:iv:authTag:encryptedKey (all hex)
  return [
    salt.toString("hex"),
    iv.toString("hex"),
    authTag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}

/**
 * Decrypts an organization key using the master key
 */
function decryptOrganizationKey(encryptedKey: string): Buffer {
  const masterKey = deriveMasterKey();
  const parts = encryptedKey.split(":");
  
  if (parts.length !== 4) {
    throw new Error("Invalid encrypted key format");
  }
  
  const salt = Buffer.from(parts[0], "hex");
  const iv = Buffer.from(parts[1], "hex");
  const authTag = Buffer.from(parts[2], "hex");
  const encrypted = Buffer.from(parts[3], "hex");
  
  // Derive same key used for encryption using HKDF
  const derivedKey = Buffer.from(
    crypto.hkdfSync('sha256', masterKey, salt, Buffer.from('org-key-encryption'), KEY_LENGTH),
  );

  const decipher = crypto.createDecipheriv(ALGORITHM, derivedKey, iv);
  decipher.setAuthTag(authTag);
  
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

/**
 * Creates initial encryption key for an organization
 */
export async function createOrganizationKey(organizationId: string): Promise<void> {
  // Check if organization already has a key
  const existing = await prisma.organizationKey.findFirst({
    where: { organizationId, isActive: true },
  });
  
  if (existing) {
    console.log(`[OrgKey] Organization ${organizationId} already has an active key`);
    return;
  }
  
  // Generate new organization-specific key
  const orgKey = generateOrganizationKey();
  const encryptedKey = encryptOrganizationKey(orgKey);
  
  await prisma.organizationKey.create({
    data: {
      organizationId,
      keyVersion: 1,
      encryptedKey,
      isActive: true,
    },
  });
  
  console.log(`[OrgKey] Created encryption key version 1 for organization ${organizationId}`);
}

/**
 * Retrieves the active encryption key for an organization
 */
export async function getOrganizationKey(organizationId: string): Promise<Buffer> {
  const keyRecord = await prisma.organizationKey.findFirst({
    where: { organizationId, isActive: true },
    orderBy: { keyVersion: "desc" },
  });
  
  if (!keyRecord) {
    throw notFound(`No active encryption key found for organization ${organizationId}`);
  }
  
  return decryptOrganizationKey(keyRecord.encryptedKey);
}

/**
 * Rotates encryption key for an organization
 * Creates new key version and deactivates old one
 */
export async function rotateOrganizationKey(organizationId: string): Promise<void> {
  const currentKey = await prisma.organizationKey.findFirst({
    where: { organizationId, isActive: true },
    orderBy: { keyVersion: "desc" },
  });
  
  if (!currentKey) {
    throw notFound(`No active key found for organization ${organizationId}`);
  }
  
  // Generate new key
  const newOrgKey = generateOrganizationKey();
  const encryptedKey = encryptOrganizationKey(newOrgKey);
  
  await prisma.$transaction(async (tx) => {
    // Deactivate current key
    await tx.organizationKey.update({
      where: { id: currentKey.id },
      data: { isActive: false, rotatedAt: new Date() },
    });
    
    // Create new key version
    await tx.organizationKey.create({
      data: {
        organizationId,
        keyVersion: currentKey.keyVersion + 1,
        encryptedKey,
        isActive: true,
      },
    });
  });
  
  console.log(
    `[OrgKey] Rotated key for organization ${organizationId} to version ${currentKey.keyVersion + 1}`
  );
}

/**
 * Encrypts data using organization-specific key
 */
export async function encryptWithOrgKey(
  organizationId: string,
  plaintext: string
): Promise<string> {
  const orgKey = await getOrganizationKey(organizationId);
  const iv = crypto.randomBytes(IV_LENGTH);
  
  const cipher = crypto.createCipheriv(ALGORITHM, orgKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  
  // Format: iv:authTag:ciphertext (all hex)
  return [
    iv.toString("hex"),
    authTag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}

/**
 * Decrypts data using organization-specific key
 */
export async function decryptWithOrgKey(
  organizationId: string,
  ciphertext: string
): Promise<string> {
  const orgKey = await getOrganizationKey(organizationId);
  const parts = ciphertext.split(":");
  
  if (parts.length !== 3) {
    throw new Error("Invalid ciphertext format");
  }
  
  const iv = Buffer.from(parts[0], "hex");
  const authTag = Buffer.from(parts[1], "hex");
  const encrypted = Buffer.from(parts[2], "hex");
  
  const decipher = crypto.createDecipheriv(ALGORITHM, orgKey, iv);
  decipher.setAuthTag(authTag);
  
  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Ensures all organizations have encryption keys
 * Run this during migration or startup
 */
export async function ensureAllOrganizationKeys(): Promise<void> {
  const organizations = await prisma.organization.findMany({
    select: { id: true, name: true },
  });
  
  for (const org of organizations) {
    try {
      await createOrganizationKey(org.id);
    } catch (err) {
      console.error(`[OrgKey] Failed to create key for ${org.name}:`, err);
    }
  }
  
  console.log(`[OrgKey] Ensured keys for ${organizations.length} organizations`);
}
