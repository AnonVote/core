# Implementation Plan: npm-publish-setup

## Overview

Bring the `@anonvote/crypto` package to a publishable state and release version 0.1.0 to npm. The work covers metadata corrections, build verification, `.npmignore` creation, JSDoc completion, README updates, dry-run checks, the actual publish, and a git release tag.

## Tasks

- [x] 1. Update package.json metadata and version
  - Set `"version"` to `"0.1.0"`
  - Set `"repository"` to `{ "type": "git", "url": "https://github.com/anon/core" }`
  - Set `"keywords"` to exactly `["crypto", "voting", "anonymous", "encryption", "stellar"]`
  - Verify `"name"`, `"main"`, `"types"`, `"license"`, and `"prepublishOnly"` are already correct (leave unchanged)
  - **Requirements:** R1, R4

- [x] 2. Add .npmignore
  - Create `js/.npmignore` excluding: `tests/`, `src/`, `tsconfig.json`, `jest.config.js`, `*.js.map`, `*.d.ts.map`
  - **Requirements:** R3

- [x] 3. Add JSDoc to crypto.ts functions
  - Audit `js/src/crypto.ts` and add/complete JSDoc on all five exported functions: `hashIdentifier`, `generateToken`, `hashToken`, `encryptVote`, `decryptVote`
  - Every function needs `@param` for each parameter, `@returns`, and `@example`
  - `encryptVote` needs `@throws ValidationError`; `decryptVote` needs `@throws CryptoError`
  - **Requirements:** R5

- [x] 4. Add JSDoc to client.ts methods
  - Audit `js/src/client.ts` and add/complete JSDoc on the class block and all public methods: constructor, `createElection`, `castVote`, `verifyVote`, `serialize`, `deserialize`
  - Class block needs `@example` showing `new AnonVoteClient({...})`
  - Each public method needs `@param`, `@returns` (for non-void), and `@throws ValidationError` where the implementation throws
  - **Requirements:** R5

- [x] 5. Add JSDoc to errors.ts classes
  - Update `js/src/errors.ts` so each of `AnonVoteError`, `ValidationError`, and `CryptoError` has a JSDoc block naming the specific input condition or operation state that causes the error to be thrown
  - **Requirements:** R5

- [x] 6. Update README.md with full API reference and examples
  - Ensure README has: installation section (`npm install @anonvote/crypto`), API reference table covering every exported value and type symbol from `src/index.ts`, crypto usage snippet, AnonVoteClient usage snippet (instantiate → `createElection` → `castVote` → `verifyVote`), and `BALLOT_ENCRYPTION_KEY` docs with `openssl rand -hex 32`
  - **Requirements:** R6

- [x] 7. Build the package and verify dist output
  - Run `npm install` then `npm run build` inside `js/`
  - Confirm exit code 0 and that `dist/` contains all expected files: `index.js`, `index.js.map`, `index.d.ts`, `index.d.ts.map`, plus matching `.js` and `.d.ts` for `crypto`, `client`, `errors`, `types`
  - **Requirements:** R2

- [x] 8. Run dry-run verification
  - Run `npm publish --dry-run` from `js/`
  - Confirm output prints package name `@anonvote/crypto` and version `0.1.0`
  - Confirm `dist/index.js` and `dist/index.d.ts` appear in listed files
  - Confirm `tests/`, `src/`, `tsconfig.json`, `jest.config.js`, map files are absent from listed files
  - **Requirements:** R7

- [ ] 9. Publish to npm and create git release tag
  - Authenticate with npm (`npm login` or `NPM_TOKEN`); create `@anonvote` org if not yet done
  - Run `npm publish` from `js/`
  - Verify package is visible at `https://www.npmjs.com/package/@anonvote/crypto`
  - Create and push annotated tag: `git tag -a crypto-v0.1.0 -m "Release 0.1.0"` then `git push origin crypto-v0.1.0`
  - **Requirements:** R8, R9

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": [1, 2, 3, 4, 5, 6] },
    { "wave": 2, "tasks": [7] },
    { "wave": 3, "tasks": [8] },
    { "wave": 4, "tasks": [9] }
  ]
}
```

Tasks 1–6 are independent of each other and can be done in any order. Task 7 depends on all of 1–6. Task 8 depends on 7. Task 9 depends on 8.

## Notes

- Tasks 1–8 are fully automatable. Task 9 requires a human with npm publish credentials and is a manual step.
- The `prepublishOnly` script (`npm run build && npm test`) runs automatically during `npm publish` — no need to run build or tests separately before publishing.
- If the `@anonvote` npm organization does not exist yet, create it at https://www.npmjs.com/org/create before Task 9.
- The existing `package.json` already has the correct `name`, `main`, `types`, `license`, `exports`, and `prepublishOnly` — Task 1 is a targeted patch, not a rewrite.
