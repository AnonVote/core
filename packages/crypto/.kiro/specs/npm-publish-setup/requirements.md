# Requirements Document

## Introduction

This feature covers the initial public release of the `@anonvote/crypto` package to npm as version 0.1.0 — Milestone 3 of the AnonVote project. The package already exists locally in the `js/` folder with fully functional cryptographic primitives, a client SDK, shared TypeScript types, and error classes. The goal is to bring the package to a publishable state: set the correct version, produce a clean `dist/` output, exclude development artifacts from the published payload, add an `.npmignore`, complete JSDoc coverage on all exported members, update the README, perform a dry-run verification, publish, and confirm third-party installability and TypeScript type availability.

---

## Glossary

- **Package**: The `@anonvote/crypto` npm package located in `js/`.
- **Publisher**: The developer who executes `npm publish` against an authenticated npm account.
- **Build_Tool**: The `tsc` TypeScript compiler invoked via `npm run build`.
- **Dist**: The compiled output directory `js/dist/`, containing `.js`, `.d.ts`, `.d.ts.map`, and `.js.map` files produced by the Build_Tool.
- **npmignore**: The file `js/.npmignore` that controls which files are excluded from the published tarball.
- **JSDoc**: Inline documentation comments (`/** … */`) attached to every exported function, class, method, and type alias.
- **Dry_Run**: Execution of `npm publish --dry-run`, which simulates publishing and lists the files that would be included without uploading anything.
- **Registry**: The public npm registry at `https://registry.npmjs.org`.
- **Consumer**: Any external developer who installs `@anonvote/crypto` from the Registry into their own project.
- **Clean_Environment**: A new directory with no prior `node_modules`, no lock file, and running Node.js ≥ 18, which has no prior installation of `@anonvote/crypto`.
- **Type_Check**: TypeScript compilation of Consumer code that imports from `@anonvote/crypto`, which succeeds only when `.d.ts` declaration files are present and correct.
- **Git_Tag**: An annotated git tag of the form `crypto-v0.1.0` placed on the commit that represents the published release.

---

## Requirements

### Requirement 1: Package Metadata

**User Story:** As a Publisher, I want `package.json` to reflect the correct version and metadata for the initial release, so that npm and consumers can identify the package accurately.

#### Acceptance Criteria

1. THE Package SHALL have `"version": "0.1.0"` in `package.json`.
2. THE Package SHALL have `"name": "@anonvote/crypto"` in `package.json`.
3. THE Package SHALL have `"main": "dist/index.js"` in `package.json`.
4. THE Package SHALL have `"types": "dist/index.d.ts"` in `package.json`.
5. THE Package SHALL have `"license": "MIT"` in `package.json`.
6. THE Package SHALL have a `"repository"` field in `package.json` with `"type": "git"` and `"url": "https://github.com/anon/core"`.
7. THE Package SHALL include exactly the keywords `["crypto", "voting", "anonymous", "encryption", "stellar"]` in `package.json`, with no additions or omissions.

---

### Requirement 2: Build Output

**User Story:** As a Publisher, I want `npm run build` to compile TypeScript sources to `dist/` and emit declaration files, so that the published package contains JavaScript and types for consumers.

#### Acceptance Criteria

1. WHEN `npm run build` is executed, THE Build_Tool SHALL compile all files under `src/` to `dist/` and exit with code 0.
2. WHEN `npm run build` completes with exit code 0, THE Dist SHALL contain `index.js`, `index.js.map`, `index.d.ts`, and `index.d.ts.map`; IF any of these files are absent, THEN THE build SHALL be considered incomplete.
3. WHEN `npm run build` encounters TypeScript compilation errors, THE Build_Tool SHALL NOT emit any output files and SHALL exit with a non-zero exit code.
4. WHEN `npm run build` completes with exit code 0, THE Dist SHALL contain a compiled `.js` file and a corresponding `.d.ts` file for each source file in `src/` (`crypto.ts`, `client.ts`, `errors.ts`, `types.ts`, `index.ts`).
5. IF `npm run build` encounters TypeScript compilation errors, THEN THE Build_Tool SHALL print all diagnostics to stderr and exit with a non-zero exit code.

---

### Requirement 3: Publish Exclusions

**User Story:** As a Publisher, I want an `.npmignore` file to exclude tests, source maps, and internal development files from the published tarball, so that consumers receive only the necessary runtime and type files.

#### Acceptance Criteria

