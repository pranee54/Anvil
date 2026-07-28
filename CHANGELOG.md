# Changelog

All notable changes to Anvil are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned

- Windows packaged application pipeline
- Linux packaging verification
- Apple Developer ID signing / notarization

## [0.2.0] - 2026-07-29

### Added

- Public documentation suite (install, local AI, usage, troubleshooting, development)
- Community files: contributing guide, security policy, issue/PR templates
- CI workflow for install, build, typecheck, and tests (macOS + Windows)
- `docs/ARCHITECTURE.md` and repository hygiene for first public developer preview

### Changed

- Legacy Electron prototype relocated under `apps/legacy-electron/`
- Product README rewritten for external developers
- Branding cleanup for public-facing materials

### Notes

- Desktop packaging verified path: **macOS** `Anvil.app` via `npm run anvil:package:mac`
- Windows: development builds of agent packages supported; packaged app **not** verified

## [0.1.0] - 2026-07

### Added

- `packages/agent-core` — orchestrator, tools, context, Ollama + cloud providers
- `packages/anvil-extension` — Anvil Agent / Chat, modes, @ context, diffs, checkpoints
- macOS packaging overlay on VSCodium (`ide/scripts/package-mac.sh`)
- Vitest suite under `tests/`
