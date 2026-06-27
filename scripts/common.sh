#!/usr/bin/env bash
# =====================================================================
#  Shared helpers for the VibePlugin build/publish scripts. Sourced, not run.
# =====================================================================
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WASMTIME_DIR="${WASMTIME_DIR:-$HOME/wasmtime-c-api}"
VST3_INSTALL_DIR="$HOME/Library/Audio/Plug-Ins/VST3"
PRODUCTS=("VibePlugin FX" "VibePlugin Synth")

# Build the bundled AssemblyScript compiler once (downloads a portable runtime).
ensure_compiler() {
  if [ -f "$REPO/compiler/vstai-asc" ] || [ -f "$REPO/compiler/asc-bundle.mjs" ]; then
    return
  fi
  echo "▶ bundled compiler not built — running compiler/build.sh (one-time)…"
  ( cd "$REPO/compiler" && ./build.sh )
}

# Ensure the wasmtime c-api is present; download the right one for this host.
ensure_wasmtime() {
  if [ -f "$WASMTIME_DIR/include/wasmtime.h" ]; then
    return
  fi
  echo "▶ wasmtime c-api not found at $WASMTIME_DIR — downloading…"
  local arch os ext tag asset
  case "$(uname -m)" in arm64|aarch64) arch=aarch64;; x86_64|amd64) arch=x86_64;;
    *) echo "unknown arch $(uname -m)"; exit 1;; esac
  case "$(uname -s)" in
    Darwin) os=macos; ext=tar.xz;;
    Linux)  os=linux; ext=tar.xz;;
    *) echo "unsupported OS for auto-download: $(uname -s)"; exit 1;;
  esac
  tag=$(curl -fsSL https://api.github.com/repos/bytecodealliance/wasmtime/releases/latest \
        | grep -m1 '"tag_name"' | cut -d'"' -f4)
  asset="wasmtime-${tag}-${arch}-${os}-c-api.${ext}"
  curl -fSL "https://github.com/bytecodealliance/wasmtime/releases/download/${tag}/${asset}" \
       -o "/tmp/${asset}"
  rm -rf "$WASMTIME_DIR"; mkdir -p "$WASMTIME_DIR"
  tar -xf "/tmp/${asset}" -C "$WASMTIME_DIR" --strip-components=1
  echo "  wasmtime ${tag} -> $WASMTIME_DIR"
}

# Configure + build.   $1=build dir   $2=build type   $3..=extra cmake args
configure_and_build() {
  local dir="$1" type="$2"; shift 2
  cmake -B "$REPO/$dir" \
    -DCMAKE_BUILD_TYPE="$type" \
    -DWASMTIME_DIR="$WASMTIME_DIR" \
    -DWASMTIME_LIB="$WASMTIME_DIR/lib/libwasmtime.a" \
    "$@"
  cmake --build "$REPO/$dir" --config "$type" -j
}

# (Re)sign the installed VST3 bundles. Identity from $VSTAI_SIGN_ID, else a
# "Developer ID Application" cert if the keychain has one (preferred — it's the
# distribution cert), else the first codesigning identity, else ad-hoc (local
# only). The DSP (wasmtime) and the compiler (V8) both JIT, so we sign WITHOUT
# hardened runtime — hardened runtime blocks JIT unless you add entitlements
# (needed only for notarized distribution; see notarize step, not wired up yet).
sign_installed() {
  local id="${VSTAI_SIGN_ID:-}"
  if [ -z "$id" ]; then
    # Prefer a Developer ID Application identity (distribution); fall back to the
    # first available identity (e.g. Apple Development, local use only).
    id=$(security find-identity -v -p codesigning 2>/dev/null \
           | awk -F'"' '/Developer ID Application/{print $2; exit}')
    [ -z "$id" ] && id=$(security find-identity -v -p codesigning 2>/dev/null | awk -F'"' 'NF>1{print $2; exit}')
  fi
  if [ -z "$id" ]; then
    echo "⚠ no signing identity in keychain — ad-hoc signing (loads on this Mac only)"
    id="-"
  else
    echo "▶ signing as: $id"
  fi
  local b
  for p in "${PRODUCTS[@]}"; do
    b="$VST3_INSTALL_DIR/$p.vst3"
    [ -d "$b" ] || { echo "  (skip: $p not installed)"; continue; }
    # nested helper executable first, then the bundle (inside-out)
    if [ -f "$b/Contents/Resources/vstai-node" ]; then
      codesign --force --timestamp=none -s "$id" "$b/Contents/Resources/vstai-node" >/dev/null 2>&1
    fi
    codesign --force --timestamp=none -s "$id" "$b" >/dev/null 2>&1
    if codesign --verify --deep --strict "$b" >/dev/null 2>&1; then
      echo "  ✓ $p  signed & valid"
    else
      echo "  ✗ $p  signature verify FAILED:"; codesign --verify --deep --strict "$b" || true
    fi
  done
}
