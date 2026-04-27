# AnonVote Implementation Tasks

## Task 1: Project Scaffolding and Configuration

- [x] 1.1 Initialize monorepo structure with `backend/`, `frontend/`, `shared/` directories
- [x] 1.2 Initialize backend: `npm init`, install Express, TypeScript, Prisma, stellar-sdk, bcrypt, jsonwebtoken, express-rate-limit, multer, dotenv
- [x] 1.3 Initialize frontend: `npm create vite@latest` with React + TypeScript, install TailwindCSS, React Router v6, Axios
- [x] 1.4 Create `backend/src/prisma/schema.prisma` with all models from design (Organization, Session, Ballot, Option, EligibilityList, EligibilityEntry, VoterToken, Vote, Result, AuditEvent)
- [ ] 1.5 Run `prisma migrate dev` to create initial database migration (requires running PostgreSQL — run manually: `cd backend && npx prisma migrate dev`)
- [x] 1.6 Create `backend/src/config.ts` for environment variable loading (DATABASE_URL, JWT_SECRET, STELLAR_SECRET_KEY, BALLOT_ENCRYPTION_KEY, NODE_ENV)
- [x] 1.7 Create `backend/src/app.ts` with Express setup: JSON middleware, cookie-parser, CORS, rate limiter, error handler
- [x] 1.8 Create `docker-compose.yml` with PostgreSQL service
- [x] 1.9 Create `.env.example` with all required environment variables documented
- [x] 1.10 Create root `README.md` with setup and run instructions

## Task 2: Crypto and Utility Helpers

- [x] 2.1 Create `backend/src/utils/crypto.ts` with `hashIdentifier(id: string): string` using SHA-256
- [x] 2.2 Add `generateToken(): string` to crypto utils — 32 bytes CSPRNG, hex encoded (128-bit entropy minimum)
- [x] 2.3 Add `hashToken(token: string): string` to crypto utils — SHA-256 of raw token
- [x] 2.4 Add `encryptVote(optionId: string, ballotKey: string): string` using AES-256-GCM
- [x] 2.5 Add `decryptVote(payload: string, ballotKey: string): string` for tally use
- [x] 2.6 Write unit tests for all crypto utilities

## Task 3: Authentication Middleware and Session Management

- [x] 3.1 Create `backend/src/middleware/auth.ts` — validates HTTP-only JWT cookie, attaches org to `req.organization`
- [x] 3.2 Create `backend/src/middleware/rateLimiter.ts` — 10 failed attempts per 60s window blocks source for 300s
- [x] 3.3 Create `backend/src/middleware/errorHandler.ts` — global error handler returning `{ error, message }` JSON
- [x] 3.4 Write tests for auth middleware (valid session, expired session, missing session)

## Task 4: Organization Registration and Login API

- [x] 4.1 Create `backend/src/routes/organizations.ts`
- [x] 4.2 Implement `POST /api/organizations` — validate fields, hash password with bcrypt, create org + admin, return 201
- [x] 4.3 Implement `POST /api/organizations/login` — validate credentials, create Session record, set HTTP-only JWT cookie, return 200
- [x] 4.4 Implement `POST /api/organizations/logout` — invalidate Session record, clear cookie, return 200
- [x] 4.5 Write integration tests for registration (success, duplicate name, missing fields) and login (success, wrong password)

## Task 5: Eligibility List Upload API

- [x] 5.1 Create `backend/src/routes/eligibility.ts`
- [x] 5.2 Implement `POST /api/eligibility` — accept multipart CSV/TXT file upload (max 10MB), parse voter identifiers, SHA-256 hash each, deduplicate, store EligibilityList + EligibilityEntry records, return count
- [x] 5.3 Write tests for eligibility upload (success, duplicate deduplication, file too large, unauthenticated)

## Task 6: Ballot Engine — Create and Retrieve Ballots API

