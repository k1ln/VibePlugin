#!/bin/sh
# Run the whole KGrbdPa suite: build, compile, DSP tests, GUI tests.  tests/all.sh [wasm]   (default /tmp/kg.wasm)
set -e
cd "$(dirname "$0")/../../.."
W="${1:-/tmp/kg.wasm}"
factory/kgrbdpa/tools/make.sh "$W"
for t in voice behavior patchbay midi reactive packing rates quality fuzz; do KG_WASM="$W" node factory/kgrbdpa/tests/$t.mjs "$W" | tail -1; done
node factory/kgrbdpa/build.mjs >/dev/null
node factory/kgrbdpa/tests/gui-roundtrip.mjs
node factory/kgrbdpa/tests/gui-interact.mjs | tail -1
node factory/tools/persist-check.mjs factory/plugins/kgrbdpa | tail -1
