# FIPS 140-2 Compliance Documentation

## Overview

AnonVote implements cryptographic operations using FIPS 140-2 approved algorithms and parameters. This document details our compliance status, certified functions, limitations, and validation procedures.

## FIPS 140-2 Compliance Status

### ✅ Compliant Components

#### AES-256-GCM Encryption
- **Standard**: FIPS 197 (AES), FIPS 140-2 Annex A
- **Algorithm**: AES-256-GCM (Advanced Encryption Standard with Galois/Counter Mode)
- **Key Size**: 256 bits (32 bytes / 64 hex chars) - Fixed, not configurable
- **IV Size**: 96 bits (12 bytes / 24 hex chars) - Fixed per FIPS 140-2 IG requirement
- **Auth Tag Size**: 128 bits (16 bytes / 32 hex chars) - Fixed minimum per FIPS
- **Implementation**: Node.js `crypto.createCipheriv('aes-256-gcm', ...)`
- **Functions**:
  - `encryptVote(option, key)` - Encrypts vote data
  - `decryptVote(payload, key)` - Decrypts vote data

**FIPS Requirements Met**:
- ✅ Key size exactly 256 bits (FIPS 197)
- ✅ IV size exactly 96 bits (FIPS 140-2 IG D.9)
- ✅ Auth tag minimum 128 bits (FIPS 140-2)
- ✅ Unique IV per encryption operation
- ✅ No IV reuse (prevents nonce reuse vulnerability)

#### SHA-256 Hashing
- **Standard**: FIPS 180-4 (Secure Hash Standard)
- **Algorithm**: SHA-256
- **Output Size**: 256 bits (64 hexadecimal characters) - Fixed
- **Implementation**: Node.js `crypto.createHash('sha256')`
- **Functions**:
  - `hashIdentifier(id)` - Hashes user identifiers  
  - `hashToken(token)` - Hashes voter tokens

**FIPS Requirements Met**:
- ✅ Output size exactly 256 bits
- ✅ Deterministic hash function
- ✅ Collision-resistant
- ✅ Pre-image resistant

#### CSPRNG (Cryptographically Secure Pseudo-Random Number Generator)
- **Standard**: FIPS 140-2 Approved DRBG (Deterministic Random Bit Generator)
- **Implementation**: 
  - Web Crypto API `crypto.getRandomValues()` (preferred)
  - Node.js `crypto.randomBytes()` (fallback)
- **Token Size**: 256 bits (32 bytes) - Default
- **Entropy Source**: System entropy pool via platform CSPRNG
- **Functions**:
  - `generateToken(encoding)` - Generates random tokens (hex or base64url)
  - `getRandomBytes(size)` - Generates random bytes

**FIPS Requirements Met**:
- ✅ Uses approved DRBG (platform CSPRNG)
- ✅ Sufficient entropy (256 bits minimum)
- ✅ Unpredictable output
- ✅ Cross-runtime support (Node.js, browsers, edge runtimes)

### 📋 FIPS Parameter Matrix

| Component | Parameter | FIPS Requirement | AnonVote Value | Configurable |
|-----------|-----------|------------------|----------------|--------------|
| AES-256-GCM | Key Size | 256 bits | 256 bits (64 hex) | ❌ Fixed |
| AES-256-GCM | IV Size | 96 bits | 96 bits (24 hex) | ❌ Fixed |
| AES-256-GCM | Tag Size | ≥128 bits | 128 bits (32 hex) | ❌ Fixed |
| SHA-256 | Output Size | 256 bits | 256 bits (64 hex) | ❌ Fixed |
| CSPRNG | Token Size | ≥256 bits | 256 bits (default) | ❌ Fixed |
| CSPRNG | Random Bytes | Variable | As requested | ✅ Configurable |

## Automated Validation

### Validation Module

The `fipsValidator.ts` module provides automated compliance validation:

```typescript
import { validateFIPSCompliance } from '@anonvote/crypto';

// Run validation
const result = validateFIPSCompliance({
  mode: 'strict',        // 'strict' or 'warning'
  logResults: true,      // Log to console
  throwOnFailure: false  // Throw exception on failure
});

console.log('Compliant:', result.compliant);
console.log('Errors:', result.errors);
console.log('Warnings:', result.warnings);
```

### Validation Checks

The validator performs the following checks:

1. **Algorithm Availability** - Verifies SHA-256 and AES-256-GCM are available
2. **AES-256-GCM Parameters** - Validates key, IV, and tag sizes
3. **SHA-256 Parameters** - Validates output size and determinism
4. **CSPRNG Quality** - Validates entropy source and output uniqueness
5. **IV Uniqueness** - Verifies no IV reuse across multiple encryptions
6. **Key Generation** - Validates key size and uniqueness

### Runtime Validation

Validation runs automatically on module load and can be configured via environment variables:

```bash
# Enable/disable validation
export FIPS_VALIDATION_ENABLED=true

# Set validation mode (warning or strict)
export FIPS_VALIDATION_MODE=warning

# Enable/disable logging
export FIPS_LOG_RESULTS=true
```

In **strict mode**, the module will throw an error if validation fails, preventing the application from starting with non-compliant cryptography.

## Testing

### Test Suite

Comprehensive FIPS compliance tests are located in `tests/fipsCompliance.test.ts`:

```bash
# Run FIPS compliance tests
npm test tests/fipsCompliance.test.ts
```

### Test Coverage

- ✅ 20+ FIPS compliance tests
- ✅ Algorithm parameter validation
- ✅ Edge case testing (IV reuse, key collisions, etc.)
- ✅ Statistical randomness verification
- ✅ Encryption/decryption correctness
- ✅ Hash determinism and uniqueness
- ✅ Runtime validation checks
- ✅ Integration with existing crypto module

