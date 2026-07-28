# Anvil

A local-first AI coding IDE built on the Code-OSS / VSCodium ecosystem.

Anvil combines a full desktop editor with **Anvil Agent** — a repository-aware coding assistant that can investigate projects, edit files, run tools, and work with local AI models through Ollama. Optional cloud providers are available when configured.

> **Status:** Developer preview **v0.2.0**. Usable for local AI-assisted coding on macOS. Windows standalone packaging is not yet implemented or verified.

Repository: [https://github.com/pranee54/Anvil](https://github.com/pranee54/Anvil)

## What is Anvil?

- Code-OSS-class desktop IDE (editor, terminal, Git, search, Open VSX extensions)
- Integrated **Anvil Agent** and **Anvil Chat**
- Local-first AI via Ollama (models installed separately)
- Repository investigation (search, read, project structure)
- **Ask**, **Edit**, and **Agent** modes
- `@` context attachments (`@file`, `@selection`, `@folder`, `@codebase`, `@problems`, `@git`)
- File editing with native diff review
- Terminal / tool execution with permission policy
- Task checkpoints and revert
- Streaming responses and stop generation

## Platform support

| Platform | Development | Packaged app | Status |
|----------|-------------|--------------|--------|
| macOS (Apple Silicon / Intel) | Supported + tested | `Anvil.app` via `npm run anvil:package:mac` | Supported + tested |
| Windows | Supported (Node builds / Extension Development Host) | Not implemented in this release | Development only |
| Linux | Package builds likely; not verified | Not packaged | Planned |

## Features (implemented)

- Ask / Edit / Agent workflows
- Ollama local models; optional `openai-compatible`, `anthropic`, `gemini`
- Context investigation and grounding from repository files
- Diff review (Accept / Reject) and task checkpoints / revert
- Diagnostics-aware commands (e.g. Fix Problems)
- Conversation sessions
- macOS packaged application (`dist/Anvil.app`)

## Modes

| Mode | Behavior |
|------|----------|
| **Ask** | Explain and investigate without intentionally editing the project |
| **Edit** | Focused code changes with review |
| **Agent** | Multi-step tasks using repository tools (files, search, terminal, git, …) |

Risky operations follow `anvil.permissionMode`: `strict`, `ask` (default), or `permissive`. Details: [docs/USAGE.md](docs/USAGE.md).

## Local AI

Anvil does **not** bundle Ollama or model weights. Install Ollama, pull a model, then connect Anvil to:

```text
http://127.0.0.1:11434
```

Examples:

```bash
ollama pull qwen2.5-coder:3b   # lightweight
ollama pull qwen2.5-coder:7b   # recommended balanced option
```

Full guide: [docs/LOCAL-AI.md](docs/LOCAL-AI.md).

## Quick start

1. Install Anvil — [macOS](docs/INSTALL-MACOS.md) · [Windows](docs/INSTALL-WINDOWS.md)
2. Install [Ollama](docs/LOCAL-AI.md) and pull a coding model
3. Open Anvil and open a project folder
4. Select Ollama / your model (status bar: `Anvil: LOCAL · …`)
5. Run **Anvil: Test Ollama Connection**
6. Open **Anvil Chat** (`Cmd+L` / `Ctrl+L`) and ask a repository question

```text
Explain this codebase.
Where is authentication implemented?
Find the code responsible for API requests.
Explain this file.
Fix the current diagnostics.
Inspect this project and tell me how it is structured.
```

## Installation

- **[macOS](docs/INSTALL-MACOS.md)** — build `Anvil.app` from source; Gatekeeper notes for unsigned builds
- **[Windows](docs/INSTALL-WINDOWS.md)** — development setup via Extension Development Host (no verified Windows package yet)
- **[Local AI](docs/LOCAL-AI.md)** — Ollama + model tiers

```bash
git clone https://github.com/pranee54/Anvil.git
cd Anvil
npm install
npm run anvil:package:mac   # macOS only
open dist/Anvil.app
```

## Architecture

```
Anvil Desktop
      │
      ├── Code-OSS IDE (VSCodium base + Anvil product overlay)
      │
      └── Anvil Agent Extension
                 │
                 ▼
             agent-core
        ┌────────┼─────────┐
        ▼        ▼         ▼
     Context    Tools     Models
        │        │         │
        ▼        ▼         ▼
      Repo    Terminal    Ollama
              Files       Cloud*
              Git
```

\*Cloud providers are optional; Ollama is the default local path.

| Path | Role |
|------|------|
| `packages/agent-core` | Orchestrator, tools, context, permissions, model gateway |
| `packages/anvil-extension` | Anvil Chat UI, commands, diffs, checkpoints |
| `ide/` | Product branding + macOS packaging |
| `apps/legacy-electron/` | Archived prototype — not the product path |
| `tests/` | Vitest suite |

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Development

```bash
npm install
npm run build:agent
npm run build:extension
npm run typecheck:agent
npm run typecheck:extension
npm test
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Documentation

| Guide | Description |
|-------|-------------|
| [INSTALL-MACOS](docs/INSTALL-MACOS.md) | macOS install & Gatekeeper |
| [INSTALL-WINDOWS](docs/INSTALL-WINDOWS.md) | Windows development setup |
| [LOCAL-AI](docs/LOCAL-AI.md) | Ollama + models |
| [USAGE](docs/USAGE.md) | Modes, @ context, settings |
| [TROUBLESHOOTING](docs/TROUBLESHOOTING.md) | Common failures |
| [DEVELOPMENT](docs/DEVELOPMENT.md) | Contributor workflow |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | System design |

## Security

Report vulnerabilities via [SECURITY.md](SECURITY.md). Do not paste API keys or secrets into issues.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Keep Anvil-specific logic in `packages/agent-core` and `packages/anvil-extension`.

## License

Anvil-owned code: [MIT](LICENSE).

Packaged desktop builds redistribute a Code-OSS / VSCodium-derived IDE. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Anvil branding does not imply ownership of upstream IDE components.
