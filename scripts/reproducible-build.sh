#!/usr/bin/env bash
# Reproducible build script for AnonVote Soroban contract
# Verifies deterministic WASM compilation

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "🔄 AnonVote Reproducible Build Verification"
echo "============================================="
echo ""

# Check environment
echo "📋 Build Environment:"
echo "  Rust: $(rustc --version)"
echo "  Cargo: $(cargo --version)"
echo "  Project: $PROJECT_ROOT"
echo ""

cd "$PROJECT_ROOT"

# Verify lock files
echo "🔒 Checking lock files..."
if [[ ! -f "Cargo.lock" ]]; then
  echo "❌ ERROR: Cargo.lock not found"
  exit 1
fi
echo "  ✅ Cargo.lock present"

# Build 1
echo ""
echo "🔨 Build 1: Clean build from locked deps..."
cargo clean
cargo build --target wasm32v1-none --release --locked

WASM1="target/wasm32v1-none/release/anonvote.wasm"
if [[ ! -f "$WASM1" ]]; then
  echo "❌ ERROR: WASM artifact not found after build 1"
  exit 1
fi

HASH1=$(sha256sum "$WASM1" | awk '{print $1}')
SIZE1=$(stat -c%s "$WASM1" 2>/dev/null || stat -f%z "$WASM1")
echo "  ✅ Build 1 complete"
echo "     Hash: $HASH1"
echo "     Size: $SIZE1 bytes"

# Build 2
echo ""
echo "🔨 Build 2: Clean rebuild from locked deps..."
cargo clean
cargo build --target wasm32v1-none --release --locked

WASM2="target/wasm32v1-none/release/anonvote.wasm"
HASH2=$(sha256sum "$WASM2" | awk '{print $1}')
SIZE2=$(stat -c%s "$WASM2" 2>/dev/null || stat -f%z "$WASM2")
echo "  ✅ Build 2 complete"
echo "     Hash: $HASH2"
echo "     Size: $SIZE2 bytes"

# Verify reproducibility
echo ""
echo "✅ Reproducibility Verification:"
if [[ "$HASH1" == "$HASH2" ]]; then
  echo "   ✅ Hashes match — deterministic build verified"
else
  echo "   ❌ Hashes differ — build is non-deterministic"
  echo "      Build 1: $HASH1"
  echo "      Build 2: $HASH2"
  exit 1
fi

if [[ "$SIZE1" == "$SIZE2" ]]; then
  echo "   ✅ Sizes match — consistent artifact size"
else
  echo "   ❌ Sizes differ"
  exit 1
fi

echo ""
echo "✅ Reproducible build verified successfully"
echo "   WASM: $WASM1"
echo "   Hash: $HASH1"
echo "   Size: $SIZE1 bytes"
