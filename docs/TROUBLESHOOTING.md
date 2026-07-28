# Troubleshooting

Evidence-based fixes for common Anvil + Ollama issues.

## Anvil cannot connect to Ollama

1. Confirm Ollama is installed: `ollama --version`
2. Confirm models API responds: `ollama list`
3. Check base URL in Anvil settings — default `http://127.0.0.1:11434`
4. Run **Anvil: Test Ollama Connection**
5. If another process uses 11434, fix the conflict or point `anvil.baseUrl` at the correct host

## Selected model is not installed

```bash
ollama pull qwen2.5-coder:3b
ollama list
```

Select the **exact** name shown in `ollama list` in Anvil.

## No models appear

Ollama is reachable but empty. Pull at least one model, then refresh / re-open Select Model.

## Ollama command not found

- **macOS:** Ensure the Ollama app is installed; open a new terminal; confirm PATH includes the Ollama CLI.
- **Windows:** Re-open PowerShell after install; confirm the installer added Ollama to PATH.

## macOS blocks Anvil

Unsigned / ad-hoc builds:

1. Right-click → **Open**
2. System Settings → Privacy & Security → **Open Anyway**
3. Advanced: `xattr -cr /path/to/Anvil.app`

See [INSTALL-MACOS.md](INSTALL-MACOS.md).

## Agent stops unexpectedly

- Hit iteration limit (`anvil.maxIterations`)
- Model error / context overflow — try a smaller prompt or lighter model
- Permission denied / cancelled by user
- Use **Anvil: Abort Agent** only when you intend to stop; otherwise check the Chat error card

## Model is very slow

- Use a smaller tag (`qwen2.5-coder:3b` before `14b`/`32b`)
- Close other heavy apps
- Reduce attached context (@file sizes, max context settings)

## Out of memory

- Switch to LIGHT tier model
- Shorten conversation / fewer attachments
- Restart Ollama after a hard OOM

## Response quality is poor

- Prefer `qwen2.5-coder:7b` (or larger) if hardware allows
- Add `@file` / `@selection` / `@codebase` so the agent sees real code
- Use Ask for investigation before Edit/Agent for large changes

## Agent fails to use tools

- Ensure mode is **Edit** or **Agent** (Ask restricts writes)
- Approve permission prompts when policy is `ask`
- Confirm workspace folder is open (not an empty window)

## Git repository not detected

- Open the folder that contains `.git`, or a multi-root workspace that includes it
- `@git` hints the agent to call git tools — Git itself must be installed on the OS

## Windows-specific startup / build issues

- Prefer PowerShell; ensure Node ≥ 18
- `npm run anvil:package:mac` will not work on Windows — see [INSTALL-WINDOWS.md](INSTALL-WINDOWS.md)
- Use Extension Development Host for agent work until a Windows package exists

## Build failures from a clean clone

```bash
npm install
npm run build:agent
npm run build:extension
npm test
```

If packaging fails on macOS, check network access for the VSCodium download and free disk space under `ide/cache/`.