1. THE npmignore SHALL exclude the `tests/` directory from the published tarball.
2. THE npmignore SHALL exclude `*.js.map` source map files from the published tarball.
3. THE npmignore SHALL exclude `tsconfig.json` from the published tarball.
4. THE npmignore SHALL exclude `jest.config.js` from the published tarball.
5. THE npmignore SHALL exclude `src/` from the published tarball.
6. THE npmignore SHALL exclude `*.d.ts.map` declaration map files from the published tarball.

---

### Requirement 4: Pre-Publish Validation

**User Story:** As a Publisher, I want the `prepublishOnly` script to run the build and all tests before publishing, so that broken builds or failing tests cannot be accidentally released.

#### Acceptance Criteria

1. THE Package SHALL have a `"prepublishOnly"` script in `package.json` that runs `npm run build && npm test`.
2. WHEN `npm publish` is invoked, THE Package SHALL execute the `prepublishOnly` script before uploading to the Registry.
3. IF any step of the `prepublishOnly` script fails, THEN THE Package SHALL abort publishing, skip all remaining steps, and exit with the non-zero exit code of the failing step.

---

### Requirement 5: JSDoc Documentation

**User Story:** As a Consumer, I want every exported function, class, method, and type to have JSDoc comments, so that IDE tooling can surface inline documentation and API reference can be generated automatically.

#### Acceptance Criteria

1. THE Package SHALL include a `@param` tag for every parameter of every exported function and public method.
2. THE Package SHALL include a `@returns` tag for every exported function and public method that returns a non-void value.
3. THE Package SHALL include a `@throws` tag on every exported function or method that throws `AnonVoteError`, `ValidationError`, or `CryptoError`, naming the specific class thrown.
4. THE Package SHALL include a `@example` tag on `hashIdentifier`, `generateToken`, `hashToken`, `encryptVote`, and `decryptVote`.
5. THE Package SHALL include a class-level JSDoc block on `AnonVoteClient` that describes the client's purpose and includes at least one `@example` showing instantiation of `AnonVoteClient`.
6. THE Package SHALL include JSDoc on `AnonVoteError`, `ValidationError`, and `CryptoError`, where each comment references the specific input condition or operation state that causes that error to be thrown.

---

### Requirement 6: README Documentation

**User Story:** As a Consumer, I want the `README.md` to contain installation instructions, an API reference, and usage examples, so that I can integrate the package without reading the source code.

#### Acceptance Criteria

1. THE Package SHALL include an installation section in `README.md` showing `npm install @anonvote/crypto`.
2. THE Package SHALL include an API reference section in `README.md` listing every exported value symbol (functions, classes, error classes) and every exported type symbol from `src/index.ts`, each with a one-line description.
3. THE Package SHALL include a usage example section in `README.md` containing a TypeScript snippet that begins with an `import` statement from `@anonvote/crypto` and demonstrates `hashIdentifier`, `generateToken`, `hashToken`, `encryptVote`, and `decryptVote`.
4. THE Package SHALL include a usage example in `README.md` containing a TypeScript snippet that begins with an `import` statement from `@anonvote/crypto` and sequentially demonstrates: instantiating `AnonVoteClient`, calling `createElection`, calling `castVote` using the election returned by `createElection`, and calling `verifyVote` using the receipt returned by `castVote`.
5. THE Package SHALL document the `BALLOT_ENCRYPTION_KEY` environment variable requirement in `README.md`, specifying the required format (64-character hex string) and including the generation command `openssl rand -hex 32`.

---

### Requirement 7: Dry-Run Verification

**User Story:** As a Publisher, I want to run `npm publish --dry-run` and inspect the output before publishing, so that I can confirm the tarball contents are correct without uploading anything.

#### Acceptance Criteria

1. IF any of `dist/index.js`, `dist/index.d.ts`, `README.md`, or `package.json` do not exist, THEN THE Build_Tool SHALL exit with a non-zero code and emit an error message before the Dry_Run is executed.
2. WHEN `npm publish --dry-run` is executed and all required files are present, THE Package SHALL exit with code 0.
3. WHEN `npm publish --dry-run` is executed, THE output SHALL include a file list that contains `dist/index.js` and `dist/index.d.ts` among the listed files.
4. WHEN `npm publish --dry-run` is executed, THE output SHALL print the version as `0.1.0`.
5. WHEN `npm publish --dry-run` is executed, THE output SHALL print the package name as `@anonvote/crypto`.
6. WHEN `npm publish --dry-run` is executed and the `prepublishOnly` script (build + test) fails, THEN THE Dry_Run SHALL exit with a non-zero code without simulating the publish step.

