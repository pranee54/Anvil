# Security Policy

## Supported versions

Anvil is in **developer preview** (pre-1.0). Security fixes are applied on a best-effort basis to the default branch.

## Reporting a vulnerability

Please **do not** open a public issue that includes exploit details, secrets, or private user data.

Preferred options for [pranee54/Anvil](https://github.com/pranee54/Anvil):

1. **GitHub Security Advisories** — repository *Security* tab → *Report a vulnerability* (when enabled)
2. A **minimal** public issue titled `SECURITY: <short topic>` **without** secrets or exploit payloads, asking maintainers to follow up privately

Enable GitHub private vulnerability reporting when the repository settings allow it.

## What not to submit

- API keys, tokens, cookies, or passwords
- Private repository contents
- Full user-data directories from `~/.anvil` or `dist/anvil-user-data*`

## Local models

Local Ollama inference keeps prompts on the machine by default for that provider path. This is not a complete threat model:

- Other extensions, malware, or misconfiguration can still exfiltrate data
- **OpenAI-compatible** endpoints send prompts/code you attach when that provider is selected
- Anthropic and Gemini are **not enabled** in this release; do not rely on them for inference
- Never commit `.env` files or paste keys into chat logs you share

## API keys

- Ollama does not require an API key
- API keys for OpenAI-compatible endpoints are stored in editor settings — treat them like passwords
- Rotate keys if they appear in logs or screenshots
