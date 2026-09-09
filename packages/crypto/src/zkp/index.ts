/**
 * @anonvote/crypto - ZKP & Homomorphic Encryption Subsystem
 *
 * Provides cryptographic primitives for Zero-Knowledge Proofs (ZKP),
 * Additive Homomorphic Encryption (Paillier), Pedersen Commitments,
 * K-of-N Threshold Decryption, and Merkle Inclusion Proofs.
 */

// Core Math
export {
  mod,
  gcd,
  lcm,
  extendedGcd,
  modInverse,
  modPow,
  hexToBigInt,
  bigIntToHex,
  randomBigInt,
  randomCoprime,
  isProbablePrime,
  generatePrime,
} from "./math";

// Paillier Additive Homomorphic Cryptosystem
export {
  paillierL,
  generatePaillierKeyPair,
  encryptPaillier,
  decryptPaillier,
  addPaillier,
  aggregatePaillier,
  multiplyPaillier,
} from "./paillier";

// Pedersen Commitments
export {
  generatePedersenParams,
  commitPedersen,
  verifyPedersenCommitment,
  addPedersenCommitments,
} from "./pedersen";
export type { PedersenParams, PedersenCommitment } from "./pedersen";

// Zero-Knowledge Proofs
export {
  generateBinaryValidityProof,
  verifyBinaryValidityProof,
  createHomomorphicVote,
  verifyHomomorphicVote,
  tallyHomomorphicVotes,
  verifyTallyDecryptionProof,
} from "./proofs";

// Threshold Decryption
export {
  generateThresholdKeyShares,
  generatePartialDecryption,
  combineThresholdDecryptions,
} from "./threshold";

// Merkle Tree Inclusion
export {
  buildMerkleTree,
  generateMerkleProof,
  verifyMerkleProof,
} from "./merkle";

// Types
export type {
  PaillierPublicKey,
  PaillierPrivateKey,
  PaillierKeyPair,
  PaillierCiphertext,
  HomomorphicEncryptedVote,
  BinaryValidityProof,
  BallotValidityProof,
  TallyDecryptionProof,
  ThresholdKeyShare,
  PartialDecryptionShare,
  ThresholdDecryptionResult,
  MerkleProof,
  MerkleTreeCommitment,
  ZKPVerificationReport,
} from "./types";
