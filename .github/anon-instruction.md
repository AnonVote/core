# AnonVote Development Guidelines

You are an expert developer in Rust, TypeScript, Node.js, React, Stellar SDK, Soroban, and smart contracts.

---

## Coding Philosophy

Our coding philosophy revolves around writing **semantic, idiomatic, secure, and maintainable code**. Follow these key principles:

- **Modern Languages & Type Safety:**
  Leverage TypeScript for Node.js/React, Rust for Soroban contracts and cryptography.

- **Declarative React:**
  Describe UI structure and state, avoiding imperative code patterns.

- **Readable Naming:**
  Use self-explanatory names for variables, functions, components, and contract functions.

- **Single Responsibility Principle:**
  Keep components, functions, and modules focused and reusable.

- **Favor Composition Over Inheritance:**
  Build components and functions that promote modularity and reusability.

- **Security First:**
  Never trust user input; validate and sanitize all data before processing.

---

## Project Structure

```
core/
├── .github/
│   ├── workflows/          # CI/CD pipelines
│   │   ├── pr.yml         # Main PR checks (5 workspaces)
│   │   ├── enforce-develop-branch.yml
│   │   ├── lint.yml       # Optional linting
│   │   ├── security.yml   # Scheduled security audits
│   │   └── deploy.yml     # Tag-triggered releases
│   ├── DEVELOPMENT.md     # This file
│   └── profile/README.md
├── apps/
│   ├── backend/           # Express.js + Node.js (TypeScript)
│   └── frontend/          # React (TypeScript)
├── packages/
│   ├── crypto/            # Cryptography utilities (TypeScript)
│   └── contracts/         # Stellar contract testing (TypeScript)
├── src/                   # Rust/Soroban contracts
└── pnpm-workspace.yaml    # Monorepo configuration
```

---

## General Conventions

- **Filenames:**
  - Use lowercase with dash separators (e.g., `auth-service.ts`, `vote-form.tsx`)
  - File extensions indicate type: `.config.ts`, `.test.ts`, `.hook.tsx`, `.service.ts`

- **Exporting:**
  - Prefer named exports over default exports
  - Group related exports logically

- **Imports:**
  - Organize imports: Node stdlib → packages → local modules
  - Use absolute paths for `packages/` imports

---

## JavaScript/TypeScript Best Practices

- **Naming Variables:**
  - Use meaningful names reflecting purpose
  - Prefix booleans with auxiliary verbs: `isValid`, `hasError`, `shouldRetry`
  - Prefix async functions with verb: `fetchUser()`, `submitVote()`

- **Functional Programming:**
  - Prefer arrow functions for callbacks
  - Use `const` by default; `let` only when reassignment is needed
  - Avoid `var`; use block-scoped declarations

- **TypeScript Usage:**
  - Use `interface` for objects and API contracts
  - Use `type` for unions, tuples, and aliases
  - Avoid `any`; prefer explicit types or inference
  - Explicitly annotate function parameters and return types
  - Use discriminated unions for state machines (vote status, ballot state)

- **Error Handling:**
  - Use try/catch for async operations
  - Return meaningful error messages
  - Log errors with context (user ID, request ID, timestamp)

---

## React/Next.js Conventions

- **Component Declaration Order:**
  1. Imports
  2. TypeScript types and interfaces
  3. Component declaration
  4. Styled components (if any)

- **Component Structure:**
  - Small, focused components following single responsibility
  - Functional components with hooks (no class components)
  - Use `use client` directive minimally; prefer Server Components when possible

- **State Management:**
  - Use React hooks for local state (`useState`, `useReducer`)
  - Use context for shared state across component trees
  - Lift state up only when necessary

- **Performance:**
  - Lazy load non-critical components with `React.lazy()`
  - Use `Suspense` with fallbacks
  - Memoize expensive computations with `useMemo`
  - Avoid unnecessary re-renders with `React.memo` and `useCallback`

---

## Node.js/Express Backend Conventions

- **Server Structure:**
  - Organize routes by feature (e.g., `/routes/votes/`, `/routes/ballots/`)
  - Use middleware for cross-cutting concerns (auth, logging, error handling)
  - Separate business logic from route handlers

- **Database Access:**
  - Use prepared statements/parameterized queries to prevent SQL injection
  - Abstract database logic in service/repository layers
  - Use transactions for multi-step operations (vote + audit log)
  - Always validate schema with TypeScript types

- **API Design:**
  - RESTful conventions: GET, POST, PUT, DELETE
  - Meaningful HTTP status codes (200, 201, 400, 404, 500)
  - Return consistent JSON response format
  - Document endpoints with JSDoc comments

---

## Rust/Soroban Conventions

- **Smart Contract Security:**
  - Validate all contract parameters at entry points
  - Use checked arithmetic to prevent overflow/underflow
  - Implement proper access controls (caller validation)
  - Avoid panics in production; return Result with meaningful errors

- **Code Organization:**
  - Separate concerns: contract interface, business logic, state management
  - Use descriptive type names for clarity
  - Document contract functions with doc comments

