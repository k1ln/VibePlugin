#!/usr/bin/env bash
# =====================================================================
#  One-shot: build + install + make the DAW pick it up.
#
#    scripts/build-install.sh              Release build, install, sign, FL rescan
#    scripts/build-install.sh --dev        Debug build with dev logging instead
#    scripts/build-install.sh --no-rescan  build + install + sign only
#
#  This just chains the existing scripts:
#    scripts/build.sh   (or scripts/dev.sh with --dev)  → build + install + sign
#    scripts/fl-rescan.sh                               → quit FL, drop stale
#                                                         cache entries, reopen
#
#  Env overrides pass straight through (WASMTIME_DIR, VSTAI_SIGN_ID, …).
# =====================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

build_script="build.sh"
rescan=1

for arg in "$@"; do
  case "$arg" in
    --dev)       build_script="dev.sh" ;;
    --no-rescan) rescan=0 ;;
    -h|--help)   sed -n '3,14p' "${BASH_SOURCE[0]}" | sed 's/^#\{0,1\} \{0,1\}//'; exit 0 ;;
    *)           echo "unknown option: $arg (see --help)" >&2; exit 2 ;;
  esac
done

"$HERE/$build_script"

if [ "$rescan" -eq 1 ]; then
  echo
  if [ "$(uname -s)" = "Darwin" ]; then
    "$HERE/fl-rescan.sh"
  else
    echo "ℹ FL rescan step is macOS-only — rescan plugins in your DAW manually."
  fi
fi
