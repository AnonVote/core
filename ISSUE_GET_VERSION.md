# Issue: Contract has no version identifier — add get_version view function

## Description

The Soroban smart contract lacks an on-chain version identifier. While the contract is versioned via `Cargo.toml` (currently `version = "0.1.0"`), there is no queryable `get_version()` function exposed to external callers. This makes it difficult for:

- Frontend applications to verify they're interacting with a compatible contract version
- Indexers and monitoring systems to track contract versions
- Auditors to confirm which version of the contract is deployed
- Governance systems to enforce version requirements

## Problem

- Contract version is only stored in Cargo.toml, not queryable on-chain
- External systems cannot programmatically verify contract version
- Deployments across environments may have version mismatches undetected
- No version information in contract metadata or state
- Difficult to manage upgrades and backward compatibility

## Solution

Add a `get_version()` view function to the contract that:

1. Returns a semantic version string (e.g., "0.1.0", "1.2.3")
2. Is queryable without authentication
3. Returns version and optional build metadata
4. Can be queried via: `soroban contract invoke ... -- get_version`

## Proposed Implementation

```rust
/// Returns the contract semantic version as a string.
/// This can be queried to verify contract version before invoking operations.
pub fn get_version() -> String {
    String::from_small(env, "0.1.0")
}

/// Alternative: More detailed version info
pub fn get_version_info() -> VersionInfo {
    VersionInfo {
        version: String::from_small(env, "0.1.0"),
        build_date: 1725532800u64, // Unix timestamp
        network: String::from_small(env, "testnet"),
    }
}
```

## Response Format

```json
{
  "version": "0.1.0"
}
```

Or with extended info:

```json
{
  "version": "0.1.0",
  "build_date": "2025-01-15",
  "network": "testnet"
}
```

## Files Involved

- `contracts/contracts/anonvote/src/lib.rs` - Add `get_version()` function
- `contracts/contracts/anonvote/Cargo.toml` - Already has version (may need to expose via macro)

## Integration Points

- `contracts/service/sorobanService.ts` - Add method to query version
- `core/backend/` - Add version check on startup

## Verification

After implementation:

```bash
soroban contract invoke \
  --id CA7QYNF63GQ2TLRJJQ4P6OQQC7TSCIB3UOHPHVQ4J6VGXM5LTBQQCTZ \
  --network testnet \
  -- get_version
# Should output: "0.1.0"
```

## Note for Contributors

This is a Soroban contract enhancement requiring semantic versioning implementation. Add a `get_version()` view function to the contract that returns the semantic version as a string (currently "0.1.0"). Optionally create extended version info with build date and network. This is straightforward Rust contract code — the version can be read from Cargo.toml and exposed via a contract function. Add corresponding TypeScript bindings in sorobanService.ts. Create tests to verify the version is queryable and correctly formatted. This should take 45-60 minutes including Rust implementation, TypeScript bindings, and testing.
