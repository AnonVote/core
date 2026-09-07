#!/usr/bin/env bash
set -euo pipefail

# AnonVote Soroban deployment script.
#
# Usage:
#   STELLAR_ACCOUNT=<stellar-cli-identity-name> ./deploy.sh testnet
#   # or, with a raw secret key:
#   STELLAR_SECRET_KEY=S... ./deploy.sh testnet
#
# Optional:
#   STELLAR_ADMIN_ADDRESS=G...   Admin passed to initialize(). If unset, it is
#                                derived from STELLAR_ACCOUNT (a named identity);
#                                if it cannot be derived, initialization is
#                                skipped and the manual command is printed.
#   SOROBAN_RPC_URL=...          Recorded in deployments.json (defaults per network).

NETWORK="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACT_DIR="$SCRIPT_DIR/contracts/anonvote"
WASM_PATH="$CONTRACT_DIR/target/wasm32v1-none/release/anonvote.wasm"
DEPLOYMENTS_FILE="$SCRIPT_DIR/deployments.json"
CONTRACT_NAME="anonvote"
RUST_TOOLCHAIN="1.85"   # Soroban SDK 27.0.6 requires 1.85+ for Edition 2024 support (zeroize v1.9.0)

usage() {
  echo "Usage: $0 <testnet|mainnet>"
  echo ""
  echo "Environment variables:"
  echo "  STELLAR_ACCOUNT        Named stellar-cli identity to sign with (preferred)"
  echo "  STELLAR_SECRET_KEY     Raw secret key to sign with (alternative)"
  echo "  STELLAR_ADMIN_ADDRESS  G-address passed to initialize() (optional)"
  echo "  SOROBAN_RPC_URL        RPC endpoint recorded in deployments.json (optional)"
  exit 1
}

if [[ -z "$NETWORK" ]]; then usage; fi
if [[ "$NETWORK" != "testnet" && "$NETWORK" != "mainnet" ]]; then
  echo "Error: network must be 'testnet' or 'mainnet'"
  usage
fi

# ---------- prerequisite checks ----------
for cmd in cargo stellar jq git rustup; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "Error: $cmd is not installed."
    exit 1
  fi
done

# Signing source: prefer a named identity, fall back to a raw secret key.
SOURCE="${STELLAR_ACCOUNT:-${STELLAR_SECRET_KEY:-}}"
if [[ -z "$SOURCE" ]]; then
  echo "Error: set STELLAR_ACCOUNT (identity name) or STELLAR_SECRET_KEY."
  exit 1
fi

if ! rustup toolchain list | grep -q "^${RUST_TOOLCHAIN}"; then
  echo "Error: rustc ${RUST_TOOLCHAIN} is required to build a Soroban-compatible WASM."
  echo "       Install it with:"
  echo "         rustup toolchain install ${RUST_TOOLCHAIN}"
  echo "         rustup target add wasm32v1-none --toolchain ${RUST_TOOLCHAIN}"
  exit 1
fi

# ---------- network config (recorded in deployments.json) ----------
case "$NETWORK" in
  testnet) SOROBAN_RPC_URL="${SOROBAN_RPC_URL:-https://soroban-testnet.stellar.org}" ;;
  mainnet) SOROBAN_RPC_URL="${SOROBAN_RPC_URL:-https://soroban-mainnet.stellar.org}" ;;
esac

echo "=== AnonVote Contract Deployment ==="
echo "Network:     $NETWORK"
echo "RPC URL:     $SOROBAN_RPC_URL"
echo "Toolchain:   rustc $RUST_TOOLCHAIN"
echo "WASM:        $WASM_PATH"
echo "Deployments: $DEPLOYMENTS_FILE"
echo ""

# ---------- 1. Build (rustc 1.84+ with wasm32v1-none for Soroban SDK 27.0.6 compatibility) ----------
echo ">>> Building contract with rustc ${RUST_TOOLCHAIN}..."
rustup run "$RUST_TOOLCHAIN" cargo build \
  --manifest-path "$CONTRACT_DIR/Cargo.toml" \
  --target wasm32v1-none --release --locked

if [[ ! -f "$WASM_PATH" ]]; then
  echo "Error: WASM not found at $WASM_PATH"
  exit 1
fi
echo "    Build complete."
echo ""

# ---------- 2. Compute hashes ----------
WASM_HASH=$(sha256sum "$WASM_PATH" | awk '{print $1}')
GIT_COMMIT=$(git -C "$SCRIPT_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown")
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "    WASM SHA-256: $WASM_HASH"
echo "    Git commit:   $GIT_COMMIT"
echo ""

# Helper: pull the 64-hex transaction hash out of stellar-cli stderr.
extract_tx() { grep -oE '/tx/[a-f0-9]{64}' "$1" | head -1 | cut -d/ -f3; }

# ---------- 3. Upload WASM ----------
echo ">>> Uploading WASM to $NETWORK..."
UPLOAD_ERR=$(mktemp)
UPLOADED_HASH=$(stellar contract upload \
  --wasm "$WASM_PATH" \
  --source-account "$SOURCE" \
  --network "$NETWORK" 2>"$UPLOAD_ERR")
UPLOAD_TX=$(extract_tx "$UPLOAD_ERR")
cat "$UPLOAD_ERR"; rm -f "$UPLOAD_ERR"
echo "    Uploaded WASM hash: $UPLOADED_HASH (upload tx: ${UPLOAD_TX:-n/a})"
echo ""

# ---------- 4. Deploy instance ----------
echo ">>> Deploying $CONTRACT_NAME instance..."
DEPLOY_ERR=$(mktemp)
CONTRACT_ID=$(stellar contract deploy \
  --wasm-hash "$UPLOADED_HASH" \
  --source-account "$SOURCE" \
  --network "$NETWORK" 2>"$DEPLOY_ERR")
