import { Bench } from "tinybench";
import { encryptVote, decryptVote } from "../src/crypto";
import { KEY, SAMPLE_OPTION } from "./setup";

const VOTE_COUNT = 1000;

async function main() {
  // Pre-encrypt so decrypt.bench.ts measures decryption only.
  const encrypted = encryptVote(SAMPLE_OPTION, KEY);

  const bench = new Bench({ iterations: VOTE_COUNT });

  bench.add("decryptVote (1 vote)", () => {
    decryptVote(encrypted, KEY);
  });

  await bench.run();

  const task = bench.tasks[0];
  const result = task?.result;
  if (!result) throw new Error("benchmark produced no result");

  console.log(`\n=== decrypt.bench.ts (${VOTE_COUNT} votes) ===`);
  console.log(`ops/sec:        ${result.hz.toFixed(2)}`);
  console.log(`avg time/vote:  ${result.mean.toFixed(4)} ms`);
  console.log(`min / max:      ${result.min.toFixed(4)} ms / ${result.max.toFixed(4)} ms`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
