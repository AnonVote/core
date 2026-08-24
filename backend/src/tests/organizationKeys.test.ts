/**
 * Organization Key Management Tests
 * 
 * Tests for per-organization encryption key management:
 * - Key generation and storage
 * - Key rotation
 * - Encryption/decryption with org keys
 * - Key isolation between organizations
 * - Master key wrapping
 */

import { prisma } from "../prisma/client";
import {
  createOrganizationKey,
  getOrganizationKey,
  rotateOrganizationKey,
  encryptWithOrgKey,
  decryptWithOrgKey,
  ensureAllOrganizationKeys,
} from "../services/organizationKeyService";
import bcrypt from "bcrypt";

describe("Organization Key Management", () => {
  let orgId1: string;
  let orgId2: string;

  beforeAll(async () => {
    // Clean up
    await prisma.organizationKey.deleteMany({});
    await prisma.session.deleteMany({});
    await prisma.organization.deleteMany({});

    // Create test organizations
    const passwordHash = await bcrypt.hash("test123", 10);
    
    const org1 = await prisma.organization.create({
      data: {
        name: "Key Test Org 1",
        email: "keyorg1@test.com",
        passwordHash,
      },
    });
    orgId1 = org1.id;

    const org2 = await prisma.organization.create({
      data: {
        name: "Key Test Org 2",
        email: "keyorg2@test.com",
        passwordHash,
      },
    });
    orgId2 = org2.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("Key Creation", () => {
    it("should create encryption key for organization", async () => {
      await createOrganizationKey(orgId1);

      const keys = await prisma.organizationKey.findMany({
        where: { organizationId: orgId1 },
      });

      expect(keys).toHaveLength(1);
      expect(keys[0].keyVersion).toBe(1);
      expect(keys[0].isActive).toBe(true);
      expect(keys[0].encryptedKey).toBeDefined();
      expect(keys[0].encryptedKey.split(":")).toHaveLength(4); // salt:iv:authTag:ciphertext
    });

    it("should not create duplicate key if one exists", async () => {
      // Try to create again
      await createOrganizationKey(orgId1);

      const keys = await prisma.organizationKey.findMany({
        where: { organizationId: orgId1 },
      });

      expect(keys).toHaveLength(1); // Still only one key
    });

    it("should create keys for all organizations", async () => {
      await ensureAllOrganizationKeys();

      const keys1 = await prisma.organizationKey.findMany({
        where: { organizationId: orgId1 },
      });
      const keys2 = await prisma.organizationKey.findMany({
        where: { organizationId: orgId2 },
      });

      expect(keys1.length).toBeGreaterThan(0);
      expect(keys2.length).toBeGreaterThan(0);
    });
  });

  describe("Key Retrieval", () => {
    it("should retrieve active encryption key", async () => {
      const key = await getOrganizationKey(orgId1);

      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32); // 256 bits
    });

    it("should fail to retrieve key for non-existent organization", async () => {
      await expect(
        getOrganizationKey("non-existent-org-id")
      ).rejects.toThrow("No active encryption key found");
    });
  });

  describe("Key Rotation", () => {
    it("should rotate encryption key", async () => {
      await rotateOrganizationKey(orgId1);

      const keys = await prisma.organizationKey.findMany({
        where: { organizationId: orgId1 },
        orderBy: { keyVersion: "asc" },
      });

      expect(keys).toHaveLength(2);
      
      // Old key should be inactive
      expect(keys[0].keyVersion).toBe(1);
      expect(keys[0].isActive).toBe(false);
      expect(keys[0].rotatedAt).toBeDefined();
      
      // New key should be active
      expect(keys[1].keyVersion).toBe(2);
      expect(keys[1].isActive).toBe(true);
    });

    it("should maintain access to old key for decryption", async () => {
      // Old keys should still be retrievable
      const oldKey = await prisma.organizationKey.findFirst({
        where: {
          organizationId: orgId1,
          keyVersion: 1,
        },
      });

      expect(oldKey).toBeDefined();
      expect(oldKey?.encryptedKey).toBeDefined();
    });

    it("should get latest active key after rotation", async () => {
      const key = await getOrganizationKey(orgId1);

      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);

      // Verify it's version 2
      const activeKey = await prisma.organizationKey.findFirst({
        where: {
          organizationId: orgId1,
          isActive: true,
        },
      });

      expect(activeKey?.keyVersion).toBe(2);
    });

    it("should allow multiple rotations", async () => {
      await rotateOrganizationKey(orgId1);
      await rotateOrganizationKey(orgId1);

      const keys = await prisma.organizationKey.findMany({
        where: { organizationId: orgId1 },
        orderBy: { keyVersion: "desc" },
      });

      expect(keys.length).toBeGreaterThanOrEqual(4);
      expect(keys[0].keyVersion).toBe(4);
      expect(keys[0].isActive).toBe(true);
      
      // All previous keys should be inactive
      keys.slice(1).forEach(key => {
        expect(key.isActive).toBe(false);
      });
    });
  });

  describe("Encryption/Decryption", () => {
    const testData = "Sensitive vote data: Option A selected by voter X";

    it("should encrypt data with organization key", async () => {
      const encrypted = await encryptWithOrgKey(orgId1, testData);

      expect(encrypted).toBeDefined();
      expect(encrypted).not.toBe(testData);
      expect(encrypted.split(":")).toHaveLength(3); // iv:authTag:ciphertext
    });

    it("should decrypt data with same organization key", async () => {
      const encrypted = await encryptWithOrgKey(orgId1, testData);
      const decrypted = await decryptWithOrgKey(orgId1, encrypted);

      expect(decrypted).toBe(testData);
    });

    it("should produce different ciphertext for same plaintext (IV randomization)", async () => {
      const encrypted1 = await encryptWithOrgKey(orgId1, testData);
      const encrypted2 = await encryptWithOrgKey(orgId1, testData);

      expect(encrypted1).not.toBe(encrypted2);

      // But both should decrypt to same plaintext
      const decrypted1 = await decryptWithOrgKey(orgId1, encrypted1);
      const decrypted2 = await decryptWithOrgKey(orgId1, encrypted2);

      expect(decrypted1).toBe(testData);
      expect(decrypted2).toBe(testData);
    });

    it("should fail to decrypt with wrong organization key", async () => {
      const encrypted = await encryptWithOrgKey(orgId1, testData);

      // Org 2 should not be able to decrypt Org 1's data
      await expect(
        decryptWithOrgKey(orgId2, encrypted)
      ).rejects.toThrow();
    });

    it("should handle empty strings", async () => {
      const empty = "";
      const encrypted = await encryptWithOrgKey(orgId1, empty);
      const decrypted = await decryptWithOrgKey(orgId1, encrypted);

      expect(decrypted).toBe(empty);
    });

    it("should handle special characters", async () => {
      const special = "Test with émojis 🗳️ and symbols: @#$%^&*()";
      const encrypted = await encryptWithOrgKey(orgId1, special);
      const decrypted = await decryptWithOrgKey(orgId1, encrypted);

      expect(decrypted).toBe(special);
    });

    it("should handle large data", async () => {
      const largeData = "X".repeat(10000);
      const encrypted = await encryptWithOrgKey(orgId1, largeData);
      const decrypted = await decryptWithOrgKey(orgId1, encrypted);

      expect(decrypted).toBe(largeData);
    });
  });

  describe("Key Isolation", () => {
    it("should have different keys for different organizations", async () => {
      const key1 = await getOrganizationKey(orgId1);
      const key2 = await getOrganizationKey(orgId2);

      expect(key1).not.toEqual(key2);
    });

    it("should not allow decryption across organizations", async () => {
      const testMessage = "Org 1 secret data";
      const encrypted = await encryptWithOrgKey(orgId1, testMessage);

      // Org 2 cannot decrypt Org 1's data
      await expect(
        decryptWithOrgKey(orgId2, encrypted)
      ).rejects.toThrow();
    });

    it("should maintain isolation after key rotation", async () => {
      const testMessage = "Data before rotation";
      const encrypted = await encryptWithOrgKey(orgId1, testMessage);

      // Rotate Org 1's key
      await rotateOrganizationKey(orgId1);

      // Org 2 still cannot decrypt Org 1's data
      await expect(
        decryptWithOrgKey(orgId2, encrypted)
      ).rejects.toThrow();
    });
  });

  describe("Master Key Wrapping", () => {
    it("should encrypt organization keys with master key", async () => {
      const keyRecord = await prisma.organizationKey.findFirst({
        where: { organizationId: orgId1, isActive: true },
      });

      expect(keyRecord?.encryptedKey).toBeDefined();
      
      // Encrypted key format: salt:iv:authTag:ciphertext
      const parts = keyRecord!.encryptedKey.split(":");
      expect(parts).toHaveLength(4);
      
      // Each part should be hex
      parts.forEach(part => {
        expect(/^[0-9a-f]+$/i.test(part)).toBe(true);
      });
    });

    it("should not store plaintext keys in database", async () => {
      const keys = await prisma.organizationKey.findMany({
        where: { organizationId: orgId1 },
      });

      keys.forEach(key => {
        // Encrypted key should not be 32 bytes hex (plaintext key format)
        expect(key.encryptedKey.length).toBeGreaterThan(64);
        expect(key.encryptedKey).toContain(":");
      });
    });
  });

  describe("Error Handling", () => {
    it("should handle invalid encrypted data format", async () => {
      const invalidFormat = "not:valid:encrypted:data:format";

      await expect(
        decryptWithOrgKey(orgId1, invalidFormat)
      ).rejects.toThrow();
    });

    it("should handle corrupted ciphertext", async () => {
      const encrypted = await encryptWithOrgKey(orgId1, "test");
      const corrupted = encrypted.split(":").map(p => p.slice(1)).join(":");

      await expect(
        decryptWithOrgKey(orgId1, corrupted)
      ).rejects.toThrow();
    });

    it("should handle tampered authentication tag", async () => {
      const encrypted = await encryptWithOrgKey(orgId1, "test");
      const parts = encrypted.split(":");
      parts[1] = "00".repeat(16); // Replace auth tag with zeros
      const tampered = parts.join(":");

      await expect(
        decryptWithOrgKey(orgId1, tampered)
      ).rejects.toThrow();
    });
  });
});
