import { performance } from "perf_hooks";
import {
  generateToken,
  hashToken,
  hashIdentifier,
  encryptVote,
  decryptVote,
  verifyVoteProof,
} from "../src/crypto";
import { KEY, SAMPLE_OPTION, sampleIdentifier } from "./setup";

interface BenchmarkResult {
  functionName: string;
  iterations: number;
  totalTimeMs: number;
  meanMs: number;
  minMs: number;
  maxMs: number;
  opsPerSec: number;
}

/**
 * Benchmark runner using Node.js native `perf_hooks` module.
 *
 * Measures execution time using `performance.mark()` and `performance.measure()`,
 * with a warmup phase to eliminate JIT compilation skew.
 *
 * @param name - Descriptive benchmark name
 * @param fn - Function under test
 * @param iterations - Number of measured iterations
 * @param warmupIterations - Number of warmup iterations
 */
function runBenchmark(
  name: string,
  fn: () => void,
  iterations: number = 1000,
  warmupIterations: number = 100,
): BenchmarkResult {
  // Warmup phase for JIT optimization
  for (let i = 0; i < warmupIterations; i++) {
    fn();
  }

  const sampleTimesMs: number[] = new Array(iterations);

  // Performance timeline markers
  performance.mark(`${name}-start`);
  const totalStart = performance.now();

  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    fn();
    const t1 = performance.now();
    sampleTimesMs[i] = t1 - t0;
  }

  const totalEnd = performance.now();
  performance.mark(`${name}-end`);
  const measure = performance.measure(name, `${name}-start`, `${name}-end`);

  const totalTimeMs = measure.duration || totalEnd - totalStart;
  const meanMs = totalTimeMs / iterations;

  let minMs = sampleTimesMs[0]!;
  let maxMs = sampleTimesMs[0]!;
  for (let i = 0; i < iterations; i++) {
    const t = sampleTimesMs[i]!;
    if (t < minMs) minMs = t;
    if (t > maxMs) maxMs = t;
  }

  const opsPerSec = (iterations / totalTimeMs) * 1000;

  return {
    functionName: name,
    iterations,
    totalTimeMs,
    meanMs,
    minMs,
    maxMs,
    opsPerSec,
  };
}

async function main() {
  console.log("=== Node.js perf_hooks Cryptographic Benchmarks ===\n");

  const results: BenchmarkResult[] = [];

  // Setup test data
  const sampleToken = generateToken();
  const sampleEncrypted = encryptVote(SAMPLE_OPTION, KEY);

  // 1. generateToken()
  results.push(
    runBenchmark(
      "generateToken()",
      () => {
        generateToken();
      },
      10000,
    ),
  );

  // 2. hashToken()
  results.push(
    runBenchmark(
      "hashToken()",
      () => {
        hashToken(sampleToken);
      },
      10000,
    ),
  );

  // 3. hashIdentifier()
  let idIndex = 0;
  results.push(
    runBenchmark(
      "hashIdentifier()",
      () => {
        hashIdentifier(sampleIdentifier(idIndex++ % 1000));
      },
      1000,
    ),
  );

  // 4. encryptVote()
  results.push(
    runBenchmark(
      "encryptVote()",
      () => {
        encryptVote(SAMPLE_OPTION, KEY);
      },
      1000,
    ),
  );

  // 5. decryptVote()
  results.push(
    runBenchmark(
      "decryptVote()",
      () => {
        decryptVote(sampleEncrypted, KEY);
      },
      1000,
    ),
  );

  // 6. verifyVoteProof()
  results.push(
    runBenchmark(
      "verifyVoteProof()",
      () => {
        verifyVoteProof(SAMPLE_OPTION, sampleEncrypted, KEY);
      },
      1000,
    ),
  );

  // Formatted output table
  const formattedResults = results.map((r) => ({
    Function: r.functionName,
    Iterations: r.iterations.toLocaleString(),
    "Ops/sec": Math.round(r.opsPerSec).toLocaleString(),
    "Mean (ms)": r.meanMs.toFixed(4),
    "Min (ms)": r.minMs.toFixed(4),
    "Max (ms)": r.maxMs.toFixed(4),
    "Total (ms)": r.totalTimeMs.toFixed(2),
  }));

  console.table(formattedResults);

  console.log("\nSummary of metrics:");
  for (const r of results) {
    console.log(
      `${r.functionName.padEnd(20)} | Ops/sec: ${Math.round(r.opsPerSec).toLocaleString().padStart(10)} | Mean: ${r.meanMs.toFixed(4)}ms | Min: ${r.minMs.toFixed(4)}ms | Max: ${r.maxMs.toFixed(4)}ms`,
    );
  }
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
