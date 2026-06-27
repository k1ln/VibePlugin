#!/usr/bin/env bash
# =====================================================================
#  Build the RELEASE plugins and publish them to the local VST3 folder,
#  signed so they load in a DAW (FL Studio, etc.).
#
#    scripts/build.sh
#
#  Installs:  ~/Library/Audio/Plug-Ins/VST3/VibePlugin FX.vst3
#             ~/Library/Audio/Plug-Ins/VST3/VibePlugin Synth.vst3
#  Overrides: WASMTIME_DIR=<dir>   VSTAI_SIGN_ID="Developer ID Application: …"
# =====================================================================
source "$(dirname "$0")/common.sh"

ensure_compiler
ensure_wasmtime
echo "▶ building Release…"
configure_and_build build Release
sign_installed
echo
echo "✅ Done — installed & signed in: $VST3_INSTALL_DIR"
echo "   In FL Studio: Options ▸ Manage plugins ▸ Find plugins (rescan)."
