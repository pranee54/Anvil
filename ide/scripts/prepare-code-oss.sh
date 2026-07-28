#!/usr/bin/env bash
# Scaffold / refresh a Code-OSS working tree for building branded Anvil.
# Does NOT vendor the full vscode tree into git by default.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IDE_DIR="$ROOT/ide"
CODE_DIR="${ANVIL_CODE_OSS_DIR:-$IDE_DIR/code-oss}"
TAG="${ANVIL_CODE_OSS_TAG:-1.96.2}"

echo "Anvil Code-OSS prepare"
echo "  target: $CODE_DIR"
echo "  tag:    $TAG"

if [[ ! -d "$CODE_DIR/.git" ]]; then
  echo "Cloning microsoft/vscode (Code - OSS)…"
  git clone --depth 1 --branch "$TAG" https://github.com/microsoft/vscode.git "$CODE_DIR"
else
  echo "Code-OSS tree already present."
fi

echo "Merging Anvil product.json overlay…"
if command -v jq >/dev/null 2>&1; then
  jq -s '.[0] * .[1]' "$CODE_DIR/product.json" "$IDE_DIR/product.json" > "$CODE_DIR/product.json.anvil"
  mv "$CODE_DIR/product.json.anvil" "$CODE_DIR/product.json"
  echo "product.json updated (jq merge)."
else
  echo "WARNING: jq not found — copy product.json fields manually from ide/product.json"
fi

EXT_SRC="$ROOT/packages/anvil-extension"
EXT_DST="$CODE_DIR/extensions/anvil-agent"
mkdir -p "$EXT_DST"
rsync -a --delete \
  --exclude node_modules --exclude dist \
  "$EXT_SRC/" "$EXT_DST/" || cp -R "$EXT_SRC/." "$EXT_DST/"

echo
echo "Next steps (full desktop build — long):"
echo "  cd $CODE_DIR"
echo "  npm install   # or yarn per upstream docs for this tag"
echo "  npm run watch   # or npm run compile"
echo
echo "Day-to-day Anvil agent development (recommended):"
echo "  Open this repo in VS Code → Run 'Anvil: Extension Development Host'"
echo "  That launches a REAL IDE with Explorer/Terminal/Git/Search + Anvil sidebar."
echo
echo "Extensions gallery: Open VSX (see ide/product.json). Do NOT use MS Marketplace in Anvil builds."
