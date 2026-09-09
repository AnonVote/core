# Contributing to AnonVote

Thank you for your interest in contributing! This document provides guidelines for contributing to the AnonVote monorepo.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/your-username/core.git`
3. Create a feature branch: `git checkout -b feature/your-feature`
4. Set up the project:
   ```bash
   pnpm install
   ```

## Project Structure

```
core/
├── apps/
│   ├── backend/        # Express backend API
│   └── frontend/       # React frontend application
├── packages/
│   ├── crypto/         # @anonvote/crypto package
│   └── contracts/      # Soroban smart contracts + TypeScript service
├── docs/               # Documentation
└── .github/workflows/  # CI/CD workflows
```

## Development Workflow

### Making Changes

1. Create a feature branch from `develop`:

   ```bash
   git checkout -b feature/your-feature develop
   ```

2. Make your changes and commit:

   ```bash
   git commit -m "feat: description of your change"
   ```

3. Follow the commit message convention:
   - `feat:` for new features
   - `fix:` for bug fixes
   - `docs:` for documentation
   - `test:` for tests
   - `chore:` for maintenance

### Testing

Run tests locally before pushing:

```bash
pnpm run test
pnpm run lint
```

For package-specific tests:

```bash
pnpm run test --filter=crypto
pnpm run test --filter=backend
```

### Running Builds

```bash
pnpm run build          # Build all packages
pnpm run build --filter=crypto
pnpm run dev            # Run dev servers
```

## Pull Request Process

1. Push your branch to your fork
2. Create a Pull Request against `develop` branch
3. Provide a clear description of your changes
4. Link related issues (if any)
5. Wait for CI/CD checks to pass
6. Address any review comments
7. Once approved, maintainers will merge

## Code Standards

- Use TypeScript for new code
- Follow the existing code style
- Add tests for new features
- Update documentation as needed
- Ensure linting passes: `pnpm run lint`

## Working with Packages

### Crypto Package (`packages/crypto/`)

- FIPS 140-2 compliance required for cryptographic changes
- Integration tests: `pnpm run test:integration --filter=crypto`
- Examples: `pnpm run test:examples --filter=crypto`

### Contracts Package (`packages/contracts/`)

- Rust contracts: Build with `cargo build --target wasm32v1-none --release`
- TypeScript service: Located in `packages/contracts/service/`
- Test: `npm test` in the service directory

### Backend (`apps/backend/`)

- Express API server
- Run: `pnpm run dev:backend`

### Frontend (`apps/frontend/`)

- React application
- Run: `pnpm run dev:frontend`

## CI/CD Pipeline

Our automated checks include:

- Linting (multiple Node versions)
- Unit tests (18.x, 20.x, 22.x)
- FIPS compliance validation
- Soroban contract WASM build
- Security audit

All checks must pass before merging.

## Need Help?

- Check existing issues and PRs
- Read the documentation in `/docs`
- Open a discussion or issue for questions

## License

By contributing, you agree that your contributions will be licensed under the same license as the project.