---

### Requirement 8: Publishing

**User Story:** As a Publisher, I want to publish version 0.1.0 to npm so that the package is publicly available on the Registry.

#### Acceptance Criteria

1. WHEN `npm publish` is executed with an npm token that has publish rights on the `@anonvote` scope and the `prepublishOnly` script (build + tests) passes, THE Publisher SHALL successfully upload version `0.1.0` of `@anonvote/crypto` to the Registry.
2. WHEN the publish completes, THE Registry SHALL make the package visible at `https://www.npmjs.com/package/@anonvote/crypto` within 60 seconds.
3. WHEN the publish completes, THE Registry SHALL list version `0.1.0` as the `latest` tag.
4. IF `npm publish` is executed without an authenticated npm session, THEN THE Registry SHALL reject the request with an authentication error message and SHALL NOT upload any files.
5. IF `npm publish` is executed for a version that already exists on the Registry, THEN THE Registry SHALL reject the request with a version-conflict error and SHALL NOT overwrite the existing published version.

---

### Requirement 9: Git Release Tag

**User Story:** As a Publisher, I want a git tag `crypto-v0.1.0` placed on the release commit so that the exact source state of this release is permanently identifiable in the repository.

#### Acceptance Criteria

1. WHEN publishing is complete, THE Publisher SHALL create an annotated git tag named `crypto-v0.1.0` on the commit containing the updated `package.json`, `README.md`, and any changelog files, with a tag message that includes the version string `0.1.0`.
2. WHEN the git tag is created, THE Publisher SHALL push the tag to the `origin` remote repository.
3. IF a local or remote tag named `crypto-v0.1.0` already exists, THEN THE Publisher SHALL abort tag creation, report a conflict error, and SHALL NOT overwrite the existing tag.
4. IF pushing the tag to `origin` fails, THEN THE Publisher SHALL report the push error and SHALL preserve the local tag without deleting it.

---

### Requirement 10: Consumer Installability

**User Story:** As a Consumer, I want `npm install @anonvote/crypto` to work in a clean environment, so that I can use the package in my own project without any manual setup.

#### Acceptance Criteria

1. WHEN `npm install @anonvote/crypto` is executed in a Clean_Environment, THE Registry SHALL resolve and download version `0.1.0` without errors.
2. IF `npm install @anonvote/crypto` fails in a Clean_Environment, THEN THE installer SHALL exit with a non-zero code and print a descriptive error message.
3. WHEN the installation completes, THE Consumer SHALL be able to `import { hashIdentifier, generateToken, hashToken, encryptVote, decryptVote } from "@anonvote/crypto"` in a Node.js script without a runtime error.
4. WHEN the installation completes, THE Consumer SHALL be able to `import { AnonVoteClient } from "@anonvote/crypto"` and instantiate `AnonVoteClient` without a runtime error.
5. WHEN the installation completes, THE Consumer SHALL be able to `import { AnonVoteError, ValidationError, CryptoError } from "@anonvote/crypto"` and use them as error classes without a runtime error.
6. WHEN the installation completes, THE Consumer SHALL be able to import all type exports listed in `dist/index.d.ts` without a TypeScript compilation error (Type_Check passes).

---

### Requirement 11: TypeScript Type Availability

**User Story:** As a Consumer using TypeScript, I want declaration files to be included in the installed package, so that my IDE provides type checking and autocompletion without any additional type packages.

#### Acceptance Criteria

1. WHEN the installation completes, THE Consumer SHALL find `node_modules/@anonvote/crypto/dist/index.d.ts` present on disk.
2. WHEN the Type_Check is executed on Consumer code that imports any exported type from `@anonvote/crypto` (including `EncryptedPayload`, `Election`, `VoteReceipt`, `ClientConfig`, `CreateElectionParams`, and all other type exports), THE Type_Check SHALL complete without type errors under both `moduleResolution: node16` and `moduleResolution: bundler` settings.
3. THE Package SHALL NOT require `@types/anonvote__crypto` or any supplementary type package for Type_Check to pass.
4. WHEN the installation completes, THE Consumer SHALL find the `"types"` field in `node_modules/@anonvote/crypto/package.json` pointing to `dist/index.d.ts`.
