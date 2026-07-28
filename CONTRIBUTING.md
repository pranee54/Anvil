# Contributing to Anvil

Thanks for contributing. Anvil is a local-first AI coding IDE: Code-OSS base + Anvil Agent.

## Setup

Follow [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md):

```bash
npm install
npm run build:agent
npm run build:extension
npm test
npm run typecheck:extension
```

## Branch workflow

1. Create a topic branch from the default branch
2. Keep changes focused (one concern per PR when practical)
3. Run build + tests before opening a PR
4. Describe **why** the change exists in the PR body

## Code style

- TypeScript strict mode
- Prefer small, precise edits
- Avoid giant files; keep modules focused
- Comments explain **why** non-obvious code exists
- No secrets in source, tests, or docs

## Tests

- Add or update Vitest coverage for agent-core behavior changes
- Prefer `demo-project` or synthetic fixtures over machine-specific absolute paths
- Optional real-world fixture: `ANVIL_FIXTURE_WORKSPACE`

## Pull requests

Use the PR template. Include:

- Summary of intent
- Test plan (commands you ran)
- Platform notes (macOS / Windows)

## Architecture boundaries

**Do:**

- Put Anvil intelligence in `packages/agent-core` and `packages/anvil-extension`
- Treat `ide/product.json` + packaging scripts as the branding/integration layer

**Avoid:**

- Unnecessary modification of upstream Code-OSS / VSCodium internals
- Reviving `apps/legacy-electron/` for product features
- Committing `node_modules/`, `dist/`, `ide/cache/`, model weights, or user data

## Product naming

Use **Anvil**, **Anvil Agent**, and **Anvil Chat** in user-facing text and docs.

Repository: [https://github.com/pranee54/Anvil](https://github.com/pranee54/Anvil)

## License

By contributing, you agree that your contributions are licensed under the same terms as the Anvil-owned code (MIT) unless stated otherwise in the PR.
