/**
 * @anonvote/crypto - ZKP and Homomorphic Encryption Types
 *
 * Defines cryptographic types, interfaces, and data structures for
 * zero-knowledge proof generation, verification, additive homomorphic
 * encryption (Paillier), threshold decryption, and Merkle tree inclusion.
 */

/**
 * Public key for Paillier additive homomorphic encryption.
 */
export interface PaillierPublicKey {
  /** Modulus n = p * q as hex string */
  n: string;
  /** g = n + 1 (or other generator) as hex string */
  g: string;
  /** n^2 as hex string for modulus operations */
  nSquared: string;
  /** Key bit length (e.g., 2048, 3072, 4096) */
  bits: number;
}

/**
 * Private key for Paillier additive homomorphic decryption.
 */
export interface PaillierPrivateKey {
  /** Lambda = lcm(p - 1, q - 1) as hex string */
  lambda: string;
  /** Mu = (L(g^lambda mod n^2))^-1 mod n as hex string */
  mu: string;
  /** Corresponding public key */
  publicKey: PaillierPublicKey;
}

/**
 * Key pair for Paillier cryptosystem.
 */
export interface PaillierKeyPair {
  publicKey: PaillierPublicKey;
  privateKey: PaillierPrivateKey;
}

/**
 * Serialized Paillier ciphertext represented as a hex string.
 */
export interface PaillierCiphertext {
  /** Hex string of ciphertext c in Z*_{n^2} */
  c: string;
}

/**
 * Homomorphic encrypted vote containing ciphertexts for all election options
 * and a zero-knowledge validity proof.
 */
export interface HomomorphicEncryptedVote {
  /** Ballot ID / Election ID */
  ballotId: string;
  /** Array of Paillier ciphertexts, one per election option (1 for selected, 0 for others) */
  encryptedVector: PaillierCiphertext[];
  /** Combined ciphertext of vector sum: Enc(sum(v_i)) */
  sumCiphertext: PaillierCiphertext;
  /** Non-interactive Zero-Knowledge proof that vote is well-formed (exactly one option selected) */
  validityProof: BallotValidityProof;
  /** ISO timestamp of vote generation */
  timestamp: string;
  /** Unique voter commitment / receipt hash */
  receiptHash: string;
}

/**
 * Non-interactive Zero-Knowledge Proof (NIZK) proving a ciphertext is an encryption
 * of 0 or 1 (1-of-2 Disjunctive Chaum-Pedersen / CDS94 style), plus proof that
 * the sum of selections is exactly 1.
 */
export interface BinaryValidityProof {
  /** Commitment a0 for b = 0 branch */
  a0: string;
  /** Commitment a1 for b = 1 branch */
  a1: string;
  /** Challenge e0 */
  e0: string;
  /** Challenge e1 */
  e1: string;
  /** Response z0 */
  z0: string;
  /** Response z1 */
  z1: string;
}

/**
 * Complete ballot validity proof proving:
 * 1. Each ciphertext c_i in the vote vector encrypts either 0 or 1.
 * 2. The sum of all ciphertexts encrypts exactly 1 (single-choice ballot).
 */
export interface BallotValidityProof {
  /** Individual 1-of-2 proofs for each option vector slot */
  optionProofs: BinaryValidityProof[];
  /** Proof that the sum of plaintexts equals 1 */
  sumProof: {
    commitment: string;
    challenge: string;
    response: string;
  };
  /** Public key fingerprint / hash used during proof generation */
  publicKeyFingerprint: string;
}

/**
 * Proof that a decrypted tally matches the homomorphic sum of all encrypted ballots.
 */
export interface TallyDecryptionProof {
  /** Aggregated homomorphic ciphertexts per option */
  aggregatedCiphertexts: PaillierCiphertext[];
  /** Decrypted plaintext totals per option */
  tallyResults: number[];
  /** Total number of verified ballots included in tally */
  totalBallotsCounted: number;
  /** Merkle root hash of all ballots included */
  ballotsMerkleRoot: string;
  /** Zero-knowledge proof verifying correct decryption without revealing private keys */
  decryptionProof: {
    commitment: string;
    challenge: string;
    response: string;
  };
  /** Timestamp when tally was computed */
  timestamp: string;
}

/**
 * Individual share for K-of-N threshold decryption.
 */
export interface ThresholdKeyShare {
  /** Share index i (1 <= i <= N) */
  index: number;
  /** Total number of trustees (N) */
  totalShares: number;
  /** Minimum threshold needed to reconstruct / decrypt (K) */
  threshold: number;
  /** Private polynomial share as hex string */
  shareHex: string;
  /** Trustee public verification key */
  verificationKeyHex: string;
  /** Paillier public key */
  publicKey: PaillierPublicKey;
}

/**
 * Partial decryption share produced by a single trustee.
 */
export interface PartialDecryptionShare {
  /** Trustee index */
  trusteeIndex: number;
  /** Partial decryption value c_i */
  partialDecryption: string[];
  /** Proof of discrete logarithm / share correctness */
  shareProof: {
    commitment: string;
    challenge: string;
    response: string;
  };
}

/**
 * Result of combining threshold decryption shares.
 */
export interface ThresholdDecryptionResult {
  /** Final decrypted tally array */
  results: number[];
  /** Indices of trustees who participated */
  participatingTrustees: number[];
  /** Verification boolean indicating whether all shares and tally are valid */
  isValid: boolean;
}

/**
 * Merkle tree node and proof for vote inclusion.
 */
export interface MerkleProof {
  /** Leaf hash being proven */
  leaf: string;
  /** Leaf index in the tree (0-indexed) */
  index: number;
  /** Sibling hashes along the audit path */
  siblings: string[];
  /** Directions: 'left' or 'right' for each sibling */
  directions: ("left" | "right")[];
  /** Merkle root hash */
  root: string;
}

/**
 * Merkle tree vote commitment structure.
 */
export interface MerkleTreeCommitment {
  /** Merkle root hex string */
  root: string;
  /** Total leaf count */
  leafCount: number;
  /** Tree depth */
  depth: number;
  /** Timestamp of tree calculation */
  calculatedAt: string;
}

/**
 * Result of auditing and verifying a ballot's zero-knowledge proof.
 */
export interface ZKPVerificationReport {
  /** Whether the vote validity proof is cryptographically valid */
  isValid: boolean;
  /** Ballot ID */
  ballotId: string;
  /** Option count in vote vector */
  optionCount: number;
  /** Detailed error message if verification failed */
  error?: string;
  /** ISO timestamp when verification was executed */
  verifiedAt: string;
}
