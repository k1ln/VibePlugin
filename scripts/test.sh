#!/usr/bin/env bash
# =====================================================================
#  Headless test of the knob/note path — no DAW needed.
#
#    scripts/test.sh                 reference regression tests (effect + synth)
#    scripts/test.sh plugin.vstai    sweep every param of a saved plugin and
#                                    report which knobs actually change the audio
#
#  Builds in a separate dir (build-test) so it never disturbs build/ or the
#  installed plugins.
# =====================================================================
source "$(dirname "$0")/common.sh"

ensure_compiler
ensure_wasmtime

# The bundled compiler: single-file vstai-asc, or vstai-node + asc-bundle.mjs.
if [ -x "$REPO/compiler/vstai-asc" ]; then
  ASC=("$REPO/compiler/vstai-asc")
else
  ASC=("$REPO/compiler/vstai-node" "$REPO/compiler/asc-bundle.mjs")
fi

echo "▶ compiling reference DSP modules…"
"${ASC[@]}" "$REPO/wasm-template/assembly/index.ts" /tmp/vstai-effect.wasm
"${ASC[@]}" "$REPO/wasm-template/assembly/synth.ts"  /tmp/vstai-synth.wasm

echo "▶ building the test…"
cmake -B "$REPO/build-test" \
  -DCMAKE_BUILD_TYPE=Release \
  -DWASMTIME_DIR="$WASMTIME_DIR" \
  -DWASMTIME_LIB="$WASMTIME_DIR/lib/libwasmtime.a" \
  -DVSTAI_BUILD_TESTS=ON >/dev/null
cmake --build "$REPO/build-test" --target vstai_tests -j >/dev/null

BIN="$(find "$REPO/build-test" -name vstai_tests -type f -perm +111 | head -1)"
[ -n "$BIN" ] || { echo "could not find the built vstai_tests binary"; exit 1; }

echo
if [ $# -ge 1 ]; then
  "$BIN" "$1"                                   # sweep a saved plugin
else
  "$BIN" /tmp/vstai-effect.wasm /tmp/vstai-synth.wasm   # reference tests
fi
