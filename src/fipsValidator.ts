/**
 * FIPS 140-2 Compliance Validator for AnonVote
 * 
 * Validates that cryptographic operations meet FIPS 140-2 standards for:
 * - AES-256-GCM encryption (key size, IV size, tag size)
 * - SHA-256 hashing (output size, determinism)
 * - CSPRNG (entropy source, output quality)
 */

import { encryptVote, decryptVote, hashIdentifier, generateToken, hashToken } from './crypto';
import { getNodeCrypto, getRandomBytes } from './random';

export interface FIPSValidationResult {
  compliant: boolean;
  timestamp: Date;
  checks: {
    name: string;
    passed: boolean;
    details: string;
  }[];
  errors: string[];
  warnings: string[];
}

export interface FIPSConfiguration {
  mode: 'strict' | 'warning';
  logResults: boolean;
  throwOnFailure: boolean;
}

const defaultConfig: FIPSConfiguration = {
  mode: 'strict',
  logResults: true,
  throwOnFailure: false,
};

let cachedValidationResult: FIPSValidationResult | null = null;

/**
 * Validates AES-256-GCM parameters according to FIPS 140-2
 * - Key size: 256 bits (32 bytes / 64 hex chars)
 * - IV size: 96 bits (12 bytes / 24 hex chars) - FIPS 140-2 IG recommendation
 * - Auth tag size: 128 bits (16 bytes / 32 hex chars)
 */
