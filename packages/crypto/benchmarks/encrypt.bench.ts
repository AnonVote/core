import { Bench } from "tinybench";
import { encryptVote } from "../src/crypto";
import { KEY, SAMPLE_OPTION } from "./setup";

const VOTE_COUNT = 1000;

async function main() {
  const bench = new Bench({ iterations: VOTE_COUNT });

  bench.add("encryptVote (1 vote)", () => {
    encryptVote(SAMPLE_OPTION, KEY);
  });

  await bench.run();

  const task = bench.tasks[0];
  const result = task?.result;
  if (!result) throw new Error("benchmark produced no result");

  console.log(`\n=== encrypt.bench.ts (${VOTE_COUNT} votes) ===`);
  console.log(`ops/sec:        ${result.hz.toFixed(2)}`);
  console.log(`avg time/vote:  ${result.mean.toFixed(4)} ms`);
  console.log(`min / max:      ${result.min.toFixed(4)} ms / ${result.max.toFixed(4)} ms`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
