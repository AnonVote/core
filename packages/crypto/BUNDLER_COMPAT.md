# Bundler Compatibility

`@anonvote/crypto` is tested against the three most common JavaScript
bundlers to make sure it works correctly when a consumer bundles it
into their own application.

## Tested Bundlers

| Bundler | Version | Status | Notes |
|---|---|---|---|
| esbuild | latest | Passing | 1 warning (see below) |
| webpack | 5.x | Passing | No warnings |
| Vite (Rollup) | 5.x | Passing | Requires marking the package as external (see below) |

All three bundler tests can be run together with:

```bash
npm run test:bundlers
```

Test projects live in `tests/bundler-compat/<bundler-name>/`.

## Runtime support

Randomness is cross-runtime. `generateToken`, the client's id generation,
and every other path that needs random bytes go through
`getRandomBytes()` in `src/random.ts`, which prefers the Web Crypto API
(`globalThis.crypto.getRandomValues`) and falls back to Node's
`crypto.randomBytes` only when no global Web Crypto exists. Node's
`crypto` module is never imported at the top level — it is reached
through a `require()` inside a function body, so edge bundlers do not
pull it into the output. That means the package can be imported, and
tokens generated, on Cloudflare Workers, Vercel Edge, Deno and in
browsers.

**Still Node-only:** `encryptVote`, `decryptVote`, `hashIdentifier`,
`hashToken` and `verifyVoteHash` use Node's `createCipheriv`,
`createDecipheriv` and `createHash`. The Web Crypto equivalents
(`crypto.subtle`) are async, so moving to them would change these from
sync to async — a breaking API change, deliberately not made here. Calling
them on an edge runtime still throws; importing the package does not.

Our bundler tests target Node (`platform: "node"` / `target: "node"`).
Browser bundling remains out of scope for those tests.

## Known Issues and Workarounds

### 1. Vite / Rollup cannot statically detect named exports

`dist/index.js` (compiled by tsc) re-exports functions using
getter-based property definitions:

```js
Object.defineProperty(exports, "hashIdentifier", { get: () => crypto_1.hashIdentifier });
```

Rollup's CommonJS interop (used internally by Vite) cannot always
statically analyze this pattern to detect named exports. As a
result, `import { hashIdentifier } from "@anonvote/crypto"` can fail
to resolve when bundled with Vite/Rollup.

Workaround used in our test: mark `@anonvote/crypto` as external in
the Rollup/Vite config, so the import statement is left as-is in the
output and resolved by Node at runtime instead of being inlined by
Rollup:

```ts
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      external: ["crypto", "@anonvote/crypto"],
    },
  },
});
```

Recommendation for consumers using Vite/Rollup: add
`@anonvote/crypto` to your `rollupOptions.external` (or
`build.rollupOptions.external` in Vite) if you encounter an
"is not exported by" error.

Suggestion for maintainers: shipping a native ESM build (using plain
`export const` statements instead of TypeScript's getter-based CJS
re-exports) would remove the need for this workaround entirely for
Rollup/Vite consumers.

### 2. package.json exports field: types condition ordering

esbuild produces this warning:

```
The condition "types" here will never be used as it comes after
both "import" and "require"
```

The exports field currently lists conditions in this order:

```json
"exports": {
  ".": {
    "import": "./dist/index.js",
    "require": "./dist/index.js",
    "types": "./dist/index.d.ts"
  }
}
```

Per Node.js and TypeScript convention, "types" should be listed
first so type-aware tools resolve it correctly:

```json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js",
    "require": "./dist/index.js"
  }
}
```

This does not currently break functionality, but is recommended as a
follow-up fix.

## Configuration Recommendations for Consumers

- Node target required. Set your bundler's target/platform to Node
  (e.g. `platform: "node"` in esbuild, `target: "node"` in webpack).
  Do not attempt to bundle this package for a browser target, since
  Node's crypto module is not polyfilled.
- Vite/Rollup users: add `@anonvote/crypto` to external in your
  Rollup options (see above).
- esbuild/webpack users: no special configuration is required beyond
  setting the Node target.
