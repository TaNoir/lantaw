#!/usr/bin/env bash
# Vercel build: install Rust + wasm-pack, build the engine to WASM, build the web app.
# vercel.json runs this from the repo root; the output is web/dist.
#
# LANTAW_SKIP_TOOLCHAIN=1 skips every toolchain install step and only checks
# that cargo and wasm-pack are already on PATH (for running it locally).
set -euo pipefail

cd "$(dirname "$0")"

# A previous rustup install (or Vercel's build cache) may have left cargo here.
if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck source=/dev/null
  . "$HOME/.cargo/env"
fi

if [ "${LANTAW_SKIP_TOOLCHAIN:-0}" = "1" ]; then
  echo "==> LANTAW_SKIP_TOOLCHAIN=1: using the toolchain already installed"
  command -v cargo >/dev/null || { echo "cargo not found on PATH" >&2; exit 1; }
  command -v wasm-pack >/dev/null || { echo "wasm-pack not found on PATH" >&2; exit 1; }
else
  if ! command -v cargo >/dev/null; then
    echo "==> Installing Rust (minimal profile)"
    curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal
    # shellcheck source=/dev/null
    . "$HOME/.cargo/env"
  fi

  echo "==> Adding the wasm32-unknown-unknown target"
  rustup target add wasm32-unknown-unknown

  if ! command -v wasm-pack >/dev/null; then
    echo "==> Installing wasm-pack (prebuilt)"
    if ! curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh; then
      echo "==> Prebuilt installer failed; building wasm-pack from source"
      cargo install wasm-pack --locked
    fi
    # The installer can exit 0 without leaving wasm-pack on PATH: build it then.
    command -v wasm-pack >/dev/null || cargo install wasm-pack --locked
  fi
fi

echo "==> Versions"
rustc --version
cargo --version
wasm-pack --version
node --version
npm --version

echo "==> Building engine (WASM) and web app"
cd web
# Vercel sets NODE_ENV=production, which would skip the devDependencies the
# build needs (vite, svelte, the PWA plugin).
npm ci --include=dev
npm run build

echo "==> Done: web/dist"
