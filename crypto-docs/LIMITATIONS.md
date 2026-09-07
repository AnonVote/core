# Limitations and Future Cryptographic Improvements

## 1. Security Assumptions & Limitations

### 1.1 Decisional Composite Residuosity Assumption (DCRA)
The additive homomorphic security of Paillier relies on the hardness of factoring composite integers $n = p \cdot q$ and the Decisional Composite Residuosity Assumption.
- **Key Length Requirements:** For production deployments, $n$ must be at least 2048 bits (recommended 3072 bits for 128-bit post-2030 security standards).
- **Quantum Resistance:** Classical Paillier and discrete logarithm proofs are vulnerable to Shor's algorithm on a sufficiently large quantum computer. For quantum resistance, future iterations will evaluate lattice-based homomorphic schemes (e.g., BGV/BFV or TFHE) and quantum-safe ZK-STARKs.

### 1.2 Fiat-Shamir Heuristic (Random Oracle Model)
The Non-Interactive Zero-Knowledge (NIZK) proofs transform interactive sigma protocols into non-interactive proofs using SHA-256 in the Random Oracle Model.
- Implementations must ensure complete domain separation to prevent cross-protocol replay attacks.
- Public keys, election IDs, and all commitments are bound into the Fiat-Shamir challenge hash.

### 1.3 Key Management & Trustee Availability
In $K$-of-$N$ threshold decryption:
- At least $K$ trustees must remain online and uncompromised during tally close to generate partial decryption shares.
- If more than $N - K$ trustees lose their keys, the aggregate tally cannot be recovered.
- Secure ceremony tools (such as verifiable distributed key generation / DKG) should be employed when setting up trustee keypairs.

---

## 2. Important Notice for Contributors & Production Audits

> [!CAUTION]
> **External Cryptographic Audit Required Before Production Use**
> The zero-knowledge proof and homomorphic primitives in this repository represent cutting-edge cryptographic engineering.
> **DO NOT deploy to high-stakes political or financial production elections without an independent third-party cryptographic security audit.**

---

## 3. Future Improvements & Roadmap

1. **Client-Side WASM / WebWorker Prover:**
   - Offload 2048-bit modular exponentiations to WebAssembly / WebWorkers in browser clients to ensure non-blocking UI rendering on low-powered mobile devices.

2. **Batched Subvector Proofs & Bulletproofs:**
   - Transition from $O(k)$ Disjunctive proofs to Bulletproofs range proofs or Groth16 / Halo2 circuits for elections with large numbers of options ($k > 20$) or ranked-choice voting.

3. **Soroban Smart Contract On-Chain Verifier:**
   - Deploy an on-chain verifier contract on Stellar / Soroban capable of verifying Merkle roots and batch aggregate tally proofs directly in smart contract state.

4. **Multi-Choice & Ranked-Choice Homomorphic Extensions:**
   - Extend the 1-of-$k$ vector proofs to support approval voting ($\sum v_i \le M$) and Borda count / Instant Runoff homomorphic matrices.
