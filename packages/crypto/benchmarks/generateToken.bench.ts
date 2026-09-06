import { Bench } from "tinybench";
import { generateToken } from "../src/crypto";

const TOKEN_COUNT = 10000;

async function main() {
  const bench = new Bench({ iterations: TOKEN_COUNT });

  bench.add("generateToken (1 token)", () => {
    generateToken();
  });

  await bench.run();

  const task = bench.tasks[0];
  const result = task?.result;
  if (!result) throw new Error("benchmark produced no result");

  console.log(`\n=== generateToken.bench.ts (${TOKEN_COUNT} tokens) ===`);
  console.log(`ops/sec:        ${result.hz.toFixed(2)}`);
  console.log(`avg time/token: ${result.mean.toFixed(4)} ms`);
  console.log(`min / max:      ${result.min.toFixed(4)} ms / ${result.max.toFixed(4)} ms`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
