/**
 * benchmarks/zkp-tally.bench.ts
 *
 * Benchmarks vote tallying at scale: 1,000, 10,000, and 100,000 votes.
 * Compares:
 * 1. Current Approach: AES-256-GCM Sequential Decryption & Tally
 * 2. Homomorphic Approach: Paillier Modular Aggregation without Decryption
 * 3. ZKP Proof Verification: Verifying ballot validity proofs
 */

import { encryptVote, decryptVote } from "../src/crypto";
import {
  generatePaillierKeyPair,
  encryptVoteHomomorphic,
  verifyVoteZKP,
  tallyHomomorphic,
  aggregatePaillier,
} from "../src/index";
import { performance } from "perf_hooks";

const AES_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const OPTIONS = ["Option A", "Option B", "Option C"];

interface BenchmarkComparison {
  voteCount: number;
  aesTallyMs: number;
  aesThroughput: number;
  homomorphicTallyMs: number;
  homomorphicThroughput: number;
  speedupRatio: string;
}

export async function runTallyBenchmarks(): Promise<BenchmarkComparison[]> {
  console.log("=========================================================================");
  console.log(" TALLY BENCHMARK: AES-256-GCM Decryption vs Homomorphic Summation");
  console.log("=========================================================================\n");

  const paillierKeys = generatePaillierKeyPair(128); // 128-bit for fast comparative benchmarking
  const counts = [1_000, 10_000, 100_000];
  const comparisons: BenchmarkComparison[] = [];

  for (const count of counts) {
    console.log(`--- Benchmarking ${count.toLocaleString()} Votes ---`);

    // Prepare simulated AES payloads
    const aesPayloads = [];
    for (let i = 0; i < count; i++) {
      const opt = OPTIONS[i % 3];
      aesPayloads.push(encryptVote(opt, AES_KEY));
    }

    // Benchmark AES-256-GCM Decrypt & Tally
    const t0 = performance.now();
    const aesCounts: Record<string, number> = { "Option A": 0, "Option B": 0, "Option C": 0 };
    for (let i = 0; i < count; i++) {
      const decrypted = decryptVote(aesPayloads[i], AES_KEY);
      aesCounts[decrypted] = (aesCounts[decrypted] || 0) + 1;
    }
    const t1 = performance.now();
    const aesDurationMs = t1 - t0;
    const aesThroughput = (count / aesDurationMs) * 1000;

    console.log(`[AES-256-GCM Decrypt Tally]`);
    console.log(`  Duration:    ${aesDurationMs.toFixed(2)} ms`);
    console.log(`  Throughput:  ${Math.round(aesThroughput).toLocaleString()} votes/sec`);
    console.log(`  Counts:      A: ${aesCounts["Option A"]}, B: ${aesCounts["Option B"]}, C: ${aesCounts["Option C"]}`);

    // Prepare simulated Homomorphic Ciphertexts (1 vector per vote)
    // For 100k scale, pre-generate vector of sample ciphertexts to test modular aggregation
    const sampleBallots = [
      encryptVoteHomomorphic(0, 3, "b-0", paillierKeys.publicKey),
      encryptVoteHomomorphic(1, 3, "b-1", paillierKeys.publicKey),
      encryptVoteHomomorphic(2, 3, "b-2", paillierKeys.publicKey),
    ];

    const homomorphicVotes = [];
    for (let i = 0; i < count; i++) {
      homomorphicVotes.push(sampleBallots[i % 3]);
    }

    // Benchmark Homomorphic Aggregation without Decryption
    const t2 = performance.now();
    const agg0 = aggregatePaillier(homomorphicVotes.map((v) => v.encryptedVector[0]), paillierKeys.publicKey);
    const agg1 = aggregatePaillier(homomorphicVotes.map((v) => v.encryptedVector[1]), paillierKeys.publicKey);
    const agg2 = aggregatePaillier(homomorphicVotes.map((v) => v.encryptedVector[2]), paillierKeys.publicKey);
    // Single decryption of aggregate totals only
    const { decryptPaillier } = await import("../src/zkp/paillier");
    const totalA = decryptPaillier(agg0, paillierKeys.privateKey);
    const totalB = decryptPaillier(agg1, paillierKeys.privateKey);
    const totalC = decryptPaillier(agg2, paillierKeys.privateKey);
    const t3 = performance.now();

    const homomorphicDurationMs = t3 - t2;
    const homomorphicThroughput = (count / homomorphicDurationMs) * 1000;

    console.log(`[Paillier Homomorphic Aggregation (No Individual Decryption)]`);
    console.log(`  Duration:    ${homomorphicDurationMs.toFixed(2)} ms`);
    console.log(`  Throughput:  ${Math.round(homomorphicThroughput).toLocaleString()} votes/sec`);
    console.log(`  Totals:      A: ${totalA}, B: ${totalB}, C: ${totalC}`);

    const ratio = (aesDurationMs / homomorphicDurationMs).toFixed(2);
    console.log(`  Comparison:  Homomorphic aggregation is ${ratio}x relative to AES full decrypt\n`);

    comparisons.push({
      voteCount: count,
      aesTallyMs: aesDurationMs,
      aesThroughput,
      homomorphicTallyMs: homomorphicDurationMs,
      homomorphicThroughput,
      speedupRatio: `${ratio}x`,
    });
  }

  // Benchmark ZKP Single Vote Proof Verification
  console.log("--- ZKP Proof Verification Benchmark (Single Ballot) ---");
  const testBallot = encryptVoteHomomorphic(0, 3, "test", paillierKeys.publicKey);
  const zkp0 = performance.now();
  const iterations = 50;
  for (let i = 0; i < iterations; i++) {
    verifyVoteZKP(testBallot, paillierKeys.publicKey);
  }
  const zkp1 = performance.now();
  const avgZkpMs = (zkp1 - zkp0) / iterations;
  console.log(`  Avg Proof Verification Time: ${avgZkpMs.toFixed(2)} ms / ballot`);
  console.log(`  Verification Throughput:      ${Math.round(1000 / avgZkpMs)} ballots/sec / core\n`);

  console.log("=========================================================================");
  console.log(" Summary Table");
  console.log("=========================================================================");
  console.table(comparisons);

  return comparisons;
}

if (require.main === module) {
  runTallyBenchmarks().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
