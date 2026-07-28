#!/usr/bin/env bash
# Build a standalone branded Anvil.app for macOS (Apple Silicon / Intel).
#
# Strategy (VSCodium-style overlay on Code-OSS):
#   1. Pin a VSCodium release (Open VSX already wired)
#   2. Overlay Anvil product.json branding
#   3. Rename bundle + Electron helper apps to Anvil*
#   4. Bundle packages/anvil-extension as a built-in extension
#   5. Emit dist/Anvil.app (ad-hoc signed, NOT notarized)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IDE_DIR="$ROOT/ide"
CACHE="$IDE_DIR/cache"
DIST="$ROOT/dist"
VERSION="${ANVIL_VSCODIUM_VERSION:-1.126.04524}"
ARCH="$(uname -m)"
case "$ARCH" in
  arm64) PLATFORM="darwin-arm64" ;;
  x86_64) PLATFORM="darwin-x64" ;;
  *) echo "Unsupported arch: $ARCH"; exit 1 ;;
esac

ZIP_NAME="VSCodium-${PLATFORM}-${VERSION}.zip"
ZIP_PATH="$CACHE/$ZIP_NAME"
URL="https://github.com/VSCodium/vscodium/releases/download/${VERSION}/${ZIP_NAME}"
STAGE="$CACHE/stage-$$"
APP_OUT="$DIST/Anvil.app"

echo "==> Anvil macOS package"
echo "    platform: $PLATFORM"
echo "    base:     VSCodium $VERSION (Code-OSS + Open VSX)"

mkdir -p "$CACHE" "$DIST"

echo "==> Building agent-core + Anvil extension"
(cd "$ROOT" && npm run build:ide-ext)

if [[ ! -f "$ZIP_PATH" ]]; then
  echo "==> Downloading $URL"
  curl -L --fail -o "$ZIP_PATH" "$URL"
else
  echo "==> Using cached $ZIP_NAME"
fi

rm -rf "$STAGE"
mkdir -p "$STAGE"
echo "==> Extracting base IDE"
unzip -q -o "$ZIP_PATH" -d "$STAGE"
BASE_APP="$(find "$STAGE" -maxdepth 2 -name '*.app' | head -1)"
if [[ -z "$BASE_APP" ]]; then
  echo "ERROR: no .app found in zip"
  exit 1
fi

rm -rf "$APP_OUT"
mkdir -p "$DIST"
mv "$BASE_APP" "$APP_OUT"

RESOURCES="$APP_OUT/Contents/Resources"
APP_RES="$RESOURCES/app"
PRODUCT="$APP_RES/product.json"
PLIST="$APP_OUT/Contents/Info.plist"
FW="$APP_OUT/Contents/Frameworks"
MACOS="$APP_OUT/Contents/MacOS"

echo "==> Applying Anvil product.json overlay"
if command -v jq >/dev/null 2>&1; then
  jq -s '.[0] * .[1]' "$PRODUCT" "$IDE_DIR/product.json" > "$PRODUCT.anvil"
  mv "$PRODUCT.anvil" "$PRODUCT"
else
  python3 - <<PY
import json
from pathlib import Path
base = json.loads(Path("$PRODUCT").read_text())
overlay = json.loads(Path("$IDE_DIR/product.json").read_text())
base.update(overlay)
Path("$PRODUCT").write_text(json.dumps(base, indent=2) + "\n")
PY
fi

echo "==> Renaming Electron helpers VSCodium → Anvil"
# Electron looks up "{CFBundleName} Helper*.app". Rename helpers + main binary together.
rename_helper() {
  local old="$1" new="$2"
  if [[ -d "$FW/$old" ]]; then
    mv "$FW/$old" "$FW/$new"
    local helper_plist="$FW/$new/Contents/Info.plist"
    local helper_bin_old="$FW/$new/Contents/MacOS/${old%.app}"
    local helper_bin_new="$FW/$new/Contents/MacOS/${new%.app}"
    if [[ -f "$helper_bin_old" ]]; then
      mv "$helper_bin_old" "$helper_bin_new"
    fi
    /usr/libexec/PlistBuddy -c "Set :CFBundleName ${new%.app}" "$helper_plist" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName ${new%.app}" "$helper_plist" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Set :CFBundleExecutable ${new%.app}" "$helper_plist" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.anvil.ide.helper" "$helper_plist" 2>/dev/null || true
  fi
}

