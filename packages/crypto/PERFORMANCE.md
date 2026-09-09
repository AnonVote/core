# Performance Baseline — Crypto Functions

This document records baseline performance for the crypto functions in
`src/crypto.ts`: `encryptVote`, `decryptVote`, `hashIdentifier`, and
`generateToken`. Purpose: establish a measurable baseline now so future
changes can be checked against it (`npm run bench`).

This is a **profiling baseline, not an optimization report**. No algorithm
or library changes were made as part of this work.

## ⚠️ Numbers below need to be replaced

The figures in this section come from a hand-rolled verification harness
(plain `performance.now()` timing, no `tinybench`), run in a sandbox without
network access to actually install `tinybench`. They confirm the benchmark
*logic* calls the real functions correctly and produces sane relative
numbers — they are **not** the output of `npm run bench` and should not be
treated as the final baseline.

**Before merging:** run `npm install && npm run bench && npm run bench:memory`
locally and replace this whole section with that real output.

## Target hardware / environment

| | |
|---|---|
| Node.js version | _fill in `node -v`_ |
| CPU | _fill in_ |
| RAM | _fill in_ |
| OS | _fill in_ |

## Benchmark results (verification harness — replace with `npm run bench` output)

| Function | Iterations | Avg time/op | ops/sec |
|---|---|---|---|
| `encryptVote` | 1,000 | 0.0234 ms | ~42,700 |
| `decryptVote` | 1,000 | 0.0155 ms | ~64,700 |
| `hashIdentifier` | 1,000 | 0.0046 ms | ~217,500 |
| `generateToken` | 10,000 | 0.0040 ms | ~248,200 |

Observations (likely to hold in the real run too, but confirm):
- `hashIdentifier` and `generateToken` are both markedly faster than
  `encryptVote`/`decryptVote` — expected, since a single SHA-256 digest or
  `randomBytes` call does less work than AES-256-GCM cipher setup plus
  encode/decode.
- `decryptVote` came out faster than `encryptVote` in this run, which is a
  bit counterintuitive for GCM (encrypt/decrypt do comparable crypto work).
  Most likely explanation is JIT/V8 warm-up ordering, since `encryptVote`
  ran first in the process. Worth checking whether the real `tinybench` run
  (which does its own warm-up per task) shows the same asymmetry or not.

## Memory profile: encrypting 10,000 votes

_Not yet run against the real package — run `npm run bench:memory` and
paste results here._

## How to reproduce

```bash
npm install
npm run typecheck:bench   # optional but recommended — catches API mismatches early
npm run bench              # runs all four .bench.ts files via tinybench
npm run bench:memory       # memory profile for 10,000-vote encryption
```

## Backlog / follow-up

To be filled in after real numbers are captured — if any function is
surprisingly slow or memory grows faster than the vote count, note it here
and file a separate issue rather than optimizing inline (out of scope for
this baseline).
