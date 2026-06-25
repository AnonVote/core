<div align="center">

<h1>AnonVote</h1>

<p><strong>Private decision infrastructure for organizations on Stellar.</strong></p>

<p>
  Run secure, anonymous votes where participation is confidential,<br>
  results are verifiable, and records are tamper-proof on the blockchain.
</p>

<p>
  <a href="https://github.com/Just-Bamford/AnonVote/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" />
  </a>
  <a href="https://nodejs.org">
    <img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen" alt="Node.js ≥ 20" />
  </a>
  <a href="https://stellar.org">
    <img src="https://img.shields.io/badge/blockchain-Stellar-6f42c1" alt="Stellar" />
  </a>
  <img src="https://img.shields.io/badge/tests-28%20passing-success" alt="28 Tests Passing" />
  <img src="https://img.shields.io/badge/WCAG-accessible-orange" alt="WCAG Accessible" />
</p>

<br/>

</div>

---

## Overview

AnonVote solves a fundamental problem with digital voting: most tools expose voter identity, store results on a server only you control, and provide no independent way to verify outcomes.

AnonVote is different. Identity is cryptographically separated from the ballot at every layer. Every vote is anchored to the Stellar blockchain, so results can be verified by anyone — without trusting AnonVote's servers.

| Property             | How it's enforced                                                             |
| -------------------- | ----------------------------------------------------------------------------- |
| One person, one vote | Cryptographic token system, not policy                                        |
| Voter anonymity      | Structural unlinkability — no database join between identity and token tables |
| Result integrity     | AES-256-GCM encrypted votes anchored to Stellar                               |
| Auditability         | Public Stellar transaction links; anyone can verify                           |

---

## Table of Contents

