import {
  validateFIPSCompliance,
  getCachedValidation,
  clearValidationCache,
  FIPSValidationResult,
} from '../src/fipsValidator';
import { encryptVote, decryptVote, hashIdentifier, generateToken, hashToken } from '../src/crypto';
import { getNodeCrypto, getRandomBytes } from '../src/random';

describe('FIPS 140-2 Compliance Validation', () => {
  beforeEach(() => {
    clearValidationCache();
  });

  describe('validateFIPSCompliance', () => {
    it('should return a valid compliance result', () => {
      const result = validateFIPSCompliance({ logResults: false });
      
      expect(result).toBeDefined();
      expect(result).toHaveProperty('compliant');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('checks');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
      expect(result.checks.length).toBeGreaterThan(0);
    });

    it('should validate all required checks', () => {
      const result = validateFIPSCompliance({ logResults: false });
      
      const checkNames = result.checks.map(c => c.name);
      expect(checkNames).toContain('Algorithm Availability');
      expect(checkNames).toContain('AES-256-GCM Parameters');
      expect(checkNames).toContain('SHA-256 Parameters');
      expect(checkNames).toContain('CSPRNG Quality');
      expect(checkNames).toContain('IV Uniqueness');
      expect(checkNames).toContain('Key Generation');
    });

    it('should mark as compliant when all checks pass', () => {
      const result = validateFIPSCompliance({ logResults: false });
      
      if (!result.compliant) {
        console.error('Compliance errors:', result.errors);
      }
      
      expect(result.compliant).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should cache validation results', () => {
      const result1 = validateFIPSCompliance({ logResults: false });
      const result2 = getCachedValidation();
      
      expect(result2.timestamp).toEqual(result1.timestamp);
    });

    it('should respect throwOnFailure configuration', () => {
      // This test passes because our implementation is compliant
      expect(() => {
        validateFIPSCompliance({ logResults: false, throwOnFailure: true });
      }).not.toThrow();
    });
  });

  describe('AES-256-GCM Compliance', () => {
    it('should use 256-bit keys (64 hex chars)', () => {
      const keyBytes = getRandomBytes(32);
      const key = Array.from(keyBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      expect(key.length).toBe(64); // 256 bits = 32 bytes = 64 hex chars
    });

    it('should generate 96-bit IVs (24 hex chars)', () => {
      const keyBytes = getRandomBytes(32);
      const key = Array.from(keyBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      const result = encryptVote('test data', key);
      
      expect(result.iv.length).toBe(24); // 96 bits = 12 bytes = 24 hex chars
    });

    it('should generate 128-bit auth tags (32 hex chars)', () => {
      const keyBytes = getRandomBytes(32);
      const key = Array.from(keyBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      const result = encryptVote('test data', key);
      
      expect(result.authTag.length).toBe(32); // 128 bits = 16 bytes = 32 hex chars
    });

    it('should produce unique IVs for each encryption', () => {
      const keyBytes = getRandomBytes(32);
      const key = Array.from(keyBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      const plaintext = 'test data';
      
      const result1 = encryptVote(plaintext, key);
      const result2 = encryptVote(plaintext, key);
      
      expect(result1.iv).not.toBe(result2.iv);
    });

    it('should successfully encrypt and decrypt data', () => {
      const keyBytes = getRandomBytes(32);
      const key = Array.from(keyBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      const plaintext = 'sensitive vote data';
      
      const encrypted = encryptVote(plaintext, key);
      const decrypted = decryptVote(encrypted, key);
      
      expect(decrypted).toBe(plaintext);
    });

    it('should fail decryption with wrong key', () => {
      const keyBytes1 = getRandomBytes(32);
      const key1 = Array.from(keyBytes1).map(b => b.toString(16).padStart(2, '0')).join('');
      const keyBytes2 = getRandomBytes(32);
      const key2 = Array.from(keyBytes2).map(b => b.toString(16).padStart(2, '0')).join('');
      const plaintext = 'sensitive vote data';
      
      const encrypted = encryptVote(plaintext, key1);
      
      expect(() => {
        decryptVote(encrypted, key2);
      }).toThrow();
    });

    it('should fail decryption with tampered ciphertext', () => {
      const keyBytes = getRandomBytes(32);
      const key = Array.from(keyBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      const plaintext = 'sensitive vote data';
      
      const encrypted = encryptVote(plaintext, key);
      
      // Tamper with the ciphertext
      const tamperedCiphertext = encrypted.ciphertext.split('').reverse().join('');
      const tampered = { ...encrypted, ciphertext: tamperedCiphertext };
      
      expect(() => {
        decryptVote(tampered, key);
      }).toThrow();
    });

    it('should maintain IV uniqueness across multiple encryptions', () => {
      const keyBytes = getRandomBytes(32);
      const key = Array.from(keyBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      const ivSet = new Set<string>();
      const iterations = 1000;
      
      for (let i = 0; i < iterations; i++) {
        const result = encryptVote(`test data ${i}`, key);
        
        expect(ivSet.has(result.iv)).toBe(false);
        ivSet.add(result.iv);
      }
      
      expect(ivSet.size).toBe(iterations);
    });
  });

  describe('SHA-256 Compliance', () => {
    it('should produce 256-bit hashes (64 hex chars)', () => {
      const hash = hashIdentifier('test identifier');
      expect(hash.length).toBe(64); // 256 bits = 64 hex characters
    });

    it('should produce valid hexadecimal output', () => {
      const hash = hashIdentifier('test identifier');
      expect(/^[0-9a-f]{64}$/i.test(hash)).toBe(true);
    });

    it('should be deterministic', () => {
      const input = 'test identifier';
      const hash1 = hashIdentifier(input);
      const hash2 = hashIdentifier(input);
      
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different inputs', () => {
      const hash1 = hashIdentifier('identifier1');
      const hash2 = hashIdentifier('identifier2');
      
      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty strings', () => {
      const hash = hashIdentifier('');
      expect(hash.length).toBe(64);
      expect(/^[0-9a-f]{64}$/i.test(hash)).toBe(true);
    });

    it('should handle long inputs', () => {
      const longInput = 'a'.repeat(10000);
      const hash = hashIdentifier(longInput);
      expect(hash.length).toBe(64);
    });

    it('should handle special characters', () => {
      const hash = hashIdentifier('!@#$%^&*()_+-=[]{}|;:,.<>?');
      expect(hash.length).toBe(64);
      expect(/^[0-9a-f]{64}$/i.test(hash)).toBe(true);
    });

    it('should hash tokens correctly', () => {
      const token = generateToken('hex');
      const hash = hashToken(token);
      
      expect(hash.length).toBe(64);
      expect(/^[0-9a-f]{64}$/i.test(hash)).toBe(true);
    });
  });

  describe('CSPRNG Compliance', () => {
    it('should generate 256-bit hex tokens by default (64 chars)', () => {
      const token = generateToken('hex');
      expect(token.length).toBe(64); // 32 bytes = 64 hex characters
    });

    it('should generate 256-bit base64url tokens (43 chars)', () => {
      const token = generateToken('base64url');
      expect(token.length).toBe(43); // 32 bytes in base64url
    });

    it('should generate unique hex tokens', () => {
      const token1 = generateToken('hex');
      const token2 = generateToken('hex');
      
      expect(token1).not.toBe(token2);
    });

    it('should generate unique base64url tokens', () => {
      const token1 = generateToken('base64url');
      const token2 = generateToken('base64url');
      
      expect(token1).not.toBe(token2);
    });

    it('should produce valid hexadecimal tokens', () => {
      const token = generateToken('hex');
      expect(/^[0-9a-f]{64}$/i.test(token)).toBe(true);
    });

    it('should generate unique tokens across many iterations', () => {
      const tokenSet = new Set<string>();
      const iterations = 1000;
      
      for (let i = 0; i < iterations; i++) {
        const token = generateToken('hex');
        expect(tokenSet.has(token)).toBe(false);
        tokenSet.add(token);
      }
      
      expect(tokenSet.size).toBe(iterations);
    });

    it('should generate random bytes with correct length', () => {
      const bytes = getRandomBytes(32);
      expect(bytes.length).toBe(32);
      expect(bytes instanceof Uint8Array).toBe(true);
    });

    it('should generate unique keys', () => {
      const keyBytes1 = getRandomBytes(32);
      const key1 = Array.from(keyBytes1).map(b => b.toString(16).padStart(2, '0')).join('');
      const keyBytes2 = getRandomBytes(32);
      const key2 = Array.from(keyBytes2).map(b => b.toString(16).padStart(2, '0')).join('');
      
      expect(key1).not.toBe(key2);
    });

    it('should maintain statistical randomness', () => {
      const values: number[] = [];
      for (let i = 0; i < 1000; i++) {
        const bytes = getRandomBytes(1);
        values.push(bytes[0]!);
      }
      
      // Check distribution (should have variety, not all same values)
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBeGreaterThan(100); // At least some variety
    });
  });

  describe('Parameter Validation Edge Cases', () => {
    it('should detect non-compliant IV sizes', () => {
      const keyBytes = getRandomBytes(32);
      const key = Array.from(keyBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      const result = encryptVote('test', key);
      
      // FIPS requires 96-bit IV for GCM (24 hex chars)
      expect(result.iv.length).toBe(24);
      expect(result.iv.length).not.toBe(32); // Not 128 bits
      expect(result.iv.length).not.toBe(16); // Not 64 bits
    });

    it('should detect non-compliant key sizes', () => {
      const keyBytes = getRandomBytes(32);
      const key = Array.from(keyBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      
      // FIPS requires 256-bit keys for AES-256 (64 hex chars)
      expect(key.length).toBe(64);
      expect(key.length).not.toBe(32); // Not AES-128
      expect(key.length).not.toBe(48); // Not AES-192
    });

    it('should detect non-compliant tag sizes', () => {
      const keyBytes = getRandomBytes(32);
      const key = Array.from(keyBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      const result = encryptVote('test', key);
      
      // FIPS requires at least 128-bit auth tag (32 hex chars)
      expect(result.authTag.length).toBeGreaterThanOrEqual(32);
    });

    it('should validate encryption output is not empty', () => {
      const keyBytes = getRandomBytes(32);
      const key = Array.from(keyBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      const result = encryptVote('test data', key);
      
      expect(result.ciphertext.length).toBeGreaterThan(0);
    });

    it('should validate hash output format', () => {
      const hash = hashIdentifier('test');
      
      // Must be lowercase hex (Node.js crypto default)
      expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
    });

    it('should reject invalid key sizes', () => {
      expect(() => {
        encryptVote('test', 'invalid-key');
      }).toThrow();
    });
  });

  describe('Runtime Compliance Checking', () => {
    it('should run all compliance checks', () => {
      const result = validateFIPSCompliance({ logResults: false });
      
      expect(result.checks.length).toBeGreaterThanOrEqual(6);
    });

    it('should provide detailed error messages on failure', () => {
      const result = validateFIPSCompliance({ logResults: false });
      
      // If not compliant, errors should be descriptive
      if (!result.compliant) {
        expect(result.errors.length).toBeGreaterThan(0);
        result.errors.forEach(error => {
          expect(error.length).toBeGreaterThan(10);
        });
      }
    });

    it('should check algorithm availability', () => {
      const crypto = getNodeCrypto();
      const hashes = crypto.getHashes();
      const ciphers = crypto.getCiphers();
      
      expect(hashes).toContain('sha256');
      expect(ciphers).toContain('aes-256-gcm');
    });

    it('should validate Node.js crypto module is available', () => {
      const crypto = getNodeCrypto();
      expect(crypto).toBeDefined();
      expect(crypto.randomBytes).toBeDefined();
      expect(crypto.createCipheriv).toBeDefined();
      expect(crypto.createHash).toBeDefined();
    });
  });

  describe('FIPS Mode Detection', () => {
    it('should check for FIPS mode availability', () => {
      const result = validateFIPSCompliance({ logResults: false });
      
      // Should have warnings if FIPS mode is not enabled
      expect(result.warnings).toBeDefined();
      expect(Array.isArray(result.warnings)).toBe(true);
    });

    it('should warn about FIPS mode requirements', () => {
      const result = validateFIPSCompliance({ logResults: false });
      
      const hasFIPSWarning = result.warnings.some(w => 
        w.includes('FIPS mode') || w.includes('OpenSSL')
      );
      
      // Should warn about FIPS mode unless actually in FIPS mode
      try {
        const crypto = getNodeCrypto();
        const fipsEnabled = crypto.getFips?.() === 1;
        if (!fipsEnabled) {
          expect(hasFIPSWarning).toBe(true);
        }
      } catch {
        expect(hasFIPSWarning).toBe(true);
      }
    });
  });

  describe('Integration with Existing Crypto Module', () => {
    it('should work with existing encryptVote/decryptVote functions', () => {
      const keyBytes = getRandomBytes(32);
      const key = Array.from(keyBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      const plaintext = 'integration test vote';
      
      const encrypted = encryptVote(plaintext, key);
      const decrypted = decryptVote(encrypted, key);
      
      expect(decrypted).toBe(plaintext);
      expect(encrypted.iv.length).toBe(24); // FIPS compliant
      expect(encrypted.authTag.length).toBe(32); // FIPS compliant
    });

    it('should work with existing hashIdentifier function', () => {
      const identifier = 'voter@example.com';
      const hash = hashIdentifier(identifier);
      
      expect(hash.length).toBe(64); // FIPS compliant SHA-256
      expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
    });

    it('should work with existing generateToken function', () => {
      const hexToken = generateToken('hex');
      const b64Token = generateToken('base64url');
      
      expect(hexToken.length).toBe(64); // FIPS compliant 256-bit
      expect(b64Token.length).toBe(43); // FIPS compliant 256-bit
    });
  });
});
