# Development

Contributor setup for Anvil (agent-core + anvil-extension + optional macOS packaging).

## Prerequisites

- Node.js ≥ 18 (Node 22 verified on macOS)
- npm 10+
- Git
- Optional: Ollama for `npm run test:agent` and live agent runs
- Optional (macOS packaging): curl, unzip, jq or Python 3, codesign

## Install

```bash
npm install
```

This is an npm workspaces monorepo:

- `packages/agent-core` → `@anvil/agent-core`
- `packages/anvil-extension` → `anvil-agent` (depends on agent-core)

## Verified commands

```bash
npm run build:agent
npm run build:extension
# equivalent:
npm run build:ide-ext

npm run typecheck:agent
npm run typecheck:extension

npm test
```

Optional integration (requires Ollama + a pulled model):

```bash
npm run test:agent
```

macOS packaging:

```bash
npm run anvil:package:mac
open dist/Anvil.app
```

## Extension Development Host

```bash
npm run build:ide-ext
```

Then **Run and Debug → Anvil: Extension Development Host** (see `.vscode/launch.json`). Opens `demo-project` by default.

## Package responsibilities

| Package / path | Responsibility |
|----------------|----------------|
| `packages/agent-core` | Orchestrator, tools, context, git, terminal, permissions, model providers |
| `packages/anvil-extension` | VS Code/Code-OSS extension: Chat UI, commands, diffs, checkpoints, settings |
| `ide/` | `product.json` branding + packaging helpers |
| `tests/` | Vitest unit/integration tests (no secrets) |
| `apps/legacy-electron/` | Archived Electron UI — do not extend for product features |
| `scripts/` | Manual integration helpers |

## Architecture boundaries

- Put Anvil intelligence in **agent-core** / **anvil-extension**
- Treat upstream Code-OSS / VSCodium as a replaceable base
- Do not vendor full `ide/code-oss/` into git (gitignored)
- Do not commit `ide/cache/`, `dist/`, or user data dirs

## Legacy Electron

```bash
npm run legacy:dev
```

Emergency comparison only. See `apps/legacy-electron/README.md`.

## Optional fixture workspace

Some investigation tests skip unless you set:

```bash
export ANVIL_FIXTURE_WORKSPACE=/path/to/a/real/multi-stack/project
npm test
```

## Cross-platform notes

Windows developers should use the Node build/test path. Packaging scripts are macOS-specific today — [INSTALL-WINDOWS.md](INSTALL-WINDOWS.md).
