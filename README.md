# AnonVote

> Private decision infrastructure for organizations on Stellar.

AnonVote lets institutions run secure anonymous votes where participation is confidential, results are verifiable, and records are tamper-proof on the Stellar blockchain.

---

<details>
<summary><strong>Why AnonVote</strong></summary>
<br>

Most digital voting tools expose voter identity, store results centrally, and offer no real verification. AnonVote is built differently:

- **One person, one vote** — enforced cryptographically, not by policy
- **Votes stay private** — identity is separated from ballot at every layer
- **Results are verifiable** — anyone can confirm outcomes via Stellar transaction records
- **Records are immutable** — nothing can be altered after submission

</details>

---

<details>
<summary><strong>Who It's For</strong></summary>
<br>

| Sector          | Use Cases                                                 |
| --------------- | --------------------------------------------------------- |
| **Education**   | Student elections, faculty votes, course feedback         |
| **Corporate**   | Policy votes, leadership surveys, board approvals         |
| **Communities** | Governance decisions, membership votes, program approvals |

</details>

---

<details>
<summary><strong>How It Works</strong></summary>
<br>

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

1. An **Administrator** registers their organization and creates a ballot with a topic, options, deadline, and eligible voter list
2. Each eligible voter receives a **one-time anonymous token** — no identity is stored alongside it
3. Voters use their token to **submit an encrypted vote** — the token is marked used, preventing double voting
4. After the deadline, votes are **automatically tallied** and results published
5. Anyone can **verify the result** via the public verification page and Stellar transaction links

</details>

---

<details>
<summary><strong>User Flow</strong></summary>
<br>

**For Administrators (Ballot Creators)**

1. Go to `/register` and create an organization account
2. Log in at `/login` with your credentials
3. Navigate to `/dashboard` to see all your ballots
4. Click "+ Create Ballot" to start a new vote
5. Fill in the ballot details (topic, options, deadline) and upload your eligible voter list (CSV)
6. After the voting period ends, results are automatically published at `/results/:ballotId`

**For Voters (End Users)**

