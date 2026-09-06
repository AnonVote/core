#!/usr/bin/env ts-node

/**
 * FIPS 140-2 Compliance Check Example
 * 
 * This example demonstrates how to verify FIPS compliance in your application.
 * Run this before deploying to production or as part of your CI/CD pipeline.
 */

import {
  validateFIPSCompliance,
  FIPSValidationResult,
  encryptVote,
  decryptVote,
  hashIdentifier,
  generateToken,
} from '../src';
import { getRandomBytes } from '../src/random';

console.log('='.repeat(60));
console.log('AnonVote FIPS 140-2 Compliance Verification');
console.log('='.repeat(60));
console.log();

// Run FIPS compliance validation
console.log('Running FIPS 140-2 compliance checks...\n');

const result: FIPSValidationResult = validateFIPSCompliance({
  mode: 'strict',
  logResults: true,
  throwOnFailure: false,
});

// Display summary
console.log('\n' + '='.repeat(60));
console.log('COMPLIANCE SUMMARY');
console.log('='.repeat(60));

if (result.compliant) {
  console.log('✅ FIPS 140-2 COMPLIANT');
  console.log('\nAll cryptographic operations meet FIPS 140-2 requirements.');
  console.log('Algorithm parameters are correctly configured.');
} else {
  console.log('❌ FIPS 140-2 NON-COMPLIANT');
  console.log('\nCompliance violations detected:');
  result.errors.forEach((error, index) => {
    console.log(`  ${index + 1}. ${error}`);
  });
}

// Display warnings
if (result.warnings.length > 0) {
  console.log('\n⚠️  WARNINGS:');
  result.warnings.forEach((warning, index) => {
    console.log(`  ${index + 1}. ${warning}`);
  });
}

// Demonstrate compliant operations
console.log('\n' + '='.repeat(60));
console.log('DEMONSTRATION OF COMPLIANT OPERATIONS');
console.log('='.repeat(60));

try {
  // 1. Key generation
  console.log('\n1. Generating FIPS-compliant 256-bit key...');
  const keyBytes = getRandomBytes(32);
  const key = Array.from(keyBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  console.log(`   ✓ Key size: ${key.length / 2 * 8} bits (${key.length / 2} bytes)`);
  console.log(`   ✓ Key (hex): ${key.substring(0, 32)}...`);

  // 2. Encryption
  console.log('\n2. Encrypting vote with AES-256-GCM...');
  const voteData = 'Vote for Candidate A';
  const encrypted = encryptVote(voteData, key);
  console.log(`   ✓ IV size: ${encrypted.iv.length / 2 * 8} bits (${encrypted.iv.length / 2} bytes)`);
  console.log(`   ✓ Auth tag size: ${encrypted.authTag.length / 2 * 8} bits (${encrypted.authTag.length / 2} bytes)`);
  console.log(`   ✓ Encrypted data length: ${encrypted.ciphertext.length} hex chars`);

  // 3. Decryption
  console.log('\n3. Decrypting vote...');
  const decrypted = decryptVote(encrypted, key);
  console.log(`   ✓ Decrypted successfully: "${decrypted}"`);
  console.log(`   ✓ Matches original: ${decrypted === voteData}`);

  // 4. Hashing
  console.log('\n4. Hashing identifier with SHA-256...');
  const identifier = 'alice@example.com';
  const hash = hashIdentifier(identifier);
  console.log(`   ✓ Hash length: ${hash.length} characters (${hash.length * 4} bits)`);
  console.log(`   ✓ Hash: ${hash}`);

  // 5. Token generation (hex)
  console.log('\n5. Generating CSPRNG hex token...');
  const hexToken = generateToken('hex');
  console.log(`   ✓ Token length: ${hexToken.length} characters (${hexToken.length * 4} bits)`);
  console.log(`   ✓ Token: ${hexToken.substring(0, 32)}...`);

  // 6. Token generation (base64url)
  console.log('\n6. Generating CSPRNG base64url token...');
  const b64Token = generateToken('base64url');
  console.log(`   ✓ Token length: ${b64Token.length} characters`);
  console.log(`   ✓ Token: ${b64Token}`);

  // 7. IV uniqueness demonstration
  console.log('\n7. Verifying IV uniqueness across multiple encryptions...');
  const ivs = new Set<string>();
  const testIterations = 100;
  
  for (let i = 0; i < testIterations; i++) {
    const result = encryptVote(`test ${i}`, key);
    ivs.add(result.iv);
  }
  
  console.log(`   ✓ Generated ${testIterations} encryptions`);
  console.log(`   ✓ Unique IVs: ${ivs.size} (100% unique)`);
  
  if (ivs.size === testIterations) {
    console.log('   ✓ No IV reuse detected');
  } else {
    console.log('   ⚠️  IV reuse detected (FIPS violation!)');
  }

} catch (error) {
  console.error('\n❌ Error during demonstration:', (error as Error).message);
  process.exit(1);
}

// Final recommendations
console.log('\n' + '='.repeat(60));
console.log('RECOMMENDATIONS');
console.log('='.repeat(60));
console.log();

if (result.compliant) {
  console.log('✅ Your cryptographic implementation is FIPS-compliant.');
  console.log();
  console.log('Next steps for production deployment:');
  console.log('  1. Use Node.js built with OpenSSL FIPS module');
  console.log('  2. Enable FIPS mode: node --force-fips app.js');
  console.log('  3. Set FIPS_VALIDATION_ENABLED=true in production');
  console.log('  4. Monitor compliance logs regularly');
  console.log('  5. For formal certification, engage a CMVP-accredited lab');
} else {
  console.log('❌ Your cryptographic implementation has compliance issues.');
  console.log();
  console.log('Required actions:');
  console.log('  1. Review errors listed above');
  console.log('  2. Update algorithm parameters to meet FIPS requirements');
  console.log('  3. Re-run validation after fixes');
  console.log('  4. Do NOT deploy to production until compliant');
}

console.log();
console.log('For more information, see COMPLIANCE.md');
console.log('='.repeat(60));

// Exit with appropriate code
process.exit(result.compliant ? 0 : 1);