- [x] 6.1 Create `backend/src/services/ballotEngine.ts`
- [x] 6.2 Implement `POST /api/ballots` — validate topic, min 2 options, future deadline, eligibilityListId; create Ballot + Options; return ballot with id
- [x] 6.3 Implement `GET /api/ballots` — return all ballots for authenticated org with status, deadline, eligible voter count, token issued count, vote count
- [x] 6.4 Implement `GET /api/ballots/:id` — return ballot topic and options (public, no auth required)
- [x] 6.5 Create `backend/src/utils/scheduler.ts` — polls every 30s, closes ballots past deadline, triggers result engine
- [x] 6.6 Write tests for ballot creation (success, <2 options, past deadline, unauthenticated) and retrieval

## Task 7: Identity Manager — Token Issuance API

- [x] 7.1 Create `backend/src/services/identityManager.ts`
- [x] 7.2 Implement `POST /api/tokens` — accept ballotId + voterIdentifier; hash identifier; check eligibility; check token not already issued; generate 32-byte CSPRNG token; store hash; mark entry as token-issued; write TOKEN_ISSUED audit event; return raw token
- [x] 7.3 Enforce: reject if ballot is CLOSED; reject if token already issued for this identifier+ballot; reject without revealing ballot existence if identifier not in list
- [x] 7.4 Write tests for token issuance (success, duplicate request, ineligible voter, closed ballot)

## Task 8: Privacy Engine — Vote Submission API

- [x] 8.1 Create `backend/src/services/privacyEngine.ts`
- [x] 8.2 Implement `POST /api/votes` — accept ballotId + voterToken + optionId; hash token; validate token exists and unused; validate optionId belongs to ballot; encrypt vote payload; create Vote record; mark token as used; write VOTE_CAST audit event; return confirmation
- [x] 8.3 Enforce: reject used tokens; reject invalid tokens; reject invalid options; reject if ballot CLOSED
- [x] 8.4 Write tests for vote submission (success, used token, invalid token, wrong option, closed ballot)

## Task 9: Stellar Blockchain Integration

- [x] 9.1 Create `backend/src/services/stellarService.ts`
- [x] 9.2 Implement `writeRecord(data: object): Promise<string>` — serialize data, write as Stellar manageData operation, return transaction ID
- [x] 9.3 Add retry logic: up to 3 attempts on failure before throwing
- [x] 9.4 Integrate Stellar writes into vote submission (after Vote record created) and audit event creation
- [x] 9.5 Integrate Stellar writes into result publication
- [x] 9.6 Store returned stellarTxId back on Vote, AuditEvent, and Result records
- [x] 9.7 Write tests for Stellar service with mocked SDK (success, retry on failure, failure after 3 retries)

## Task 10: Result Engine — Tally and Publication API

- [x] 10.1 Create `backend/src/services/resultEngine.ts`
- [x] 10.2 Implement `tallyBallot(ballotId: string)` — count votes per option; compare total votes to used token count; flag inconsistency if mismatch; create Result record; write RESULT_PUBLISHED audit event; write Stellar record
- [x] 10.3 Implement `GET /api/results/:ballotId` — return published result with tally, total votes, stellarTxId (public, no auth)
- [x] 10.4 Write tests for tally (correct counts, inconsistency detection, Stellar write called)

## Task 11: Audit API

- [x] 11.1 Create `backend/src/routes/audit.ts`
- [x] 11.2 Implement `GET /api/audit/:ballotId` — return counts of TOKEN_ISSUED and VOTE_CAST events, plus stellarTxIds for each event type (public, no auth)
- [x] 11.3 Write tests for audit endpoint (known ballot, unknown ballot)

## Task 12: Frontend — Project Setup and Routing

- [x] 12.1 Configure TailwindCSS in `frontend/tailwind.config.ts` and `frontend/src/index.css`
- [x] 12.2 Create `frontend/src/api/client.ts` — Axios instance with base URL, `withCredentials: true`, response interceptor for 401 redirect
- [x] 12.3 Create `frontend/src/types/index.ts` with shared TypeScript types (Ballot, Option, Result, AuditCounts, etc.)
- [x] 12.4 Set up React Router in `frontend/src/App.tsx` with routes for all 8 pages
- [x] 12.5 Create `frontend/src/hooks/useAuth.ts` — check session state, expose `isAuthenticated`, `logout()`
- [x] 12.6 Create `frontend/src/components/Navbar.tsx` — shows org name when authenticated, logout button

