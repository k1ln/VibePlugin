#!/usr/bin/env bash
# =====================================================================
#  Builds the bundled AssemblyScript compiler that ships INSIDE the plugin
#  so end users install nothing. It downloads a PORTABLE JS runtime for the
#  system you run this on (official Node single-binary, which has the
#  WebAssembly engine asc's Binaryen backend needs), and bundles asc into
#  one ESM file. Output:
#     vstai-node[.exe]   portable Node runtime (downloaded)
#     asc-bundle.mjs     asc + driver bundled into one ESM file
#  The plugin execs:  vstai-node asc-bundle.mjs <in.ts> <out.wasm>
#
#  Needs Node 18+ on PATH to BUILD (to run esbuild). The SHIPPED runtime is
#  the downloaded one, not your local node.  Single-file alternative: install
#  deno or bun and this produces one `vstai-asc` via `--compile` instead.
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")"

NODE_VERSION="${NODE_VERSION:-v22.11.0}"   # override with NODE_VERSION=vXX.Y.Z

command -v node >/dev/null || { echo "need Node 18+ to build (not to run the plugin)"; exit 1; }

echo "[1/3] installing build deps (assemblyscript, esbuild)…"
npm install --no-save assemblyscript@^0.27.30 esbuild@^0.23 >/dev/null

echo "[2/3] bundling asc + driver into one ESM file…"
./node_modules/.bin/esbuild asc-driver.mjs \
  --bundle --platform=node --format=esm --target=node18 \
  --outfile=asc-bundle.mjs

# Prefer a true single-file build if deno/bun are available.
if command -v deno >/dev/null 2>&1; then
  echo "[3/3] deno detected -> single-file vstai-asc…"
  deno compile --allow-read --allow-write -o vstai-asc asc-driver.mjs
  rm -f asc-bundle.mjs
  echo "built ./vstai-asc  ($(du -h vstai-asc | cut -f1))"; exit 0
elif command -v bun >/dev/null 2>&1; then
  echo "[3/3] bun detected -> single-file vstai-asc…"
  bun build --compile asc-driver.mjs --outfile vstai-asc
  rm -f asc-bundle.mjs
  echo "built ./vstai-asc  ($(du -h vstai-asc | cut -f1))"; exit 0
fi

echo "[3/3] downloading a portable Node runtime ($NODE_VERSION) for this system…"
case "$(uname -s)" in
  Darwin) PLAT=darwin; EXT=tar.gz ;;
  Linux)  PLAT=linux;  EXT=tar.xz ;;
  MINGW*|MSYS*|CYGWIN*) PLAT=win; EXT=zip ;;
  *) echo "unknown OS $(uname -s); set NODE_VERSION and download a runtime manually"; exit 1 ;;
esac
case "$(uname -m)" in
  arm64|aarch64) ARCH=arm64 ;;
  x86_64|amd64)  ARCH=x64 ;;
  *) echo "unknown arch $(uname -m)"; exit 1 ;;
esac

DL="node-${NODE_VERSION}-${PLAT}-${ARCH}"
URL="https://nodejs.org/dist/${NODE_VERSION}/${DL}.${EXT}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "    $URL"
curl -fSL "$URL" -o "$TMP/node.${EXT}"

if [ "$PLAT" = "win" ]; then
  ( cd "$TMP" && unzip -q "node.${EXT}" )
  cp "$TMP/${DL}/node.exe" vstai-node.exe
  echo "built ./vstai-node.exe + ./asc-bundle.mjs"
else
  tar -xf "$TMP/node.${EXT}" -C "$TMP"
  cp "$TMP/${DL}/bin/node" vstai-node
  chmod +x vstai-node
  echo "built ./vstai-node + ./asc-bundle.mjs  (total $(du -ch vstai-node asc-bundle.mjs | tail -1 | cut -f1))"
fi
echo "These ship inside the plugin (CMake copies them next to each plugin binary)."
