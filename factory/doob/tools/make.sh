#!/bin/sh
# build the plugin sources and compile to a wasm:  tools/make.sh [out.wasm]   (default /tmp/doob.wasm)
set -e
cd "$(dirname "$0")/../../.."
node factory/doob/build.mjs --no-gui >/dev/null
node compiler/asc-driver.mjs factory/plugins/doob/assembly.ts "${1:-/tmp/doob.wasm}"