1. Receive a link from your organization admin (e.g., `https://anonvote.app/vote/123/token`)
2. Go to `/vote/:ballotId/token` and enter your voter identifier (email, employee ID, etc.)
3. Click "Get My Token" — you'll receive a one-time anonymous token
4. Copy or save your token (you'll need it to vote)
5. Go to `/vote/:ballotId` and paste your token
6. Select your preferred option and click "Cast Vote"
7. Your vote is encrypted and recorded on the Stellar blockchain
8. After the deadline, view results at `/results/:ballotId`

**For Anyone (Public Verification)**

1. Visit `/results/:ballotId` to see published results
2. Check the "Blockchain Verification" section for the Stellar transaction link
3. Visit `/audit/:ballotId` to see audit event counts (no personal data)

</details>

---

<details>
<summary><strong>Tech Stack</strong></summary>
<br>

| Layer      | Technology                                            |
| ---------- | ----------------------------------------------------- |
| Frontend   | React 18, Vite, TailwindCSS, React Router v6          |
| Backend    | Node.js 20, Express, TypeScript                       |
| Database   | PostgreSQL 15 + Prisma ORM                            |
| Blockchain | Stellar SDK (Testnet / Mainnet)                       |
| Auth       | JWT via HTTP-only cookies, bcrypt                     |
| Crypto     | AES-256-GCM vote encryption, SHA-256 identity hashing |

</details>

---

<details>
<summary><strong>Project Structure</strong></summary>
<br>

```
AnonVote/
├── backend/              # Node.js + Express REST API
│   ├── src/
│   │   ├── routes/       # API route handlers
│   │   ├── services/     # Business logic (identity, ballot, privacy, result engines)
│   │   ├── middleware/   # Auth, rate limiting, error handling
│   │   ├── utils/        # Crypto helpers, deadline scheduler
│   │   └── tests/        # Unit + integration + E2E tests
│   └── prisma/           # Database schema
├── frontend/             # React SPA
│   └── src/
│       ├── pages/        # All 8 UI pages
│       ├── components/   # Reusable UI components
│       ├── hooks/        # useAuth, useBallot
│       └── api/          # Axios API client
├── shared/               # Shared TypeScript types
├── docker-compose.yml    # PostgreSQL local setup
└── .env.example          # Environment variable template
```

</details>

---

<details>
<summary><strong>Getting Started</strong></summary>
<br>

**Prerequisites**

- Node.js 20+
- Docker (for PostgreSQL)
- A Stellar account (Testnet for development)

**1. Clone the repo**

```bash
git clone https://github.com/Just-Bamford/AnonVote.git
cd AnonVote
```

**2. Set up environment variables**

```bash
cp .env.example .env
```

Fill in `.env`:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/anonvote
JWT_SECRET=your-secret-here
STELLAR_SECRET_KEY=your-stellar-secret-key
BALLOT_ENCRYPTION_KEY=your-32-byte-hex-key
NODE_ENV=development
```

**3. Start the database**

```bash
docker-compose up -d
```

**4. Install dependencies and run migrations**

```bash
cd backend && npm install && npx prisma migrate dev
cd ../frontend && npm install
```

**5. Start dev servers**

```bash
# Backend
npm run dev:backend

# Frontend
npm run dev:frontend
```

Frontend → `http://localhost:5173` · Backend → `http://localhost:3001`

</details>

---

<details>
<summary><strong>API Reference</strong></summary>
<br>

| Method | Endpoint                    | Auth    | Description            |
| ------ | --------------------------- | ------- | ---------------------- |
| POST   | `/api/organizations`        | —       | Register organization  |
| POST   | `/api/organizations/login`  | —       | Admin login            |
| POST   | `/api/organizations/logout` | Session | Admin logout           |
| GET    | `/api/ballots`              | Session | List org ballots       |
| POST   | `/api/ballots`              | Session | Create ballot          |
| GET    | `/api/ballots/:id`          | —       | Get ballot (public)    |
| POST   | `/api/eligibility`          | Session | Upload voter list      |
| POST   | `/api/tokens`               | —       | Request voter token    |
| POST   | `/api/votes`                | —       | Submit vote            |
| GET    | `/api/results/:ballotId`    | —       | Get published result   |
| GET    | `/api/audit/:ballotId`      | —       | Get audit event counts |

</details>

---

<details>
<summary><strong>Privacy Design</strong></summary>
<br>

- Voter identifiers are **SHA-256 hashed** before storage — originals are never recoverable
- Voter tokens are **32-byte CSPRNG values** — only their hash is stored
- There is **no database join** between the eligibility table and the token table — unlinkability is structural, not just policy
- Vote payloads are **AES-256-GCM encrypted** — tallying decrypts only the option selection
- Audit logs record **event counts only** — no identity, no token values

</details>

---

<details>
<summary><strong>Stellar Integration</strong></summary>
<br>

All votes and audit events are written to the Stellar blockchain as `manageData` operations on a dedicated AnonVote account. Each record gets a Stellar transaction ID stored in the database and surfaced on the public verification page — so anyone can independently confirm results without trusting AnonVote's servers.

Stellar Testnet is used for development. Switch to Mainnet by updating `STELLAR_SECRET_KEY` and setting `STELLAR_NETWORK=mainnet` in your `.env`.

</details>

---

<details>
<summary><strong>Roadmap</strong></summary>
<br>

- [x] Organization registration and admin auth
- [x] Ballot creation with eligibility list upload
- [x] Anonymous token issuance
- [x] Encrypted vote submission
- [x] Stellar blockchain recording
- [x] Automatic tally and result publication
- [x] Public verification page
- [x] Weighted voting system
- [x] Delegated voting
- [x] Multi-round / ranked-choice voting
- [x] Blind vote verification (voter self-verification without identity exposure)
- [x] Soroban smart contracts (service ready for deployment)
- [ ] Full Soroban smart contract implementation (on-chain logic)
- [ ] Frontend tests
- [ ] Email notifications for ballot creation/closing
- [ ] Mobile responsiveness improvements
- [ ] Accessibility audit (WCAG compliance)
- [ ] Performance optimization (lazy loading, code splitting)

</details>

---

<details>
<summary><strong>Running Tests</strong></summary>
<br>

```bash
# Backend tests (requires running PostgreSQL)
npm run test:backend

# Frontend tests
npm run test:frontend
```

Test coverage includes: crypto utilities, organization registration/login, token issuance, vote submission, audit counts, and a full end-to-end flow.

</details>

---

**License:** MIT
