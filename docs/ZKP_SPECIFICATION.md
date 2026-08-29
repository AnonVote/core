# Zero-Knowledge Proof (ZKP) & Homomorphic Encryption Specification

This document defines the mathematical models, cryptographic protocols, data formats, and on-chain storage feasibility for AnonVote's zero-knowledge vote validation and homomorphic tallying infrastructure.

---

## 1. Mathematical Foundations

### 1.1 Paillier Additive Homomorphic Scheme

Let $p, q$ be large prime numbers of equal bit length.
1. **Modulus:** $n = p \cdot q$, $n^2 = n \cdot n$.
2. **Generator:** $g = n + 1 \in \mathbb{Z}_{n^2}^*$.
3. **Decryption Keys:** $\lambda = \text{lcm}(p-1, q-1)$, $\mu = (L(g^\lambda \bmod n^2))^{-1} \bmod n$, where $L(u) = \frac{u - 1}{n}$.

#### Encryption
For a plaintext message $m \in \mathbb{Z}_n$ and random $r \in \mathbb{Z}_n^*$:
$$c = g^m \cdot r^n \bmod n^2$$

#### Homomorphic Addition (Aggregation)
Given $M$ ciphertexts $c_1, c_2, \dots, c_M$:
$$C_{\text{agg}} = \prod_{i=1}^M c_i \bmod n^2$$
$$D(C_{\text{agg}}) = \left(\sum_{i=1}^M m_i\right) \bmod n$$

---

## 2. Zero-Knowledge Ballot Validity Proofs

To prevent voters from submitting malicious encodings (e.g. encrypting a negative number or casting multiple votes), each ballot includes a Non-Interactive Zero-Knowledge Proof (NIZK).

### 2.1 1-of-2 Disjunctive Proof (CDS94 / Chaum-Pedersen)
For each option indicator $b \in \{0, 1\}$ encrypted as $c = g^b \cdot r^n \bmod n^2$:
- **Branch 0 ($b = 0$):** $c = r^n \bmod n^2$.
- **Branch 1 ($b = 1$):** $c \cdot g^{-1} = r^n \bmod n^2$.

Using the Fiat-Shamir transformation over SHA-256:
- The prover creates commitments $(a_0, a_1)$, simulates the false branch with random $(e_{\text{fake}}, z_{\text{fake}})$, and solves the challenge $e = H(pk, c, a_0, a_1)$ such that:
$$e_0 + e_1 \equiv e \pmod n$$
$$z_0^n \equiv a_0 \cdot c^{e_0} \pmod{n^2}$$
$$z_1^n \equiv a_1 \cdot (c \cdot g^{-1})^{e_1} \pmod{n^2}$$

### 2.2 Sum-to-1 Single Choice Proof
For a ballot with $k$ options, the aggregated ballot ciphertext $C_{\text{sum}} = \prod_{j=0}^{k-1} c_j \bmod n^2$ encrypts $\sum_{j=0}^{k-1} b_j$.
The prover proves that $C_{\text{sum}} \cdot g^{-1} = R^n \bmod n^2$ where $R = \prod r_j \bmod n$:
- Commitment $a = w^n \bmod n^2$ for random $w \in \mathbb{Z}_n^*$.
- Challenge $e = H(pk, C_{\text{sum}} \cdot g^{-1}, a) \bmod n$.
- Response $z = w \cdot R^e \bmod n$.
- Verifier checks $z^n \equiv a \cdot (C_{\text{sum}} \cdot g^{-1})^e \pmod{n^2}$.

---

## 3. Threshold Decryption ($K$-of-$N$)

To eliminate trust in any central server:
1. The secret $\lambda$ is divided into $N$ polynomial shares $f(i)$ with threshold $K$:
   $$f(x) = \lambda + a_1 x + \dots + a_{K-1} x^{K-1} \pmod n$$
2. Each trustee $i$ computes a partial decryption on the aggregate option ciphertext $C_j$:
   $$C_{j, i} = C_j^{2 \cdot f(i)} \bmod n^2$$
3. Any $K$ trustees combine their shares using Lagrange coefficients $\ell_i(0)$:
   $$C_{\text{combined}} = \prod_{i \in S} C_{j, i}^{\ell_i(0)} \bmod n^2 = C_j^{2 \cdot \lambda} \bmod n^2$$
   $$m_j = L(C_{\text{combined}}) \cdot \mu \cdot 2^{-1} \bmod n$$

---

## 4. Stellar On-Chain Feasibility & Proof Size Analysis

### 4.1 Proof Size Breakdown (per Ballot with 3 Options)

| Component | 512-bit Modulus (Bytes) | 2048-bit Modulus (Bytes) |
|---|---|---|
| Encrypted Vector ($3 \times c$) | $3 \times 128 = 384$ B | $3 \times 512 = 1,536$ B |
| Sum Ciphertext | 128 B | 512 B |
| 1-of-2 Proofs ($3 \times (a_0, a_1, e_0, e_1, z_0, z_1)$) | ~1,152 B | ~4,608 B |
| Sum-to-1 Proof ($a, e, z$) | ~256 B | ~1,024 B |
| **Total Ballot Proof Size** | **~1.9 KB** | **~7.6 KB** |

### 4.2 On-Chain Storage Options on Stellar

Stellar transactions have payload constraints:
1. **Transaction Memo (Text / Hash):** 28–32 bytes.
2. **`ManageData` Operation:** 64-byte key + 64-byte value per entry.
3. **Soroban Smart Contracts:** Supports kilobyte-scale contract data and off-chain calldata verification.

#### Recommended Stellar Anchor Architecture:
- **Off-Chain / IPFS Storage:** Full encrypted ballots and NIZK proofs are stored in decentralized IPFS or AnonVote distributed nodes.
- **On-Chain Stellar Commitment:**
  - The ballot tally engine computes the **Merkle Root** (32 bytes / 64 hex chars) of all verified ballot receipt hashes.
  - The Merkle root is posted in a Stellar transaction `ManageData` or Soroban contract state under key `VOTE_MERKLE_ROOT_<ballotId>`.
  - The final tally results and `TallyDecryptionProof` hash are recorded in the transaction memo.

---

## 5. Third-Party Verification Algorithm

Any third-party auditor or voter can verify the election outcome with three checks:
1. **Ballot Validity:** Run `verifyVoteZKP(ballot, publicKey)` on each submitted ballot $\rightarrow$ returns `true`.
2. **Inclusion Audit:** Run `verifyMerkleProof(proof)` confirming voter's receipt hash is in the on-chain Merkle root $\rightarrow$ returns `true`.
3. **Tally Correctness:** Run `verifyHomomorphicTallyProof(tallyProof, publicKey)` verifying $C_j = \prod c_{i, j}$ and that decrypted totals match $\rightarrow$ returns `true`.
