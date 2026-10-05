#!/bin/sh
# Run the whole Doob suite: build, compile, DSP tests, GUI tests.  tests/all.sh [wasm]   (default /tmp/doob.wasm)
set -e
cd "$(dirname "$0")/../../.."
W="${1:-/tmp/doob.wasm}"
factory/doob/tools/make.sh "$W"
for t in voice behavior midi reactive packing rates quality fuzz; do DOOB_WASM="$W" node factory/doob/tests/$t.mjs "$W" | tail -1; done
node factory/doob/build.mjs >/dev/null
node factory/doob/tests/gui-roundtrip.mjs
node factory/doob/tests/gui-interact.mjs | tail -1
node factory/tools/persist-check.mjs factory/plugins/doob | tail -1
