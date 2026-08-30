#!/usr/bin/env bash
# =====================================================================
#  Build, Developer ID sign, notarize, staple and package the macOS VST3
#  bundles for a GitHub Release.
#
#  Why this exists: .github/workflows/release.yml ad-hoc signs macOS, and
#  its upload step overwrites a manually-uploaded notarized zip of the same
#  name. So the macOS asset is produced HERE and the CI run for the tag is
#  cancelled (see RELEASING below). Ad-hoc signed builds hit the Gatekeeper
#  "cannot be checked" wall on every download, which is the whole point of
#  doing this locally.
#
#  Each .vst3 carries TWO Mach-Os that both JIT and so both need hardened
#  runtime + JIT entitlements:
#    Contents/MacOS/<name>        the plugin (wasmtime)
#    Contents/Resources/vstai-node  the bundled compiler (~119 MB V8)
#  vstai-node additionally runs code it writes at runtime and dlopens, so it
#  gets the page-protection and library-validation exceptions too.
#
#  Signing is inside-out: nested executables first, bundle last. Signing the
#  bundle first would be invalidated by every later inner signature.
#
#  RELEASING:
#    ./scripts/release-macos.sh            # build + sign + notarize + package
#    git tag vX.Y.Z && git push origin vX.Y.Z
#    gh run cancel <id>                    # stop CI clobbering the macOS zip
#    gh release create vX.Y.Z dist/release/*.zip --title ... --notes ...
#
#  Requires: Developer ID Application cert in the keychain, and a notarytool
#  keychain profile (default "vibeplugin"; see `xcrun notarytool store-credentials`).
# =====================================================================
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

IDENTITY="${VSTAI_SIGN_ID:-Developer ID Application: Kilian Hertel (8P7SXGP62N)}"
PROFILE="${VSTAI_NOTARY_PROFILE:-vibeplugin}"
BUILD_DIR="${VSTAI_BUILD_DIR:-build}"
WASMTIME_DIR="${WASMTIME_DIR:-$HOME/wasmtime-c-api}"

VERSION="$(sed -n 's/^project(VibePlugin VERSION \([0-9.]*\).*/\1/p' CMakeLists.txt)"
[ -n "$VERSION" ] || { echo "!! could not read the version out of CMakeLists.txt" >&2; exit 1; }
TAG="v$VERSION"
OUT="$REPO/dist/release"
STAGE="$REPO/dist/stage"

echo "==> VibePlugin $TAG  (identity: $IDENTITY, notary profile: $PROFILE)"

# ---- 1. build ---------------------------------------------------------
cmake -B "$BUILD_DIR" -DWASMTIME_DIR="$WASMTIME_DIR" >/dev/null
cmake --build "$BUILD_DIR" --target VibePlugin_FX_VST3 VibePlugin_Synth_VST3

BUNDLES=(
  "$BUILD_DIR/VibePlugin_FX_artefacts/Release/VST3/VibePlugin FX.vst3"
  "$BUILD_DIR/VibePlugin_Synth_artefacts/Release/VST3/VibePlugin Synth.vst3"
)

# ---- 2. entitlements --------------------------------------------------
ENT_DIR="$(mktemp -d)"
trap 'rm -rf "$ENT_DIR"' EXIT

cat > "$ENT_DIR/jit.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
</dict></plist>
PLIST

cat > "$ENT_DIR/node.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.cs.disable-executable-page-protection</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
</dict></plist>
PLIST

sign() {  # sign <entitlements> <path>
  codesign --force --sign "$IDENTITY" --options runtime --timestamp \
           --entitlements "$1" "$2"
}

# ---- 3. sign inside-out, then notarize --------------------------------
rm -rf "$OUT" "$STAGE"
mkdir -p "$OUT" "$STAGE"

for B in "${BUNDLES[@]}"; do
  NAME="$(basename "$B")"
  echo "==> signing $NAME"
  # Deepest first. Anything else and the outer signature is invalidated.
  sign "$ENT_DIR/node.plist" "$B/Contents/Resources/vstai-node"
  sign "$ENT_DIR/jit.plist"  "$B/Contents/MacOS/${NAME%.vst3}"
  sign "$ENT_DIR/jit.plist"  "$B"
  codesign --verify --deep --strict --verbose=1 "$B"

  echo "==> notarizing $NAME  (the ~119 MB vstai-node makes this the slow step)"
  ZIP="$STAGE/${NAME%.vst3}.zip"
  ditto -c -k --sequesterRsrc --keepParent "$B" "$ZIP"
  xcrun notarytool submit "$ZIP" --keychain-profile "$PROFILE" --wait
  xcrun stapler staple "$B"
  xcrun stapler validate "$B"

  cp -R "$B" "$STAGE/$NAME"
done

# ---- 4. package -------------------------------------------------------
# Both bundles at the archive root, so unzipping gives you two .vst3s to drop
# straight into the VST3 folder (that is what docs/releases.html tells people).
rm -f "$STAGE"/*.zip
ASSET="$OUT/VibePlugin-$TAG-macos.zip"
( cd "$STAGE" && ditto -c -k --sequesterRsrc . "$ASSET" )
rm -rf "$STAGE"

echo
echo "==> $ASSET"
ls -lh "$ASSET" | awk '{print "    " $5}'
echo "    next: git tag $TAG && git push origin $TAG, cancel the CI run, then gh release create"