## Task 13: Frontend — Registration and Login Pages

- [x] 13.1 Create `frontend/src/pages/RegisterPage.tsx` — form with org name, email, password; inline validation; loading state; success redirect to login; error display
- [x] 13.2 Create `frontend/src/pages/LoginPage.tsx` — form with org name, password; sets session cookie via API; redirects to dashboard on success; generic error message on failure

## Task 14: Frontend — Admin Dashboard

- [x] 14.1 Create `frontend/src/components/BallotCard.tsx` — displays ballot topic, status badge, deadline, eligible count, tokens issued, votes cast; shareable link for open ballots; results link for closed ballots; inconsistency warning
- [x] 14.2 Create `frontend/src/pages/DashboardPage.tsx` — fetches ballot list on mount; auto-refreshes every 60s; renders BallotCard list; "Create Ballot" button; redirects to login if unauthenticated

## Task 15: Frontend — Ballot Creation Page

- [x] 15.1 Create `frontend/src/pages/CreateBallotPage.tsx` — topic input; dynamic option inputs (add/remove, min 2); deadline datetime picker; CSV/TXT file upload (max 10MB client-side check); two-step submit (upload eligibility then create ballot); loading state; error retention; success redirect to dashboard

## Task 16: Frontend — Token Request Page

- [x] 16.1 Create `frontend/src/components/TokenDisplay.tsx` — shows issued token with copy-to-clipboard button and security warning
- [x] 16.2 Create `frontend/src/pages/TokenRequestPage.tsx` — reads ballotId from URL; fetches ballot info; shows topic + deadline; voter identifier input; submits token request; displays TokenDisplay on success; privacy-safe error messages; link to vote page

## Task 17: Frontend — Vote Submission Page

- [x] 17.1 Create `frontend/src/components/OptionSelector.tsx` — radio-style option selection
- [x] 17.2 Create `frontend/src/pages/VotePage.tsx` — reads ballotId from URL; fetches ballot options; token input field; OptionSelector; submit enabled only when both token entered and option selected; loading state; success confirmation with link to results; error display without clearing token

## Task 18: Frontend — Results and Audit Pages

- [x] 18.1 Create `frontend/src/components/ResultChart.tsx` — bar chart showing vote counts and percentages per option
- [x] 18.2 Create `frontend/src/components/AuditTable.tsx` — table of event types, counts, and Stellar explorer links
- [x] 18.3 Create `frontend/src/pages/ResultsPage.tsx` — reads ballotId from URL; fetches result; displays ResultChart; Stellar tx link; audit counts; handles no-result state
- [x] 18.4 Create `frontend/src/pages/AuditPage.tsx` — reads ballotId from URL; fetches audit counts; displays AuditTable; inconsistency notice if counts differ

## Task 19: End-to-End Integration and Final Wiring

- [x] 19.1 Connect ballot deadline scheduler to result engine tally trigger
- [x] 19.2 Verify CORS config allows frontend origin with credentials
- [x] 19.3 Add `proxy` config in `vite.config.ts` to forward `/api` to backend in development
- [x] 19.4 Write one end-to-end test covering: register org → create ballot → request token → submit vote → verify result
- [x] 19.5 Add `package.json` scripts at root for `dev`, `build`, `test`

## Task 20: GitHub Push

- [x] 20.1 Create `.gitignore` covering `node_modules`, `.env`, `dist`, `prisma/migrations` generated files
- [x] 20.2 Initialize git repo, add remote `https://github.com/Just-Bamford/AnonVote.git`
- [x] 20.3 Stage all files, create initial commit with message `feat: initial AnonVote scaffold`
- [x] 20.4 Push to `main` branch