- **Testing:**
  - Write unit tests for all contract functions
  - Test edge cases: overflow, underflow, invalid inputs
  - Use Soroban test utilities for integration tests

---

## Naming Conventions

| Type | Prefix | Example |
|------|--------|---------|
| Booleans | is/has/should/does | `isValid`, `hasPermission`, `shouldRetry` |
| Files | lowercase-dash | `vote-service.ts`, `ballot-form.tsx` |
| Directories | lowercase | `routes/`, `services/`, `components/` |
| Components | PascalCase | `VoteForm.tsx`, `BallotCard.tsx` |
| Constants | UPPER_SNAKE_CASE | `MAX_VOTE_WEIGHT`, `VOTE_TIMEOUT_MS` |
| Interfaces | PascalCase, optional I prefix | `Vote`, `IBallot` |
| Enums | PascalCase | `VoteStatus`, `BallotState` |

---

## Security Best Practices

- **Authentication & Authorization:**
  - Validate JWT tokens on every protected endpoint
  - Use Stellar public keys for identity verification
  - Implement Role-Based Access Control (RBAC)
  - Never trust user input for privilege checks

- **Cryptography:**
  - Use well-tested libraries (`tweetnacl`, `libsodium`)
  - Never roll your own crypto; defer to audited implementations
  - Store private keys securely (environment variables, never in code)
  - Validate digital signatures before processing votes

- **Data Validation:**
  - Validate all API inputs (type, range, format)
  - Sanitize data before database insertion
  - Reject oversized payloads
  - Use strict TypeScript types to catch validation errors at compile time

- **Dependency Management:**
  - Run `pnpm audit` and `cargo audit` regularly
  - Keep dependencies up-to-date; update within 2 weeks of security patch release
  - Use `--frozen-lockfile` in CI to ensure reproducible builds
  - Pin transitive dependencies to avoid supply chain attacks

---

## Testing Guidelines

- **Unit Tests:**
  - Test individual functions in isolation
  - Use Jest for Node.js; use Cargo test for Rust
  - Aim for 80%+ code coverage on business logic

- **Integration Tests:**
  - Test API endpoints with sample payloads
  - Validate database interactions
  - Test error scenarios (invalid votes, replay attacks)

- **End-to-End Tests:**
  - Test complete voting workflows
  - Validate Stellar blockchain interactions
  - Use testnet for integration tests

---

## Performance Optimization

- **Frontend:**
  - Minimize JavaScript bundle size
  - Use code splitting for routes
  - Lazy load images with `next/image`
  - Cache static assets with service workers

- **Backend:**
  - Use connection pooling for databases
  - Cache frequently-accessed data (ballot metadata, user roles)
  - Use pagination for large datasets
  - Monitor query performance; add indices as needed

- **Blockchain:**
  - Batch vote submissions when possible
  - Use Soroban optimizations (minimize state mutations)
  - Cache blockchain data locally to reduce RPC calls

---

## Accessibility Guidelines

- Ensure all interactive elements are keyboard accessible
- Use semantic HTML (`<button>`, `<label>`, `<form>`)
- Use ARIA roles and attributes for screen readers
- Maintain WCAG AA color contrast ratios
- Test with screen readers (NVDA, JAWS)

---

## Documentation Standards

- Provide JSDoc comments for all exported functions
- Document contract functions with doc comments
- Include examples in README files
- Document environment variables (create `.env.example`)
- Maintain Stellar SDK integration docs

---

## CI/CD Pipeline

**pr.yml** (Triggered on PR to develop):
- Frontend: Build with `pnpm -C apps/frontend build`
- Backend: Build, test, audit with `pnpm audit --audit-level=high`
- Contracts: Test with `pnpm -C packages/contracts test`
- Crypto: Test with `pnpm -C packages/crypto test`
- Rust: Build WASM, test, audit with `cargo audit`

**enforce-develop-branch.yml**: Blocks PRs to main, redirects to develop

**lint.yml** (Optional): ESLint + Biome on TypeScript/JavaScript changes

**security.yml** (Scheduled weekly): Runs `cargo audit` and `npm audit` for security updates

**deploy.yml** (Tag-triggered): Builds WASM, generates attestation, creates GitHub release

---

## Code Review Checklist

- [ ] Code follows naming conventions and is readable
- [ ] Type safety: No `any` types, all inputs validated
- [ ] Security: No hardcoded secrets, inputs validated, proper access control
- [ ] Tests: New functionality includes unit/integration tests
- [ ] Performance: No N+1 queries, efficient algorithms
- [ ] Documentation: JSDoc comments, README updated if needed
- [ ] Accessibility: Interactive elements keyboard-accessible
- [ ] Error handling: Meaningful error messages, no silent failures

---

## Key Resources

- [Stellar Documentation](https://developers.stellar.org/)
- [Soroban Smart Contracts](https://soroban.stellar.org/)
- [Express.js Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [React Docs](https://react.dev/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Rust Book](https://doc.rust-lang.org/book/)
