# Anvil IDE (Code-OSS based)

Product documentation for end users lives in the root [README](../README.md) and [docs/](../docs/).

## Package Anvil.app (macOS)

```bash
npm install
npm run anvil:package:mac
open dist/Anvil.app
```

Also: `npm run anvil:build` (agent + extension only) · `npm run anvil:launch`

See [docs/INSTALL-MACOS.md](../docs/INSTALL-MACOS.md) for Gatekeeper guidance.

## Layout

| Layer | Location |
|-------|----------|
| Agent core | `packages/agent-core` |
| Anvil Agent extension | `packages/anvil-extension` |
| Branding / Open VSX | `ide/product.json` |
| Package script | `ide/scripts/package-mac.sh` |
| Optional from-source | `ide/scripts/prepare-code-oss.sh` |
| Legacy Electron UI | `apps/legacy-electron/` (archived) |

Base binary: pinned **VSCodium** release (MIT Code-OSS + Open VSX). Anvil overlays branding and ships the agent as a built-in extension.

## Day-to-day agent iteration

```bash
npm run build:ide-ext
# Run and Debug → Anvil: Extension Development Host
```

## Licensing

See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) and [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).