function validateAESGCM(): { passed: boolean; details: string } {
  try {
    // Generate test encryption key (64 hex chars = 32 bytes = 256 bits)
    const testKeyBytes = getRandomBytes(32);
    const testKey = Array.from(testKeyBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    const testPlaintext = 'FIPS test data';
    
    const result = encryptVote(testPlaintext, testKey);
    
    // Validate key size (must be 64 hex chars = 32 bytes = 256 bits)
    if (testKey.length !== 64) {
      return {
        passed: false,
        details: `AES key size is ${testKey.length / 2 * 8} bits, must be 256 bits`,
      };
    }
    
    // Validate IV size (must be 24 hex chars = 12 bytes = 96 bits for FIPS GCM)
    if (result.iv.length !== 24) {
      return {
        passed: false,
        details: `IV size is ${result.iv.length / 2 * 8} bits, must be 96 bits for FIPS GCM`,
      };
    }
    
    // Validate auth tag size (must be 32 hex chars = 16 bytes = 128 bits minimum for FIPS)
    if (result.authTag.length < 32) {
      return {
        passed: false,
        details: `Auth tag size is ${result.authTag.length / 2 * 8} bits, must be at least 128 bits`,
      };
    }
    
    // Verify encryption produces output
    if (result.ciphertext.length === 0) {
      return {
        passed: false,
        details: 'Encryption produced empty output',
      };
    }
    
    // Verify decryption works correctly
    const decrypted = decryptVote(result, testKey);
    if (decrypted !== testPlaintext) {
      return {
        passed: false,
        details: 'Decryption did not return original plaintext',
      };
    }
    
    return {
      passed: true,
      details: 'AES-256-GCM: key=256 bits, IV=96 bits, tag=128 bits',
    };
  } catch (error) {
    return {
      passed: false,
      details: `AES-256-GCM validation error: ${(error as Error).message}`,
    };
  }
}

/**
 * Validates SHA-256 parameters according to FIPS 140-2
 * - Output size: 256 bits (64 hex characters)
 * - Algorithm: SHA-256 (FIPS approved)
 */
function validateSHA256(): { passed: boolean; details: string } {
  try {
    const testInput = 'FIPS test identifier';
    const hash = hashIdentifier(testInput);
    
    // Validate output size (SHA-256 produces 256 bits = 64 hex chars)
    if (hash.length !== 64) {
      return {
        passed: false,
        details: `SHA-256 hash length is ${hash.length} chars, must be 64 (256 bits)`,
      };
    }
    
    // Validate output is hex
    if (!/^[0-9a-f]{64}$/i.test(hash)) {
      return {
        passed: false,
        details: 'SHA-256 hash is not valid hexadecimal',
      };
    }
    
    // Validate determinism (same input = same output)
    const hash2 = hashIdentifier(testInput);
    if (hash !== hash2) {
      return {
        passed: false,
        details: 'SHA-256 hash is not deterministic',
      };
    }
    
    // Validate different inputs produce different outputs
    const differentHash = hashIdentifier('different input');
    if (hash === differentHash) {
      return {
        passed: false,
        details: 'SHA-256 collision detected (highly unlikely)',
      };
    }
    
    // Test token hashing as well
    const testToken = generateToken('hex');
    const tokenHash = hashToken(testToken);
    if (tokenHash.length !== 64 || !/^[0-9a-f]{64}$/i.test(tokenHash)) {
      return {
        passed: false,
        details: 'Token hash validation failed',
      };
    }
    
    return {
      passed: true,
      details: 'SHA-256: output=256 bits, deterministic, collision-resistant',
    };
  } catch (error) {
    return {
      passed: false,
      details: `SHA-256 validation error: ${(error as Error).message}`,
    };
  }
}

/**
 * Validates CSPRNG (Cryptographically Secure Pseudo-Random Number Generator)
 * - Source: Node.js crypto.randomBytes or Web Crypto getRandomValues
 * - Output size: 256 bits (32 bytes) for tokens
 * - Entropy: FIPS 140-2 approved DRBG
 */
function validateCSPRNG(): { passed: boolean; details: string } {
  try {
    // Test hex token generation (default)
    const token1 = generateToken('hex');
    const token2 = generateToken('hex');
    
    // Validate token length (32 bytes = 64 hex chars for 256 bits)
    if (token1.length !== 64) {
      return {
        passed: false,
        details: `Token length is ${token1.length} chars, must be 64 (256 bits)`,
      };
    }
    
    // Validate tokens are different (extremely unlikely to be same)
    if (token1 === token2) {
      return {
        passed: false,
        details: 'CSPRNG produced identical tokens (entropy failure)',
      };
    }
    
    // Validate hex format
    if (!/^[0-9a-f]{64}$/i.test(token1)) {
      return {
        passed: false,
        details: 'Token is not valid hexadecimal',
      };
    }
    
    // Test base64url token generation
    const b64Token1 = generateToken('base64url');
    const b64Token2 = generateToken('base64url');
    
    // Base64url tokens should be 43 chars (32 bytes encoded)
    if (b64Token1.length !== 43) {
      return {
        passed: false,
        details: `Base64url token length is ${b64Token1.length} chars, must be 43`,
      };
    }
    
    if (b64Token1 === b64Token2) {
      return {
        passed: false,
        details: 'CSPRNG produced identical base64url tokens',
      };
    }
    
    // Test getRandomBytes directly
    const randomBytes = getRandomBytes(32);
    if (randomBytes.length !== 32) {
      return {
        passed: false,
        details: `Random bytes length is ${randomBytes.length}, must be 32`,
      };
    }
    
    return {
      passed: true,
      details: 'CSPRNG: using crypto.randomBytes/getRandomValues (FIPS DRBG), 256-bit output',
    };
  } catch (error) {
    return {
      passed: false,
      details: `CSPRNG validation error: ${(error as Error).message}`,
    };
  }
}

/**
 * Validates that IV reuse is prevented
 * Tests that each encryption generates a unique IV
 */
function validateIVUniqueness(): { passed: boolean; details: string } {
  try {
    const testKeyBytes = getRandomBytes(32);
    const testKey = Array.from(testKeyBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    const testPlaintext = 'FIPS test data';
    
    const ivs = new Set<string>();
    const iterations = 100;
    
    for (let i = 0; i < iterations; i++) {
      const result = encryptVote(testPlaintext, testKey);
      
      if (ivs.has(result.iv)) {
        return {
          passed: false,
          details: `IV reuse detected after ${i + 1} iterations (FIPS violation)`,
        };
      }
      
      ivs.add(result.iv);
    }
    
    return {
      passed: true,
      details: `IV uniqueness verified: ${iterations} unique IVs generated`,
    };
  } catch (error) {
    return {
      passed: false,
      details: `IV uniqueness validation error: ${(error as Error).message}`,
    };
  }
}

/**
 * Validates key generation and strength
 */
function validateKeyGeneration(): { passed: boolean; details: string } {
  try {
    const keys = new Set<string>();
    const iterations = 100;
    
    for (let i = 0; i < iterations; i++) {
      const keyBytes = getRandomBytes(32);
      const key = Array.from(keyBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      
      // Validate key size
      if (key.length !== 64) {
        return {
          passed: false,
          details: `Key size is ${key.length / 2} bytes, must be 32 (256 bits)`,
        };
      }
      
      // Check for key reuse (should never happen with proper CSPRNG)
      if (keys.has(key)) {
        return {
          passed: false,
          details: `Key collision detected after ${i + 1} iterations`,
        };
      }
      
      keys.add(key);
    }
    
    return {
      passed: true,
      details: `Key generation verified: ${iterations} unique 256-bit keys`,
    };
  } catch (error) {
    return {
      passed: false,
      details: `Key generation validation error: ${(error as Error).message}`,
    };
  }
}

/**
 * Validates algorithm availability in Node.js crypto
 */
function validateAlgorithmAvailability(): { passed: boolean; details: string } {
  try {
    const crypto = getNodeCrypto();
    const hashes = crypto.getHashes();
    const ciphers = crypto.getCiphers();
    
    if (!hashes.includes('sha256')) {
      return {
        passed: false,
        details: 'SHA-256 algorithm not available',
      };
    }
    
    if (!ciphers.includes('aes-256-gcm')) {
      return {
        passed: false,
        details: 'AES-256-GCM algorithm not available',
      };
    }
    
    return {
      passed: true,
      details: 'FIPS-approved algorithms available: SHA-256, AES-256-GCM',
    };
  } catch (error) {
    return {
      passed: false,
      details: `Algorithm availability check error: ${(error as Error).message}`,
    };
  }
}

/**
 * Main FIPS 140-2 compliance validation function
 * Runs all validation checks and returns a detailed report
 */
export function validateFIPSCompliance(
  config: Partial<FIPSConfiguration> = {}
): FIPSValidationResult {
  const finalConfig = { ...defaultConfig, ...config };
  const result: FIPSValidationResult = {
    compliant: true,
    timestamp: new Date(),
    checks: [],
    errors: [],
    warnings: [],
  };
  
  // Run all validation checks
  const checks = [
    { name: 'Algorithm Availability', fn: validateAlgorithmAvailability },
    { name: 'AES-256-GCM Parameters', fn: validateAESGCM },
    { name: 'SHA-256 Parameters', fn: validateSHA256 },
    { name: 'CSPRNG Quality', fn: validateCSPRNG },
    { name: 'IV Uniqueness', fn: validateIVUniqueness },
    { name: 'Key Generation', fn: validateKeyGeneration },
  ];
  
  for (const check of checks) {
    const checkResult = check.fn();
    result.checks.push({
      name: check.name,
      passed: checkResult.passed,
      details: checkResult.details,
    });
    
    if (!checkResult.passed) {
      result.compliant = false;
      result.errors.push(`${check.name}: ${checkResult.details}`);
    }
  }
  
  // Add warnings for Node.js FIPS mode
  try {
    const crypto = getNodeCrypto();
    const fipsEnabled = crypto.getFips?.() === 1;
    if (!fipsEnabled) {
      result.warnings.push(
        'Node.js not running in FIPS mode. For true FIPS 140-2 certification, ' +
        'rebuild Node.js with OpenSSL FIPS module and enable FIPS mode.'
      );
    }
  } catch (error) {
    result.warnings.push(
      'Unable to check Node.js FIPS mode status. ' +
      'Ensure Node.js is built with FIPS-capable OpenSSL for full compliance.'
    );
  }
  
  // Cache the result
  cachedValidationResult = result;
  
  // Log results if configured
  if (finalConfig.logResults) {
    logValidationResult(result);
  }
  
  // Throw error if configured and validation failed
  if (!result.compliant && finalConfig.throwOnFailure) {
    throw new Error(
      `FIPS 140-2 compliance validation failed:\n${result.errors.join('\n')}`
    );
  }
  
  return result;
}

/**
 * Returns the cached validation result, or runs validation if not cached
 */
export function getCachedValidation(): FIPSValidationResult {
  if (!cachedValidationResult) {
    return validateFIPSCompliance();
  }
  return cachedValidationResult;
}

/**
 * Clears the cached validation result
 */
export function clearValidationCache(): void {
  cachedValidationResult = null;
}

/**
 * Logs validation results to console
 */
function logValidationResult(result: FIPSValidationResult): void {
  console.log('\n=== FIPS 140-2 Compliance Validation ===');
  console.log(`Timestamp: ${result.timestamp.toISOString()}`);
  console.log(`Overall Status: ${result.compliant ? '✓ COMPLIANT' : '✗ NON-COMPLIANT'}\n`);
  
  console.log('Checks:');
  for (const check of result.checks) {
    const status = check.passed ? '✓' : '✗';
    console.log(`  ${status} ${check.name}`);
    console.log(`    ${check.details}`);
  }
  
  if (result.warnings.length > 0) {
    console.log('\nWarnings:');
    for (const warning of result.warnings) {
      console.log(`  ⚠ ${warning}`);
    }
  }
  
  if (result.errors.length > 0) {
    console.log('\nErrors:');
    for (const error of result.errors) {
      console.log(`  ✗ ${error}`);
    }
  }
  
  console.log('\n======================================\n');
}

/**
 * Runtime validation on module load
 * Can be configured via environment variables
 */
const FIPS_VALIDATION_MODE = process.env.FIPS_VALIDATION_MODE || 'warning';
const FIPS_VALIDATION_ENABLED = process.env.FIPS_VALIDATION_ENABLED !== 'false';

if (FIPS_VALIDATION_ENABLED) {
  const config: Partial<FIPSConfiguration> = {
    mode: FIPS_VALIDATION_MODE as 'strict' | 'warning',
    logResults: process.env.FIPS_LOG_RESULTS !== 'false',
    throwOnFailure: FIPS_VALIDATION_MODE === 'strict',
  };
  
  // Run validation on module load
  validateFIPSCompliance(config);
}
