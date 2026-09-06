# AnonVote Protocol

**Specification documents, whitepaper, and protocol design for the AnonVote ecosystem.**

This repo is the canonical source of truth for how AnonVote works — the cryptographic model, privacy guarantees, data flows, smart contract specs, and integration guides. It is written for developers, auditors, and anyone evaluating the system's security properties.

[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## Role in the ecosystem

| Repo                                                        | Relationship                                       |
| ----------------------------------------------------------- | -------------------------------------------------- |
| [AnonVote/core](https://github.com/AnonVote/core)           | Implements this specification                      |
| [AnonVote/js](https://github.com/AnonVote/js)               | Implements the crypto primitives specified here    |
| [AnonVote/contracts](https://github.com/AnonVote/contracts) | Implements the on-chain audit model specified here |

---

## Contents

| Document                                                                 | Description                                                                  |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| [`whitepaper/whitepaper.md`](whitepaper/whitepaper.md)                   | Full protocol whitepaper — privacy model, cryptographic design, threat model |
| [`specs/crypto.md`](specs/crypto.md)                                     | Cryptographic primitive specifications                                       |
| [`specs/crypto-integration-guide.md`](specs/crypto-integration-guide.md) | Formal integration guide for composing `@anonvote/crypto` safely             |
| [`specs/token-flow.md`](specs/token-flow.md)                             | Token issuance and vote submission flow                                      |
| [`specs/smart-contracts.md`](specs/smart-contracts.md)                   | On-chain audit contract specification                                        |
| [`specs/api.md`](specs/api.md)                                           | REST API surface specification                                               |
| [`specs/errors.md`](specs/errors.md)                                     | Language-agnostic protocol error code specification                          |

---

## Quick start for contributors

Clone and read:

```bash
git clone https://github.com/AnonVote/docs.git
cd docs
```

All documents are plain Markdown. No build step required.

---

## License

[MIT](LICENSE)
