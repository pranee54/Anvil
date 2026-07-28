# Install Anvil on Windows

## Current status

| Capability | Status |
|------------|--------|
| Build `packages/agent-core` | Supported (Node.js) |
| Build `packages/anvil-extension` | Supported (Node.js) |
| Run tests / typecheck | Supported (Node.js) |
| Extension Development Host | Supported (VS Code / compatible host) |
| Packaged Windows `.exe` / installer | **Not in the verified release pipeline** |

There is currently a **macOS-only** packaging script: `ide/scripts/package-mac.sh` (`npm run anvil:package:mac`). It assumes `bash`, `open`, `xattr`, `.app` bundles, and Darwin architectures.

**Windows packaged builds are not yet part of the verified release pipeline.**

## Prerequisites

| Tool | Notes |
|------|--------|
| Windows 10/11 | x64 recommended |
| [Node.js](https://nodejs.org/) | **≥ 18** (LTS recommended) |
| npm | Bundled with Node |
| Git for Windows | Required to clone |
| [Ollama for Windows](https://ollama.com/download) | For local AI — see [LOCAL-AI.md](LOCAL-AI.md) |

## Development workflow (verified intent)

From PowerShell or Git Bash:

```powershell
git clone https://github.com/pranee54/Anvil.git
cd Anvil
npm install
npm run build:agent
npm run build:extension
npm test
npm run typecheck:extension
```

### Run Anvil Agent in an IDE host

1. Open this repository in **VS Code** (or a Code-OSS-compatible host)
2. Run `npm run build:ide-ext`
3. **Run and Debug → Anvil: Extension Development Host**
4. Open a project folder in the Extension Development Host window
5. Use Anvil Chat / Agent with Ollama running locally

This is the supported Windows path until a native Windows package script exists.

## What remains for native Windows packaging

- Download/pin a Windows VSCodium (or Code-OSS) release
- Overlay `ide/product.json`
- Bundle `packages/anvil-extension` as a built-in extension
- Produce an installer or portable zip
- CI verification on Windows runners

Contributions welcome — keep Anvil logic in `packages/*` and avoid deep forks of upstream IDE source.

## macOS-only assumptions in repo scripts

| Item | Notes |
|------|--------|
| `npm run anvil:package:mac` | Darwin only |
| `npm run anvil:launch` | Uses `open` |
| `ide/scripts/package-mac.sh` | bash + macOS codesign/xattr |
| `npm run test:agent` | Sets `ELECTRON_RUN_AS_NODE=1` (Unix-style env) |

Prefer documenting Node.js package scripts for cross-platform work; packaging can stay OS-specific.

## Next steps

- [LOCAL-AI.md](LOCAL-AI.md) — install Ollama on Windows
- [USAGE.md](USAGE.md) — modes and @ context
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
