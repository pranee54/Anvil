# Third-Party Notices

This document summarizes third-party components relevant to Anvil. It is **not legal advice**. Maintainers should re-verify licenses before each public binary release.

## Anvil-owned code

The following are intended to be licensed under the MIT License (see [LICENSE](LICENSE)):

- `packages/agent-core`
- `packages/anvil-extension` (Anvil Agent sources and media authored for Anvil)
- `ide/product.json` and Anvil packaging scripts authored for this repository
- `apps/legacy-electron` Anvil prototype sources
- Documentation and tests authored for Anvil

## Desktop IDE base (packaged Anvil.app)

macOS packaging downloads a pinned **VSCodium** build (Code-OSS + Open VSX integration) at build time into `ide/cache/` (not committed).

| Component | Typical license | Notes |
|-----------|-----------------|--------|
| [microsoft/vscode](https://github.com/microsoft/vscode) “Code - OSS” | MIT | Upstream editor |
| [VSCodium](https://github.com/VSCodium/vscodium) | MIT (plus bundled notices) | Distributes Code-OSS without Microsoft product branding / Marketplace wiring |
| Visual Studio Code **product** | Microsoft proprietary | **Do not redistribute** as VS Code |
| Visual Studio Marketplace | Restricted | Anvil uses **Open VSX**, not MS Marketplace |
| Microsoft trademarks / icons / telemetry endpoints | Proprietary | Must not ship |

**Maintainer action before shipping installers:** include the upstream `ThirdPartyNotices` / license files from the exact VSCodium build used, and confirm icon/asset licensing for any replaced branding.

## Open VSX

Extension gallery configuration points at [Open VSX](https://open-vsx.org/). Extensions users install have **their own** licenses — review before bundling anything into Anvil builds.

## npm dependencies

Runtime and development dependencies are declared in:

- root `package.json` / `package-lock.json`
- `packages/agent-core/package.json`
- `packages/anvil-extension/package.json`

Primary agent-core runtime libraries include (non-exhaustive): `diff`, `fast-glob`, `ignore` — generally MIT-licensed. Run a license scanner (e.g. `npx license-checker`) before formal releases.

## Models

Ollama models are **not** part of this repository. Each model has its own license (e.g. Apache-2.0 for many Qwen releases). Users must accept those terms when pulling models.

## Flags requiring maintainer decision

- [ ] Attach full VSCodium/Code-OSS third-party notice file to release assets
- [ ] Confirm Anvil application icon licensing (currently may reuse base icns during packaging)
- [ ] Decide whether legacy Electron UI remains in the public tree long-term
- [ ] Enable GitHub private vulnerability reporting / security contact ([SECURITY.md](SECURITY.md))
