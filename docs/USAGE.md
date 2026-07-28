# Using Anvil Agent

## Open Anvil Chat

- Command: **Anvil: Open Chat**
- macOS: `Cmd+L`
- Windows/Linux host: `Ctrl+L`
- Activity Bar: **Anvil** icon

**Anvil: New Chat** — `Cmd+Shift+L` / `Ctrl+Shift+L`

## Modes

| Mode | Intent |
|------|--------|
| **Ask** | Explain and investigate without intentionally editing files |
| **Edit** | Make focused code changes (review diffs) |
| **Agent** | Multi-step coding: explore, edit, run tools as needed |

Default mode setting: `anvil.defaultMode` (often `agent`).

Ask/Plan-style modes restrict write tools; Edit/Agent allow edits according to policy.

## Permissions

Setting: `anvil.permissionMode`

| Value | Behavior |
|-------|----------|
| `strict` | Deny deletes / installs / destructive shell |
| `ask` (default) | Prompt before risky operations |
| `permissive` | Allow risky tools when the agent requests them |

File edits, creates, deletes, and terminal commands may require confirmation depending on this policy.

## @ context

Type `@` in chat or use the attach flow:

| Token | Meaning |
|-------|---------|
| `@file` | Attach a workspace file |
| `@selection` | Attach the current editor selection |
| `@folder` | Attach a folder listing |
| `@codebase` | Hint to explore the repository with tools |
| `@problems` | Attach current diagnostics |
| `@git` | Hint to inspect git status/diff |

Examples:

```text
Explain @file src/index.js
Refactor @selection to be clearer
Fix @problems
Summarize recent changes with @git
How is auth structured? @codebase
```

## Model settings

| Setting | Purpose |
|---------|---------|
| `anvil.provider` | `ollama` (default) or cloud: `openai-compatible`, `anthropic`, `gemini` |
| `anvil.baseUrl` | Default `http://127.0.0.1:11434` for Ollama |
| `anvil.model` | Model id (e.g. `qwen2.5-coder:3b`) |
| `anvil.apiKey` | Cloud only — never required for Ollama |

Commands:

- **Anvil: Select Model**
- **Anvil: Test Ollama Connection**
- Status bar: `Anvil: LOCAL · <model>` (click for actions)

## Edits and review

- Edit/Agent changes open native **diff** review
- Accept / Reject (and Accept All / Reject All where offered)
- Task **checkpoint** → View Changes / Revert Task

## Useful commands

| Command | Use |
|---------|-----|
| Anvil: Ask About Selection | Ask mode on selection |
| Anvil: Edit Selection | Edit mode on selection |
| Anvil: Fix Problems | Work from diagnostics |
| Anvil: Explain Current File | Ask about the active file |
| Anvil: Abort Agent | Stop generation / run |

## Streaming

Responses stream into Anvil Chat. Use **Stop** / Abort to cancel.
