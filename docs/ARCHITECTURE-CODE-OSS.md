# Anvil IDE Architecture — Code-OSS Migration

## Decision (Phase 1)

**Anvil will be a branded Code-OSS distribution + first-party Anvil Agent extension.**

We will **not** maintain a deep fork of thousands of VS Code source files.

### Legal summary

| Asset | License / constraint |
|--------|----------------------|
| `microsoft/vscode` source ("Code - OSS") | **MIT** — may build, modify, redistribute |
| Official **Visual Studio Code** product | Microsoft proprietary license — **do not redistribute** |
| Microsoft branding, icons, telemetry endpoints | Proprietary — **must not ship** |
| **Visual Studio Marketplace** | Licensed only for Microsoft VS family — **do not wire into Anvil** |
| **Open VSX** | Appropriate extension gallery for Code-OSS derivatives |

Anvil branding, logos, and product name are original.

### Maintainable approach (VSCodium-style)

```
upstream Code-OSS (git clone / CI pin)
        │
        ▼
  product.json overlay (Anvil name, Open VSX, no MS telemetry)
        │
        ▼
  built-in extensions: anvil.anvil-agent (+ language packs via Open VSX)
        │
        ▼
  Anvil desktop binary
```

Anvil-specific logic lives **outside** upstream:

```
packages/agent-core/          reusable agent (orchestrator, tools, Ollama, …)
packages/anvil-extension/     VS Code / Code-OSS extension (sidebar, commands, settings)
ide/product.json              branding + gallery config
ide/scripts/                  clone/build helpers (no permanent full vscode tree in repo)
apps/legacy-electron/         archived Electron React shell (not the product path)
```

Upstream updates = re-run build scripts against a new Code-OSS/VSCodium pin. Extension + agent-core merge independently.

### Why not a permanent vscode submodule in-repo?

Full Code-OSS clones are huge and slow to build (30–90+ minutes). CI will pin a version; developers iterate on the **extension** inside VS Code / VSCodium / Extension Development Host for day-to-day work.

### Desktop V1 (current)

Standalone **Anvil.app** is produced by `npm run anvil:package:mac`:

1. Download pinned VSCodium (Code-OSS + Open VSX)
2. Overlay `ide/product.json` (Anvil name, `.anvil` data dir, Open VSX)
3. Rename Electron helpers to Anvil*
4. Install `packages/anvil-extension` under `extensions/anvil-agent`
5. Ad-hoc codesign (not notarized)

Legacy Electron UI is archived under `apps/legacy-electron/` — not the product path.

For the public architecture overview see [ARCHITECTURE.md](ARCHITECTURE.md).

### Migration map

| Preserve | Replace / deprecate |
|----------|---------------------|
| agent/orchestrator | Custom React FileExplorer |
| model gateway + Ollama | Custom Monaco shell |
| context engine | Custom BottomPanel terminal |
| tool runtime | Custom Git/diff DIY UI |
| permissions | Custom Problems panel |
| terminal runner | Custom TitleBar / layout |
| git helpers | |
| AGENTS.md / .aiignore | |
