/**
 * benchmarks/homomorphic.bench.ts
 *
 * Benchmarks micro-operations of the Homomorphic and ZKP subsystem:
 * - Paillier key generation
 * - Paillier encryption
 * - Paillier homomorphic addition
 * - Paillier scalar multiplication
 * - Paillier decryption
 * - Threshold share generation & recovery
 */

import { Bench } from "tinybench";
import {
  generatePaillierKeyPair,
  encryptPaillier,
  decryptPaillier,
  addPaillier,
  multiplyPaillier,
  generateThresholdKeyShares,
  generatePartialDecryption,
  combineThresholdDecryptions,
  createHomomorphicVote,
  verifyHomomorphicVote,
} from "../src/index";

async function main() {
  const keyPair = generatePaillierKeyPair(256);
  const { ciphertext: c1, r: r1 } = encryptPaillier(1, keyPair.publicKey);
  const { ciphertext: c2 } = encryptPaillier(0, keyPair.publicKey);

  const bench = new Bench({ iterations: 200 });

  bench
    .add("encryptPaillier", () => {
      encryptPaillier(1, keyPair.publicKey);
    })
    .add("decryptPaillier", () => {
      decryptPaillier(c1, keyPair.privateKey);
    })
    .add("addPaillier (Homomorphic Sum)", () => {
      addPaillier(c1, c2, keyPair.publicKey);
    })
    .add("multiplyPaillier (Scalar Mult)", () => {
      multiplyPaillier(c1, 5n, keyPair.publicKey);
    })
    .add("createHomomorphicVote (3 options + ZKP)", () => {
      createHomomorphicVote(0, 3, "bench-vote", keyPair.publicKey);
    })
    .add("verifyHomomorphicVote (3 options ZKP)", () => {
      const vote = createHomomorphicVote(1, 3, "bench-vote", keyPair.publicKey);
      verifyHomomorphicVote(vote, keyPair.publicKey);
    });

  await bench.run();

  console.log("\n=== Homomorphic & ZKP Micro-Benchmarks ===");
  for (const task of bench.tasks) {
    const res = task.result;
    if (res) {
      console.log(
        `${task.name.padEnd(45)} | ${res.hz.toFixed(2).padStart(10)} ops/sec | mean: ${res.mean.toFixed(4).padStart(8)} ms`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
