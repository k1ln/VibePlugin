#!/bin/sh
# build the plugin sources and compile to a wasm:  tools/make.sh [out.wasm]   (default /tmp/kg.wasm)
set -e
cd "$(dirname "$0")/../../.."
node factory/kgrbdpa/build.mjs --no-gui >/dev/null
node compiler/asc-driver.mjs factory/plugins/kgrbdpa/assembly.ts "${1:-/tmp/kg.wasm}"
