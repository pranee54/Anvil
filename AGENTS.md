# Anvil Agent Instructions

## Product

Anvil is a local-first AI coding IDE: Code-OSS-class desktop + Anvil Agent.

## Architecture (current)

- `packages/agent-core` — agent orchestration, tools, context, models, permissions
- `packages/anvil-extension` — Anvil Agent / Anvil Chat UI (Code-OSS extension)
- `ide/` — product branding + macOS packaging (VSCodium / Code-OSS overlay)
- `apps/legacy-electron/` — archived Electron prototype (not the product path)

## Conventions

- TypeScript strict mode
- Keep modules focused; avoid giant files
- Prefer precise edits over large rewrites
- Respect `.aiignore` and never leak secrets to cloud providers
- Keep Anvil intelligence in agent-core / anvil-extension; avoid unnecessary upstream IDE edits

## Commands

```bash
npm install
npm run build:agent
npm run build:extension
npm test
npm run typecheck:extension
npm run anvil:package:mac   # macOS only
```
