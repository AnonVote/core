import { Bench } from "tinybench";
import { hashIdentifier } from "../src/crypto";
import { sampleIdentifier } from "./setup";

const IDENTIFIER_COUNT = 1000;

async function main() {
  let i = 0;
  const bench = new Bench({ iterations: IDENTIFIER_COUNT });

  bench.add("hashIdentifier (1 identifier)", () => {
    hashIdentifier(sampleIdentifier(i++ % IDENTIFIER_COUNT));
  });

  await bench.run();

  const task = bench.tasks[0];
  const result = task?.result;
  if (!result) throw new Error("benchmark produced no result");

  console.log(`\n=== hash.bench.ts (${IDENTIFIER_COUNT} identifiers) ===`);
  console.log(`ops/sec:        ${result.hz.toFixed(2)}`);
  console.log(`avg time/hash:  ${result.mean.toFixed(4)} ms`);
  console.log(`min / max:      ${result.min.toFixed(4)} ms / ${result.max.toFixed(4)} ms`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
