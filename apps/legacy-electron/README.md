# Legacy Electron shell (archived)

This directory contains the **archived** custom Electron + React editor.

It is **not** the current Anvil product architecture.

## Current product path

Standalone **Anvil.app** (macOS), built from Code-OSS / VSCodium overlay + built-in Anvil Agent:

```bash
npm run anvil:package:mac
open dist/Anvil.app
```

Canonical agent logic lives in `packages/agent-core` and `packages/anvil-extension`.

## Why this remains

`npm run legacy:dev` can still boot this shell for emergency comparison. Do not invest in new UI work here.

## Layout

| Path | Role |
|------|------|
| `src/main` | Electron main process (legacy) |
| `src/preload` | IPC bridge (legacy) |
| `src/renderer` | React UI (legacy) |
| `src/shared` | Shared types (legacy) |