rename_helper "VSCodium Helper.app" "Anvil Helper.app"
rename_helper "VSCodium Helper (GPU).app" "Anvil Helper (GPU).app"
rename_helper "VSCodium Helper (Plugin).app" "Anvil Helper (Plugin).app"
rename_helper "VSCodium Helper (Renderer).app" "Anvil Helper (Renderer).app"

if [[ -f "$MACOS/VSCodium" ]]; then
  mv "$MACOS/VSCodium" "$MACOS/Anvil"
fi
if [[ -f "$RESOURCES/VSCodium.icns" ]]; then
  cp "$RESOURCES/VSCodium.icns" "$RESOURCES/Anvil.icns" 2>/dev/null || true
fi

echo "==> Branding Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName Anvil" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleName Anvil" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.anvil.ide" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable Anvil" "$PLIST"
if /usr/libexec/PlistBuddy -c "Print :CFBundleIconFile" "$PLIST" >/dev/null 2>&1; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile Anvil" "$PLIST" 2>/dev/null || true
fi

echo "==> Installing built-in Anvil Agent extension"
EXT_DST="$APP_RES/extensions/anvil-agent"
rm -rf "$EXT_DST"
mkdir -p "$EXT_DST"
cp "$ROOT/packages/anvil-extension/package.json" "$EXT_DST/"
cp -R "$ROOT/packages/anvil-extension/dist" "$EXT_DST/"
cp -R "$ROOT/packages/anvil-extension/media" "$EXT_DST/"
EXT_DST="$EXT_DST" python3 - <<'PY'
import json, os
from pathlib import Path
pkg_path = Path(os.environ["EXT_DST"]) / "package.json"
pkg = json.loads(pkg_path.read_text())
events = list(pkg.get("activationEvents") or [])
if "onStartupFinished" not in events:
    events.insert(0, "onStartupFinished")
pkg["activationEvents"] = events
pkg_path.write_text(json.dumps(pkg, indent=2) + "\n")
print("built-in extension ready:", pkg.get("name"), pkg.get("version"))
PY

echo "==> Patching CLI launcher for Anvil executable"
# Upstream ships MacOS/VSCodium; we renamed to Anvil.
if [[ -f "$APP_RES/bin/codium" ]]; then
  sed -i '' 's|MacOS/VSCodium|MacOS/Anvil|g' "$APP_RES/bin/codium"
  cp "$APP_RES/bin/codium" "$APP_RES/bin/anvil"
  chmod +x "$APP_RES/bin/anvil"
fi

echo "==> Clearing quarantine + ad-hoc codesign (local unsigned build)"
xattr -cr "$APP_OUT" || true
# Fresh ad-hoc sign after renames (invalidates upstream notarization — expected)
codesign --force --deep --sign - "$APP_OUT" 2>/dev/null || \
  echo "WARNING: codesign failed — Gatekeeper may block until you allow in System Settings"

rm -rf "$STAGE"

mkdir -p "$DIST/bin"
cat > "$DIST/bin/anvil" <<EOF
#!/usr/bin/env bash
# Some Electron hosts set ELECTRON_RUN_AS_NODE — clear it for a normal GUI launch.
unset ELECTRON_RUN_AS_NODE
exec "$APP_OUT/Contents/Resources/app/bin/codium" "\$@"
EOF
chmod +x "$DIST/bin/anvil"

echo
echo "Built: $APP_OUT"
echo "CLI:   $DIST/bin/anvil"
echo
echo "Launch:"
echo "  unset ELECTRON_RUN_AS_NODE; open $APP_OUT"
echo "  # or: $DIST/bin/anvil $ROOT"
echo
echo "NOTE: Not Apple Developer signed / not notarized."
echo "If macOS blocks: right-click Anvil.app → Open, or"
echo "  xattr -cr $APP_OUT"
echo "  System Settings → Privacy & Security → Open Anyway"
