/**
 * Memory profiling for encryptVote at scale.
 *
 * Run with: npm run bench:memory
 * (uses --expose-gc so GC impact can be measured directly; falls back
 * gracefully if that flag isn't present.)
 */
import { encryptVote } from "../src/crypto";
import { KEY, SAMPLE_OPTION } from "./setup";
import type { EncryptedPayload } from "../src/types";

const VOTE_COUNT = 10000;

function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function main() {
  const gc = (globalThis as any).gc as (() => void) | undefined;

  if (gc) gc();
  const before = process.memoryUsage();

  let peakHeapUsed = before.heapUsed;
  const results: EncryptedPayload[] = [];

  const start = performance.now();
  for (let i = 0; i < VOTE_COUNT; i++) {
    results.push(encryptVote(SAMPLE_OPTION, KEY));
    if (i % 500 === 0) {
      const current = process.memoryUsage().heapUsed;
      if (current > peakHeapUsed) peakHeapUsed = current;
    }
  }
  const end = performance.now();

  const afterGcSkipped = process.memoryUsage();
  if (afterGcSkipped.heapUsed > peakHeapUsed) {
    peakHeapUsed = afterGcSkipped.heapUsed;
  }

  console.log(`\n=== memory-profile.ts: encrypting ${VOTE_COUNT} votes ===`);
  console.log(`wall time:           ${(end - start).toFixed(2)} ms`);
  console.log(`heapUsed before:     ${formatMB(before.heapUsed)}`);
  console.log(`heapUsed after:      ${formatMB(afterGcSkipped.heapUsed)}`);
  console.log(`peak heapUsed (est): ${formatMB(peakHeapUsed)}`);
  console.log(`rss after:           ${formatMB(afterGcSkipped.rss)}`);

  if (gc) {
    gc();
    const afterGc = process.memoryUsage();
    console.log(`heapUsed after GC:   ${formatMB(afterGc.heapUsed)}`);
    console.log(
      `GC reclaimed:        ${formatMB(afterGcSkipped.heapUsed - afterGc.heapUsed)}`
    );
  } else {
    console.log(
      "GC impact:           not measured (run with --expose-gc for this figure)"
    );
  }

  if (results.length !== VOTE_COUNT) throw new Error("unexpected result count");
}

main();