DEPLOY_TX=$(extract_tx "$DEPLOY_ERR")
cat "$DEPLOY_ERR"; rm -f "$DEPLOY_ERR"

if [[ -z "$CONTRACT_ID" || ! "$CONTRACT_ID" =~ ^C[A-Z0-9]{55}$ ]]; then
  echo "Error: failed to obtain a valid contract ID (got: '$CONTRACT_ID')."
  exit 1
fi
echo "    Contract ID: $CONTRACT_ID (deploy tx: ${DEPLOY_TX:-n/a})"
echo ""

# ---------- 5. Initialize contract ----------
echo ">>> Initializing contract..."
ADMIN_ADDRESS="${STELLAR_ADMIN_ADDRESS:-}"
if [[ -z "$ADMIN_ADDRESS" && -n "${STELLAR_ACCOUNT:-}" ]]; then
  ADMIN_ADDRESS=$(stellar keys public-key "$STELLAR_ACCOUNT" 2>/dev/null || true)
fi
if [[ -z "$ADMIN_ADDRESS" ]]; then
  echo "    Warning: no admin address (set STELLAR_ADMIN_ADDRESS). Skipping initialization."
  echo "    Run manually:"
  echo "      stellar contract invoke --id $CONTRACT_ID --source-account <SOURCE> \\"
  echo "        --network $NETWORK -- initialize --admin <G-ADDRESS>"
else
  stellar contract invoke \
    --id "$CONTRACT_ID" \
    --source-account "$SOURCE" \
    --network "$NETWORK" \
    -- initialize \
    --admin "$ADMIN_ADDRESS"
  echo "    Initialized with admin: $ADMIN_ADDRESS"
fi
echo ""

# ---------- 6. Record deployment ----------
echo ">>> Recording deployment to $DEPLOYMENTS_FILE..."
if [[ ! -f "$DEPLOYMENTS_FILE" ]]; then echo '{}' > "$DEPLOYMENTS_FILE"; fi
TEMP_FILE=$(mktemp)
jq --arg net "$NETWORK" \
   --arg cid "$CONTRACT_ID" \
   --arg tx "${DEPLOY_TX:-}" \
   --arg wasm "$WASM_HASH" \
   --arg commit "$GIT_COMMIT" \
   --arg ts "$TIMESTAMP" \
   --arg rpc "$SOROBAN_RPC_URL" \
   '.[$net] = {
      "contract_id": $cid,
      "transaction_id": (if $tx == "" then null else $tx end),
      "timestamp": $ts,
      "wasm_hash": $wasm,
      "git_commit": $commit,
      "rpc_url": $rpc
    }' "$DEPLOYMENTS_FILE" > "$TEMP_FILE"
mv "$TEMP_FILE" "$DEPLOYMENTS_FILE"
echo "    Saved."
echo ""

# ---------- 7. Update CONTRACT_ID file ----------
CONTRACT_ID_FILE="$SCRIPT_DIR/CONTRACT_ID"
echo ">>> Updating CONTRACT_ID file..."
if [[ -f "$CONTRACT_ID_FILE" ]]; then
  TEMP_ID_FILE=$(mktemp)
  sed "s|^${NETWORK}:.*|${NETWORK}: ${CONTRACT_ID}|" "$CONTRACT_ID_FILE" > "$TEMP_ID_FILE"
  mv "$TEMP_ID_FILE" "$CONTRACT_ID_FILE"
  echo "    Updated ${NETWORK} entry in CONTRACT_ID."
else
  echo "    Warning: CONTRACT_ID file not found at $CONTRACT_ID_FILE — skipping."
fi
echo ""

# ---------- 8. Git tag ----------
TAG="contract-${NETWORK}-v1.0.0"
echo ">>> Creating git tag: $TAG"
git -C "$SCRIPT_DIR" add "$DEPLOYMENTS_FILE" "$CONTRACT_ID_FILE"
if git -C "$SCRIPT_DIR" diff --cached --quiet; then
  echo "    No changes to commit."
else
  git -C "$SCRIPT_DIR" commit -m "deploy: $CONTRACT_NAME to $NETWORK ($CONTRACT_ID)"
fi
git -C "$SCRIPT_DIR" tag -f "$TAG" -m "Deploy $CONTRACT_NAME to $NETWORK: $CONTRACT_ID" 2>/dev/null || \
  git -C "$SCRIPT_DIR" tag -a "$TAG" -m "Deploy $CONTRACT_NAME to $NETWORK: $CONTRACT_ID"
echo ""

# ---------- 9. Summary ----------
echo "============================================"
echo "  Deployment complete!"
echo "  Network:      $NETWORK"
echo "  Contract ID:  $CONTRACT_ID"
echo "  WASM Hash:    $WASM_HASH"
echo "  Deploy Tx:    ${DEPLOY_TX:-n/a}"
echo "  Git Commit:   $GIT_COMMIT"
echo "  Git Tag:      $TAG"
echo "============================================"
echo ""
echo "Next steps:"
echo "  1. Verify on Stellar Explorer: https://stellar.expert/explorer/$NETWORK/contract/$CONTRACT_ID"
echo "  2. Set in contracts/.env:       SOROBAN_CONTRACT_ID=$CONTRACT_ID"
echo "  3. Set in backend/.env:         SOROBAN_CONTRACT_ID=$CONTRACT_ID"
echo "  4. Push tag:                    git push origin $TAG"
echo "  5. Push commit:                 git push origin HEAD"
