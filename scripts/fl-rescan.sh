#!/usr/bin/env bash
# =====================================================================
#  Make FL Studio re-verify the VibePlugin plugins after a rebuild.
#  FL caches a plugin's scan result and won't re-check it on its own, so a
#  rebuilt (or previously-broken) plugin keeps using the stale entry. This
#  quits FL, removes only the VibePlugin cache entries, and reopens FL — then
#  do Options > Manage plugins > Find installed plugins (Verify on).
#
#  Safe: it never force-kills FL (no risk to unsaved work). If FL won't quit
#  gracefully, it stops and asks you to quit it yourself.
# =====================================================================
set -euo pipefail

DB="$HOME/Documents/Image-Line/FL Studio/Presets/Plugin database/Installed"
APP="$(ls -d /Applications/FL\ Studio*.app 2>/dev/null | head -1 || true)"
APPNAME="$(basename "${APP:-FL Studio}" .app)"

if pgrep -f "$APPNAME" >/dev/null 2>&1; then
  echo "▶ asking $APPNAME to quit (answer any save prompt)…"
  osascript -e "tell application \"$APPNAME\" to quit" >/dev/null 2>&1 || true
  for _ in $(seq 1 30); do
    pgrep -f "$APPNAME" >/dev/null 2>&1 || break
    sleep 0.5
  done
  if pgrep -f "$APPNAME" >/dev/null 2>&1; then
    echo "✗ $APPNAME is still running. Quit it, then re-run this script."
    exit 1
  fi
fi

echo "▶ clearing VibePlugin cache entries…"
removed=0
for f in "$DB/Effects/VST3/VibePlugin FX.fst"        "$DB/Effects/VST3/VibePlugin FX.nfo" \
         "$DB/Generators/VST3/VibePlugin Synth.fst"  "$DB/Generators/VST3/VibePlugin Synth.nfo"; do
  if [ -f "$f" ]; then rm -f "$f"; echo "  removed $(basename "$f")"; removed=$((removed + 1)); fi
done
[ "$removed" -eq 0 ] && echo "  (none cached — a fresh scan will create them)"

if [ -n "${APP:-}" ]; then
  echo "▶ reopening ${APPNAME}…"
  open "$APP"
else
  echo "  (FL Studio app not found in /Applications — open it yourself)"
fi

echo
echo "Now in FL: Options ▸ Manage plugins ▸ enable Verify plugins ▸ Find installed plugins."
