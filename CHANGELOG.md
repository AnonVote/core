# Changelog

All notable changes to AnonVote will be documented here.

---

## v1.4.0

### Added

- **Weighted Voting System**
  - Added `weight` field to `EligibilityEntry` and `Vote` models
  - Added `allowWeightedVoting` flag to `Ballot` model
  - Updated ballot creation to accept weighted voting option
  - Updated token issuance to include weight in response
  - Updated vote submission to record weight
  - Updated result calculation to use weighted votes
  - Added UI toggle for weighted voting in CreateBallotPage

- **Delegated Voting System**
  - Added `delegatedFrom` and `delegatedTo` fields to `VoterToken` model
  - Created `delegationManager` service for vote delegation
  - Added `/api/delegations` endpoint for delegation operations
  - Updated privacyEngine to handle delegated votes
  - Updated resultEngine to count delegated votes correctly

- **Multi-round / Ranked-Choice Voting**
  - Added `rank` field to `Vote` model for storing voter rankings
  - Added `allowRankedChoice` and `maxRankings` fields to `Ballot` model
  - Updated ballot creation with ranked-choice toggle and max rankings input
  - Updated privacyEngine to handle ranked votes

- **Blind Vote Verification**
  - Created `verificationService` for generating and verifying vote hashes
  - Added `/api/verification/generate` endpoint for voters to get verification hash
  - Added `/api/verification/verify` endpoint for public vote verification
  - Verification hash allows voters to confirm their vote without exposing identity

- **Soroban Smart Contracts Service**
  - Created `sorobanService` for contract deployment and interaction
  - Added `deployContract`, `callContract`, and `getContractData` functions
  - Ready for future Soroban smart contract implementation

### Improved

- **Backend compilation** — Added `--transpile-only` flag to ts-node-dev for faster compilation
- **Logo consistency** — Updated all logo references to use the simple 4-circle logo
- **Icon visibility** — Made calendar icon visible in both light and dark modes

### Fixed

- **Prisma type errors** — Fixed TypeScript errors in delegationManager.ts by adding type assertions
- **IdentityManager weight** — Fixed weight property error in identityManager.ts

### Technical

- **New files:**
  - `backend/src/services/delegationManager.ts`
  - `backend/src/services/verificationService.ts`
  - `backend/src/services/sorobanService.ts`
  - `backend/src/routes/delegations.ts`
  - `backend/src/routes/verification.ts`

- **Updated files:**
  - `backend/prisma/schema.prisma` — Added weighted voting, delegation, and ranked-choice fields
  - `backend/src/types.ts` — Added new fields to types
  - `backend/src/services/ballotEngine.ts` — Added weighted voting support
  - `backend/src/services/identityManager.ts` — Added weight to token response
  - `backend/src/services/privacyEngine.ts` — Added weight and rank support
  - `backend/src/services/resultEngine.ts` — Updated to use weighted votes
  - `backend/src/routes/ballots.ts` — Added weighted voting option
  - `backend/src/routes/tokens.ts` — Added weight to response
  - `backend/src/routes/votes.ts` — Added rank support
  - `backend/src/app.ts` — Added new route handlers
  - `frontend/src/types/index.ts` — Added new fields to types
  - `frontend/src/api/client.ts` — Added new API parameters
  - `frontend/src/pages/CreateBallotPage.tsx` — Added weighted voting and ranked-choice UI
  - `frontend/src/pages/VotePage.tsx` — Updated to handle weighted votes
  - `frontend/public/favicon.svg` — Updated to simple logo
  - `frontend/src/components/Navbar.tsx` — Updated logo
  - `frontend/src/components/PageLoader.tsx` — Updated logo
  - `frontend/src/styles/theme.css` — Fixed icon visibility

- **Migrations:**
  - `20260503162041_add_weighted_voting`
  - `20260503172112_add_delegated_voting`
  - `20260503173305_add_ranked_choice_voting`

---

## v1.1.0

### Improved