- [Features](#features)
- [Who It's For](#who-its-for)
- [How It Works](#how-it-works)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [Privacy Design](#privacy-design)
- [Stellar Integration](#stellar-integration)
- [Running Tests](#running-tests)
- [Roadmap](#roadmap)
- [License](#license)

---

## Features

- **Anonymous token issuance** — voters receive a one-time 32-byte CSPRNG token; no identity is stored alongside it
- **Encrypted vote submission** — vote payloads are AES-256-GCM encrypted; tallying decrypts only the option selection
- **Blockchain audit trail** — every vote and audit event is written to Stellar as a `manageData` operation
- **Public verification** — anyone can confirm results independently via Stellar transaction IDs
- **Weighted & delegated voting** — flexible vote-weight configuration and delegation support
- **Ranked-choice / multi-round voting** — supports complex election formats
- **Blind vote verification** — voters can self-verify their ballot was counted without exposing identity
- **Configurable rate limiting** — admin-controlled presets to prevent abuse
- **Real-time notifications** — ballot created, vote cast, results published
- **Email notifications** — powered by Resend (ballot creation + results)
- **Token reissue flow** — lost token recovery without enabling double-voting
- **WCAG accessibility** — aria labels, roles, and live regions across all components
- **Mobile responsive** — fully functional on iOS and Android browsers

---

## Who It's For

| Sector          | Use Cases                                                 |
| --------------- | --------------------------------------------------------- |
| **Education**   | Student elections, faculty votes, course feedback         |
| **Corporate**   | Policy votes, leadership surveys, board approvals         |
| **Communities** | Governance decisions, membership votes, program approvals |

---

## How It Works

```
Eligible Voter List
       │
       ▼
 Identity Manager ──► Anonymous Token (one per voter)
       │
       ▼
  Vote Submission ──► Encrypted Vote Record
       │
       ▼
 Stellar Blockchain ──► Immutable Audit Trail
       │
       ▼
  Result Engine ──► Public Verified Results
```

**Administrator flow**

1. Register your organization at `/register` and log in
2. Create a ballot — topic, options, deadline, and eligible voter list (CSV upload)
3. After the voting period ends, results are automatically published and anchored to Stellar

**Voter flow**

1. Receive a voting link from your organization admin
2. Enter your voter identifier (email, employee ID, etc.) to receive a one-time anonymous token
3. Use the token to cast your encrypted vote
4. After the deadline, verify the result at `/results/:ballotId`

**Public verification**

Anyone can visit `/results/:ballotId` and independently confirm the outcome via the Stellar transaction link — no trust required.

---

## Tech Stack

| Layer      | Technology                                            |
| ---------- | ----------------------------------------------------- |
| Frontend   | React 18, Vite, TailwindCSS, React Router v6          |
| Backend    | Node.js 20, Express, TypeScript                       |
| Database   | PostgreSQL 15 + Prisma ORM                            |
| Blockchain | Stellar SDK (Testnet / Mainnet)                       |
| Auth       | JWT via HTTP-only cookies, bcrypt                     |
| Crypto     | AES-256-GCM vote encryption, SHA-256 identity hashing |
| Email      | Resend                                                |
| Testing    | Vitest, React Testing Library                         |

---

## Getting Started

### Prerequisites

- Node.js 20+
- Docker (for PostgreSQL)
- A Stellar account ([create a Testnet account](https://laboratory.stellar.org/#account-creator?network=test))

### 1. Clone the repository

```bash
git clone https://github.com/AnonVote/core.git
cd core
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in your values:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/anonvote
JWT_SECRET=your-secret-here
STELLAR_SECRET_KEY=your-stellar-secret-key
SOROBAN_CONTRACT_ID=your-testnet-contract-id
BALLOT_ENCRYPTION_KEY=your-32-byte-hex-key
NODE_ENV=development
```

> **Tip:** Generate a secure encryption key with `openssl rand -hex 32`

### 3. Start the database

```bash
docker-compose up -d
```

### 4. Install dependencies and run migrations

```bash
cd backend && npm install && npx prisma migrate dev
cd ../frontend && npm install
```

### 5. Start development servers

```bash
# In separate terminals:
npm run dev:backend   # → http://localhost:3001
npm run dev:frontend  # → http://localhost:5173
```

---

## Project Structure

```
AnonVote/
├── backend/
│   ├── src/
│   │   ├── routes/       # API route handlers
│   │   ├── services/     # Business logic (identity, ballot, privacy, result engines)
│   │   ├── middleware/   # Auth, rate limiting, error handling
│   │   ├── utils/        # Crypto helpers, deadline scheduler
│   │   └── tests/        # Unit, integration, and E2E tests
│   └── prisma/           # Database schema and migrations
├── frontend/
│   └── src/
│       ├── pages/        # All UI pages
│       ├── components/   # Reusable UI components
│       ├── hooks/        # useAuth, useBallot
│       └── api/          # Axios API client
├── shared/               # Shared TypeScript types
├── docker-compose.yml    # PostgreSQL local setup
└── .env.example          # Environment variable template
```

---

## API Reference

### Organizations

| Method  | Endpoint                      | Auth    | Description             |
| ------- | ----------------------------- | ------- | ----------------------- |
| `POST`  | `/api/organizations`          | —       | Register organization   |
| `POST`  | `/api/organizations/login`    | —       | Admin login             |
| `POST`  | `/api/organizations/logout`   | Session | Admin logout            |
| `GET`   | `/api/organizations/me`       | Session | Get current org         |
| `PATCH` | `/api/organizations/me`       | Session | Update org name / email |
| `PATCH` | `/api/organizations/password` | Session | Change password         |

### Ballots

| Method   | Endpoint           | Auth    | Description         |
| -------- | ------------------ | ------- | ------------------- |
| `GET`    | `/api/ballots`     | Session | List org ballots    |
| `POST`   | `/api/ballots`     | Session | Create ballot       |
| `GET`    | `/api/ballots/:id` | —       | Get ballot (public) |
| `PATCH`  | `/api/ballots/:id` | Session | Edit ballot         |
| `DELETE` | `/api/ballots/:id` | Session | Delete ballot       |

### Voting

| Method | Endpoint              | Auth    | Description                           |
| ------ | --------------------- | ------- | ------------------------------------- |
| `POST` | `/api/eligibility`    | Session | Upload voter list                     |
| `POST` | `/api/tokens`         | —       | Request voter token                   |
| `POST` | `/api/tokens/reissue` | —       | Reissue lost token (if not yet voted) |
| `POST` | `/api/votes`          | —       | Submit vote                           |

### Results & Audit

| Method | Endpoint                       | Auth    | Description                     |
| ------ | ------------------------------ | ------- | ------------------------------- |
| `GET`  | `/api/results/:ballotId`       | —       | Get published result            |
| `POST` | `/api/results/:ballotId/tally` | Session | Manually close and tally ballot |
| `GET`  | `/api/audit/:ballotId`         | —       | Get audit event counts          |

### Admin

| Method  | Endpoint                   | Auth    | Description                        |
| ------- | -------------------------- | ------- | ---------------------------------- |
| `GET`   | `/api/admin/rate-limit`    | Session | Get rate limit settings            |
| `PATCH` | `/api/admin/rate-limit`    | Session | Update rate limit preset           |
| `GET`   | `/api/admin/tokens-issued` | Session | Total tokens issued across ballots |

---

## Privacy Design

AnonVote's privacy model is structural, not policy-based. The key properties:

- **Voter identifiers are SHA-256 hashed** before storage — originals are never recoverable from the database
- **Voter tokens are 32-byte CSPRNG values** — only their hash is stored server-side
- **No database join exists** between the eligibility table and the token table — unlinkability is enforced at the schema level
- **Vote payloads are AES-256-GCM encrypted** — the tally process decrypts only the option selection, nothing else
- **Audit logs record event counts only** — no identity, no token values, ever

This means that even with full database access, it is computationally infeasible to link a vote back to an individual voter.

---

## Stellar Integration

All votes and audit events are written to Stellar as `manageData` operations on a dedicated AnonVote account. Each record's Stellar transaction ID is stored in the database and surfaced on the public verification page.

This means anyone — not just AnonVote — can independently confirm that a result is legitimate by checking the Stellar ledger directly.

**Testnet vs Mainnet**

Stellar Testnet is used by default for development. To switch to Mainnet, update your `.env`:

```env
STELLAR_SECRET_KEY=your-mainnet-secret-key
STELLAR_NETWORK=mainnet

**Soroban Contract ID**

AnonVote also requires a `SOROBAN_CONTRACT_ID` environment variable to interact with the deployed Soroban smart contract.

For local development, use the published Testnet contract ID.

When deploying to Mainnet, replace it with the deployed Mainnet contract ID.
```

---

## Running Tests

Tests require a running PostgreSQL instance.

```bash
# Backend (unit + integration + E2E)
npm run test:backend

# Frontend (Vitest + React Testing Library, 28 tests)
npm run test:frontend
```

Coverage includes: crypto utilities, organization registration and login, token issuance, vote submission, audit counts, and a full end-to-end voting flow.

---

## Roadmap

- [x] Organization registration and admin auth
- [x] Ballot creation with eligibility list upload
- [x] Anonymous token issuance
- [x] Encrypted vote submission
- [x] Stellar blockchain recording
- [x] Automatic tally and result publication
- [x] Public verification page
- [x] Weighted voting
- [x] Delegated voting
- [x] Multi-round / ranked-choice voting
- [x] Blind vote verification (self-verification without identity exposure)
- [x] Soroban smart contracts (stub — correct stellar-sdk v12 APIs, ready to wire)
- [x] Frontend test suite (Vitest + React Testing Library, 28 tests)
- [x] WCAG accessibility (aria labels, roles, live regions)
- [x] Performance optimization (lazy loading, code splitting)
- [x] Stellar consensus timestamps in audit log
- [x] Token reissue flow
- [x] Edit ballot (topic, deadline, eligibility list, vote-aware field locking)
- [x] Manual close & tally
- [x] Configurable rate limiting
- [x] Real-time notifications
- [x] Avatar upload with navbar sync
- [x] Mobile responsiveness
- [x] Email notifications via Resend
- [x] Landing page (hero, how it works, FAQ, CTA)

---

## Contributing

Pull requests are welcome. For significant changes, please open an issue first to discuss what you'd like to change.

---

## License

[MIT](LICENSE)