## Continuous Integration

### GitHub Actions Workflow

FIPS compliance is validated on every PR via `.github/workflows/fips-compliance.yml`:

```yaml
- name: Run FIPS Compliance Tests
  run: npm test tests/fipsCompliance.test.ts

- name: Validate FIPS Compliance  
  run: npm run validate:fips
```

The CI pipeline:
1. Runs all FIPS compliance tests
2. Executes runtime validation
3. Generates compliance report artifact
4. **Fails the build** if any compliance check fails

## Limitations

### ⚠️ Important Limitations

1. **Node.js FIPS Mode**
   - AnonVote uses FIPS-approved algorithms and parameters
   - However, **true FIPS 140-2 certification requires Node.js built with OpenSSL FIPS module**
   - Standard Node.js builds use OpenSSL but may not be FIPS-certified
   - For production compliance, use Node.js built with `--openssl-fips` flag

2. **OpenSSL Version**
   - Requires OpenSSL 1.0.2+ with FIPS module or OpenSSL 3.0+ with FIPS provider
   - Check OpenSSL version: `node -p "process.versions.openssl"`

3. **Platform Dependencies**
   - FIPS compliance depends on underlying OS and crypto libraries
   - System entropy pool must provide sufficient entropy

4. **Cross-Runtime Support**
   - Library supports multiple runtimes (Node.js, browsers, edge)
   - FIPS validation currently requires Node.js `crypto` module
   - Edge runtimes use Web Crypto API for operations but validation requires Node.js

5. **Audit Requirements**
   - Full FIPS 140-2 certification requires third-party audit (e.g., CMVP lab)
   - This implementation meets FIPS *parameters* but is not formally certified
   - Organizations requiring certification should engage an accredited lab

### Enabling Node.js FIPS Mode

To run Node.js in FIPS mode:

```bash
# Check if FIPS is available
node -p "crypto.getFips()"

# Enable FIPS mode (if supported)
node --force-fips app.js

# Or set programmatically
import { setFips } from 'crypto';
setFips(1);
```

## FIPS 140-2 Standard References

### Official Standards

- **FIPS 197**: Advanced Encryption Standard (AES)
  - Specifies AES algorithm and key sizes (128, 192, 256 bits)
  
- **FIPS 180-4**: Secure Hash Standard (SHS)
  - Specifies SHA-256 and other hash functions
  
- **FIPS 140-2**: Security Requirements for Cryptographic Modules
  - Defines requirements for cryptographic module validation
  - Annex A: Approved Security Functions
  - Annex C: Approved Random Number Generators

### Implementation Guidance

- **FIPS 140-2 Implementation Guidance (IG)**: Section D.9 (GCM IV)
  - Recommends 96-bit IV for GCM mode
  - Prohibits IV reuse with the same key
  
- **NIST SP 800-38D**: Recommendation for GCM
  - Details GCM mode operation
  - Section 8: Uniqueness requirement on IVs

- **NIST SP 800-90A**: Recommendation for Random Number Generation
  - Specifies approved DRBGs (Deterministic Random Bit Generators)

### External Resources

- [NIST FIPS Publications](https://csrc.nist.gov/publications/fips)
- [CMVP (Cryptographic Module Validation Program)](https://csrc.nist.gov/projects/cryptographic-module-validation-program)
- [OpenSSL FIPS Module](https://www.openssl.org/docs/fips.html)
- [Node.js Crypto Documentation](https://nodejs.org/api/crypto.html)

## Compliance Checklist

For third-party consumers verifying FIPS compliance:

- ✅ Use only provided crypto functions (`encryptVote`, `decryptVote`, `hashIdentifier`, etc.)
- ✅ Do not modify algorithm parameters (key size, IV size, tag size)
- ✅ Run `validateFIPSCompliance()` before production deployment
- ✅ Enable runtime validation in production (`FIPS_VALIDATION_ENABLED=true`)
- ✅ Use Node.js built with FIPS-capable OpenSSL for full compliance
- ✅ Run in Node.js FIPS mode (`--force-fips` flag) if required
- ✅ Monitor validation logs for compliance warnings
- ✅ Run FIPS compliance tests in CI/CD pipeline
- ⚠️ If required, engage accredited lab for formal FIPS 140-2 certification

## Runtime Support

The cryptographic functions work across multiple JavaScript runtimes:

- **Node.js** (14+): Full support including FIPS validation
- **Browsers**: Full encryption/decryption support via Web Crypto API
- **Cloudflare Workers**: Supported with `nodejs_compat` flag
- **Vercel Edge Functions**: Supported
- **Deno**: Supported

FIPS validation (the `validateFIPSCompliance` function) currently requires Node.js.

## Contact and Support

For FIPS compliance questions or concerns:
- Open an issue on GitHub
- Review automated validation reports in CI artifacts
- Consult COMPLIANCE.md (this file)
- For formal certification, contact a CMVP-accredited testing laboratory

## Changelog

### Version 0.1.0 (FIPS Implementation)
- ✅ Added automated FIPS 140-2 compliance validation module
- ✅ Validated existing AES-256-GCM implementation (256-bit keys, 96-bit IVs, 128-bit tags)
- ✅ Validated existing SHA-256 hashing implementation
- ✅ Validated existing CSPRNG implementation
- ✅ Added 20+ comprehensive compliance tests
- ✅ Integrated validation into CI/CD pipeline
- ✅ Documented compliance status and limitations
- ✅ Added runtime validation with configurable modes

---

**Last Updated**: 2026-08-27  
**FIPS Standards Version**: FIPS 140-2, FIPS 197, FIPS 180-4  
**Compliance Status**: Algorithm and Parameter Compliant (not formally certified)  
**Library Version**: 0.1.0
