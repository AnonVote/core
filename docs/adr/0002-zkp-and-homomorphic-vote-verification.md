# ADR-002: Zero-Knowledge Proof (ZKP) and Additive Homomorphic Infrastructure for Verifiable Vote Tallying Without Decryption

**Date:** 2026-08-23  
**Status:** Accepted  
**Deciders:** AnonVote Cryptography and Architecture Team  

---

## 1. Context and Problem Statement

AnonVote's original voting architecture relied on **symmetric authenticated encryption (AES-256-GCM)**. While AES-256-GCM is semantically secure (IND-CPA/IND-CCA2) and highly performant for confidentiality in transit, it lacks algebraic homomorphic properties.

This resulted in three critical verifiability risks:
1. **Tally Manipulation Risk:** The backend tally engine was required to decrypt every individual vote using the server-side ballot key before summing counts. A compromised or dishonest backend could forge election totals without voters or auditors being able to detect the fraud.
2. **Selective Decryption & Exclusion:** The backend could selectively decrypt only certain votes or exclude dissenting ballots.
3. **No Mathematical Proof of Correctness on Public Ledgers:** Stellar blockchain transactions stored encrypted vote payloads, but could not cryptographically prove on-chain that the published tally equaled the sum of the recorded votes without revealing voter secret choices.

To achieve **Milestone 3 / Ecosystem-level universal verifiability**, AnonVote requires a cryptographic infrastructure allowing:
- Voters to prove their ballots are well-formed (valid 1-of-$k$ choice) without revealing their vote.
- The tally engine to compute election results homomorphically without decrypting individual ballots.
- Third parties to independently verify tally correctness and on-chain vote inclusion via Merkle commitments.

---

## 2. Evaluation of Approaches & Tradeoffs

Four candidate cryptographic architectures were evaluated:

| Approach | Description | Pros | Cons |
|---|---|---|---|
| **A. Additive Homomorphic Encryption (Paillier)** | Public-key cryptosystem where $D(\prod c_i) = \sum m_i$. | Eliminates individual vote decryption; algebraic tallying; compact aggregation. | Slower than AES-256-GCM; key size larger (2048-bit modulus). |
| **B. General zk-SNARKs (Groth16 / Plonk)** | Succinct zero-knowledge proofs over arithmetic circuits. | Extremely small proof size (~128-256 bytes); constant verification time. | Requires complex trusted setup or heavy client-side proving keys; high WASM bundle overhead. |
| **C. Threshold Decryption ($K$-of-$N$ Shamir/Paillier)** | Split decryption key among $N$ independent election trustees. | Prevents single-party decryption; guarantees fault tolerance. | Requires coordination among $K$ trustees during tally closing. |
| **D. Merkle Tree Commitments** | Hash tree committing to all cast ballots and vote receipts. | Instant inclusion proof ($O(\log N)$); minimal proof size (~1 KB); fits on Stellar ledger memo/data. | Does not compute tallies by itself; provides membership/auditability. |

---

## 3. Decision: The Hybrid Cryptographic Architecture

AnonVote adopts a **layered Hybrid Architecture** combining:
1. **Paillier Additive Homomorphic Encryption** for ballot encryption and serverless tally aggregation.
2. **Non-Interactive Zero-Knowledge Proofs (NIZK)** using the CDS94 / Chaum-Pedersen disjunctive proof technique via Fiat-Shamir transformation for ballot validity (1-of-$k$ binary proof + Sum-to-1 proof).
3. **$K$-of-$N$ Threshold Decryption** across distributed election trustees to ensure no single entity can decrypt the aggregate tally without quorum.
4. **Cryptographic Merkle Commitments** anchored to the Stellar blockchain for voter inclusion verification.

---

## 4. Architectural Design & API Surface

### 4.1 Voter Workflow
1. Voter selects Option $i \in \{0, \dots, k-1\}$.
2. Voter client encrypts a 1-hot vector $[0, \dots, 1, \dots, 0]$ with Paillier public key $pk$:
   $$c_j = g^{v_j} \cdot r_j^n \bmod n^2$$
3. Client generates a 1-of-2 NIZK proof for each option $c_j \in \{0, 1\}$ and a Schnorr-like equality proof for $\sum v_j = 1$.
4. Voter submits `HomomorphicEncryptedVote` to the backend and retains the `receiptHash`.

### 4.2 Tally Engine Workflow (Without Decryption)
1. Tally engine verifies the NIZK proof for each submitted ballot (invalid ballots rejected immediately).
2. Tally engine computes the aggregated ciphertexts per option homomorphically:
   $$C_j = \prod_{i=1}^M c_{i, j} \bmod n^2 = \text{Enc}\left(\sum_{i=1}^M v_{i, j}\right)$$
3. The $K$-of-$N$ trustees provide partial decryption shares on the aggregate ciphertexts $C_j$ only. Individual votes are never decrypted.
4. Tally engine publishes the `TallyDecryptionProof` along with the Merkle root of all counted ballots.

### 4.3 Third-Party & Voter Verification
- **Voter Verification:** Uses `generateMerkleProof` and `verifyMerkleProof` to confirm their `receiptHash` is contained in the Merkle root posted on Stellar.
- **Universal Auditor:** Uses `verifyHomomorphicTallyProof` to mathematically verify that the final results equal the homomorphic summation of all verified ballots without needing access to any private keys.

---

## 5. Consequences and Impact

- **Security Guarantees:** Universal Verifiability, Individual Verifiability, Ballot Secrecy under Decisional Composite Residuosity Assumption (DCRA), and Collusion Resistance up to $K-1$ trustees.
- **Backward Compatibility:** Existing AES-256-GCM methods (`encryptVote`, `decryptVote`) remain fully functional for lightweight deployments.
- **Stellar Ledger Feasibility:** Merkle roots (32 bytes) and tally proofs fit within standard Stellar transaction memo and manage data entries.