- **Complete frontend UI redesign** — Dark and light mode support with theme toggle
- **New design system** — Space Grotesk (headings), DM Sans (body), JetBrains Mono (monospace)
- **Framer-inspired dark mode** — Electric blue accents (#1c7ed6), pure black canvas (#000000), engineered precision
- **Apple-inspired light mode** — Clean surfaces, premium white space (#f5f5f7), ink type hierarchy
- **Improved error and success message components** — Consistent design system classes with proper icon sizing
- **Sticky navbar** — Fixed at top with frosted glass effect (backdrop-filter blur)
- **New footer** — Two-column layout with copyright/credit and navigation links
- **Password visibility toggle** — Eye icon on login and registration pages
- **Input field icon fixes** — Icons now correctly positioned inside fields
- **401 interceptor** — No longer redirects on public routes (login, register, token request)
- **Theme persistence** — Theme toggle now persists across sessions via localStorage
- **Dark mode toggle** — Manual toggle in navbar with sun/moon icon, persists user preference
- **PageLoader component** — Animated SVG loader with rose curve pattern and particle trail

### Fixed

- Input field icons now correctly positioned inside fields
- 401 interceptor no longer redirects on public routes
- Theme toggle now persists across sessions via localStorage

---

## v1.0.0

### Released

- **Organization registration and login** — Secure authentication with bcrypt password hashing
- **Ballot creation** — Dynamic options, eligibility list upload, voting deadline
- **Anonymous token-based voting** — One-time tokens with SHA-256 hashing
- **Results page** — Vote counts and percentages with visual breakdown
- **Stellar blockchain verification** — Tamper-proof results with public transaction IDs
- **Audit page** — Ballot transparency with event tracking
- **AES-256-GCM encryption** — Vote payloads encrypted with organization-specific key
- **SHA-256 voter token hashing** — No raw tokens stored in database
- **Eligibility list upload** — CSV/plain-text validation with injection prevention
- **Rate limiting** — Strict rate limiter (3 req/min) for vote submission
- **Session management** — JWT-based sessions with 8-hour expiration
- **Audit event tracking** — TOKEN_ISSUED, VOTE_CAST, RESULT_PUBLISHED events
- **Duplicate attempt detection** — Prevents token reuse and vote duplication

---

## v0.1.0

### Initial Development

- **Backend scaffolding** — Express.js with TypeScript
- **Prisma ORM setup** — PostgreSQL with Supabase connection
- **Core services** — Ballot engine, privacy engine, result engine, identity manager
- **Stellar integration** — Testnet blockchain for immutable audit trail
- **Frontend scaffolding** — React with Vite, TypeScript, Tailwind CSS
- **API client** — TypeScript client with axios interceptors
- **Theme context** — Dark/light mode toggle with localStorage persistence

---

## v1.2.0

### Added

- **Notification system** — App-wide notification management with `NotificationContext`
  - `NotificationContext.tsx` — Stores notifications in state with types: `ballot_created`, `ballot_closed`, `results_published`, `token_requested`, `warning`
  - `NotificationDropdown.tsx` — Reusable notification dropdown component
  - `useNotifications()` hook — Access notifications, unread count, mark all as read, add notification
  - LocalStorage persistence for notifications
  - 3 seed notifications on first load

- **Navbar redesign** — Replaced standalone Logout button and theme toggle with new elements:
  - **Notification Bell** — Bell icon with red dot indicator for unread notifications
    - Clicking opens notification dropdown overlay (no page navigation)
    - Shows up to 10 most recent notifications
    - "Mark all as read" button at top
    - Click-outside detection to close dropdown
  - **User Avatar / Profile Button** — Circular avatar showing first letter of org name
    - Background: `var(--brand-primary)`, text: white, font: `var(--font-display)`
    - Dropdown with: Profile & Settings, Theme toggle, Logout
    - Click-outside detection to close dropdown

- **Auth state enhancement** — Added `orgEmail` to `useAuth()` hook
  - Fetches email from `getMe()` API response
  - Updated all state updates to include `orgEmail`

### Improved

- **Consistent dropdown styling** — Both notification and profile dropdowns use same base classes:
  - `navbar-dropdown` — Shared positioning, z-index, animation
  - `navbar-dropdown-item` — Consistent hover effects and transitions
  - `navbar-dropdown-divider` — Uniform divider styling
  - `navbar-avatar` — Circular avatar with hover opacity effect
  - `navbar-bell` — Bell icon with consistent hover behavior
  - `navbar-bell-dot` — Red dot indicator for unread notifications

- **Profile dropdown** — Now uses `orgEmail` from auth state instead of hardcoded `org@example.com`

### Technical

- **New files:**
  - `frontend/src/context/NotificationContext.tsx`
  - `frontend/src/components/NotificationDropdown.tsx`

- **Updated files:**
  - `frontend/src/hooks/useAuth.ts` — Added `orgEmail` to auth state
  - `frontend/src/components/Navbar.tsx` — New notification bell and avatar dropdown
  - `frontend/src/components/Navbar.css` — New dropdown classes and styles
  - `frontend/src/App.tsx` — Wrapped with `NotificationProvider`

---

## v1.3.0

### Added

- **Settings page** — Full settings dashboard at `/settings` route
  - Two-column layout: 240px fixed sidebar + scrollable content area
  - 6 settings sections: Profile, Appearance, Stellar, Security, Danger Zone, Contact Support
  - Active section tracked with `useState` - no page navigation, everything renders inline
  - Responsive: single column on mobile

- **Profile section** — Manage organization information
  - Profile picture card with 80px circular avatar
  - Upload photo and Remove buttons
  - Organization Details card with inline editing for name and email
  - Account ID with copy button
  - Member Since date display
  - `updateOrg` API function for saving changes

- **Appearance section** — Customize AnonVote appearance
  - Theme card with Light/Dark mode cards (icon, label, description, checkmark)
  - Accent Color card with 6 color swatches (Indigo, Blue, Emerald, Violet, Rose, Amber)
  - Font Size card with Small/Default/Large options
  - localStorage persistence for theme, accent color, and font size
  - Dynamic theming via `document.documentElement.style.setProperty`

- **Stellar section** — Manage blockchain configuration
  - Network card with Testnet/Mainnet toggle (badge-open/badge-closed styles)
  - Stellar Expert URL with external link icon
  - Transaction Signing status with green dot
  - Stellar Account card with Public Key, Last Transaction, Total Transactions

- **Security section** — Keep account safe
  - Change Password card with 3 fields and validation (min 8 chars, passwords match)
  - Active Sessions card with browser info and "Sign out all other sessions" button
  - Two-Factor Authentication card with "Not enabled" status and "Enable 2FA" button
  - `changePassword` API function

- **Danger Zone section** — Irreversible actions
  - Delete All Ballots card with inline confirmation
  - Delete Account card with inline confirmation
  - Red outlined button for "Delete All Ballots"
  - Red primary button for "Delete Account"
  - `deleteAccount` API function
  - Clears localStorage and navigates to `/login` on success

### Fixed

- **AuditTable.tsx** — Fixed JSX structure issue with broken `<a>` tag

### Technical

- **New files:**
  - `frontend/src/pages/SettingsPage.tsx`
  - `frontend/src/pages/SettingsPage.css`
  - `frontend/src/context/NotificationContext.tsx`
  - `frontend/src/components/NotificationDropdown.tsx`

- **Updated files:**
  - `frontend/src/hooks/useAuth.ts` — Added `orgEmail` to auth state
  - `frontend/src/api/client.ts` — Added `updateOrg`, `changePassword`, `deleteAccount` functions
  - `frontend/src/App.tsx` — Added `/settings` route, wrapped with `NotificationProvider`
  - `frontend/src/components/Navbar.tsx` — New notification bell and avatar dropdown
  - `frontend/src/components/Navbar.css` — New dropdown classes and styles
  - `frontend/src/components/AuditTable.tsx` — Fixed JSX structure
