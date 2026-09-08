# Security Policy

## Supported Versions

| Version | Status | Support Until |
|---------|--------|---------------|
| 1.x     | Active | Current       |

## Reporting Security Vulnerabilities

If you discover a security vulnerability in AnonVote, please **do not** open a public GitHub issue.

Instead:

1. Email: **security@anonvote.dev** (or file a private security advisory)
2. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will acknowledge your report within 48 hours and provide updates as we investigate.

## Security Practices

### Dependency Management

- **Locked dependencies** (`Cargo.lock`, `pnpm-lock.yaml`) enforced in all builds
- **Automated audits** via `cargo audit` and `pnpm audit` on every PR
- **Dependency review** blocks PRs introducing vulnerable dependencies
- **Supply chain validation** via `cargo-deny` (license checks, advisory checks)

### Code Quality

- **Mandatory linting** (ESLint, Clippy)
- **Type checking** (TypeScript strict mode)
- **Format enforcement** (Prettier, `cargo fmt`)
- **Static analysis** (CodeQL for TypeScript/C++)

### Smart Contract Security

- **WASM size validation** (≤ 256KB recommended)
- **Contract spec verification** (interface validation)
- **Reproducible builds** (verified deterministic output)
- **Soroban SDK updates** (always latest stable)

### Secrets Management

- **TruffleHog scanning** detects committed credentials
- **GitHub secret scanning** enabled
- **Pre-commit hooks** prevent accidental secret commits (optional)

### Release Security

- **Signed releases** (GPG or Code Signing Certificate)
- **Reproducible builds** verified on each release
- **SBOM generation** for supply chain transparency
- **Build attestation** for release verification

## CI/CD Security

### Permissions (Least Privilege)

```yaml
permissions:
  contents: read
  security-events: write
  pull-requests: read
  statuses: write
```

- Workflows only request required permissions
- Release workflow uses OIDC token authentication
- No broad `write` permissions granted by default

### Actions Pinning

All GitHub Actions should pin to commit SHAs for auditability:

```yaml
- uses: actions/checkout@<SHA>  # Not: @v4 (unpinned)
```

## Vulnerability Response

1. **Immediate**: Evaluate severity (CVSS score)
2. **Patching**: Prepare fix and test thoroughly
3. **Release**: Issue hotfix release if critical
4. **Disclosure**: Publish security advisory on GitHub
5. **Follow-up**: Update dependencies to prevent recurrence

## Compliance & Auditing

- **Reproducible builds** ensure build integrity
- **Dependency diffs** tracked in PR reviews
- **SBOM generation** provides supply chain transparency
- **Audit logs** available for GitHub Actions runs

## Resources

- [Soroban SDK Security](https://soroban.stellar.org/docs)
- [Rust Security Guidelines](https://anssi-fr.github.io/rust-guide/)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [CycloneDX SBOM Format](https://cyclonedx.org/)

---

**Last Updated**: 2026-09-08  
**Next Review**: 2026-12-08
