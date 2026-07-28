# Anvil architecture

## Overview

```
Anvil Desktop
      │
      ├── Code-OSS IDE (VSCodium binary + Anvil product.json overlay)
      │
      └── Anvil Agent Extension (built-in)
                 │
                 ▼
             agent-core
        ┌────────┼─────────┐
        ▼        ▼         ▼
     Context    Tools     Models
        │        │         │
        ▼        ▼         ▼
      Repo    Terminal    Ollama (default, streaming)
              Files       OpenAI-compatible (optional; no streaming yet)
              Git         Anthropic / Gemini (scaffold only — not enabled)
```

## Why separate from upstream Code-OSS?

Anvil does **not** maintain a deep permanent fork of thousands of VS Code source files.

- Agent logic lives in `packages/agent-core` and `packages/anvil-extension`
- Desktop V1 packages a pinned **VSCodium** release, overlays `ide/product.json`, and installs the Anvil Agent as a built-in extension
- Upstream IDE updates = re-run packaging against a new pin

This keeps Anvil features portable and reviewable.

## Layers

### `packages/agent-core`

Reusable TypeScript library:

- Agent orchestrator (Ask / Edit / Agent loops)
- Tool runtime (read/search/edit/terminal/git/…)
- Context / repository map / investigation
- Permissions policy
- Model gateway (Ollama; OpenAI-compatible HTTP; Anthropic/Gemini scaffolds not enabled)

### `packages/anvil-extension`

Code-OSS extension (`anvil-agent`):

- Anvil Chat webview / sidebar
- Commands, keybindings, status bar
- @ context attachments
- Diff review + checkpoints
- Settings contribution points

### `ide/`

- `product.json` — Anvil name, data dirs, Open VSX gallery (not Microsoft Marketplace)
- `scripts/package-mac.sh` — build `dist/Anvil.app`
- `scripts/prepare-code-oss.sh` — optional full Code-OSS tree (gitignored)

### `apps/legacy-electron/`

Archived custom Electron + React shell. Not the product path.

### `tests/`

Vitest coverage for agent-core behavior and extension helpers.

## Desktop packaging (macOS)

`npm run anvil:package:mac`:

1. Build agent-core + extension
2. Download pinned VSCodium zip → `ide/cache/`
3. Overlay product branding
4. Rename helpers to Anvil*
5. Copy extension into `extensions/anvil-agent`
6. Ad-hoc codesign (not notarized)

## Legal / gallery notes

- Ship **Open VSX**, not Visual Studio Marketplace
- Do not ship Microsoft product trademarks/telemetry endpoints
- See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) and legacy notes in [ARCHITECTURE-CODE-OSS.md](ARCHITECTURE-CODE-OSS.md)
