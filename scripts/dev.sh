#!/usr/bin/env bash
# =====================================================================
#  Development build: Debug + file logging of the generate/compile
#  pipeline (src/DevLog.h), published to the local VST3 folder and signed
#  so it loads in a DAW.
#
#    scripts/dev.sh           build (dev) + install + sign
#    scripts/dev.sh --tail    just follow the dev log
#
#  Logs:  ~/Library/Logs/VibePlugin/<plugin>.log
#  Uses a separate build dir (build-dev) so it doesn't fight the release build.
# =====================================================================
source "$(dirname "$0")/common.sh"

LOGDIR="$HOME/Library/Logs/VibePlugin"

if [ "${1:-}" = "--tail" ]; then
  mkdir -p "$LOGDIR"; touch "$LOGDIR/VibePlugin FX.log" "$LOGDIR/VibePlugin Synth.log"
  echo "tailing $LOGDIR/*.log  (Ctrl-C to stop)…"
  exec tail -F "$LOGDIR/"*.log
fi

ensure_compiler
ensure_wasmtime
echo "▶ building Debug + VSTAI_DEV_MODE…"
configure_and_build build-dev Debug -DVSTAI_DEV_MODE=ON
sign_installed
echo
echo "✅ Dev build installed & signed (this replaces the release build in the VST3 folder)."
echo "   Logs:  $LOGDIR/<plugin>.log      follow with:  scripts/dev.sh --tail"
echo "   Rescan plugins in FL Studio to pick up the dev build."
