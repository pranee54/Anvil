# Local AI with Ollama

Anvil does **not** ship Ollama or large language model weights. Install them separately, then point Anvil at your local Ollama server.

## Why local AI?

- Source can remain on your machine during local inference
- No model API key required for Ollama
- Offline inference after Ollama and models are installed
- You control which models are installed

These are implementation benefits, not absolute privacy guarantees.

## Default endpoint

Anvil connects to Ollama at:

```text
http://127.0.0.1:11434
```

Change `anvil.baseUrl` in settings if your host differs.

---

## Install Ollama — macOS

1. Download from [https://ollama.com/download](https://ollama.com/download).
2. Open the Ollama app so the service can start.
3. Verify:

```bash
ollama --version
ollama list
```

### Service behavior

Opening the Ollama app usually starts a background service on port `11434`.

If the service is not running, start it manually:

```bash
ollama serve
```

Then pull and test a model:

```bash
ollama pull qwen2.5-coder:3b
ollama pull qwen2.5-coder:7b
ollama list
ollama run qwen2.5-coder:3b "Say hello in one sentence."
```

---

## Install Ollama — Windows

1. Download the Windows installer from [https://ollama.com/download](https://ollama.com/download).
2. Complete setup and ensure Ollama is running (Start menu / system tray).
3. Verify in **PowerShell**:

```powershell
ollama --version
ollama list
```

If the server is not available:

```powershell
ollama serve
```

Pull models:

```powershell
ollama pull qwen2.5-coder:3b
ollama pull qwen2.5-coder:7b
ollama list
```

---

## Model tiers

Models are installed with Ollama, not Anvil:

```bash
ollama pull <model>
ollama list
ollama run <model>
```

Then select the same model id in Anvil (**Anvil: Select Model** or Settings → `anvil.model`).

Default in Anvil settings: `qwen2.5-coder:3b`.

Verified tags from [ollama.com/library/qwen2.5-coder](https://ollama.com/library/qwen2.5-coder):

| Tier | Command | Guidance |
|------|---------|----------|
| **Lightweight** | `ollama pull qwen2.5-coder:3b` | Basic Ask/Edit and experimentation |
| **Balanced (recommended)** | `ollama pull qwen2.5-coder:7b` | Stronger everyday coding when hardware allows |
| **Stronger** | `ollama pull qwen2.5-coder:14b` (or larger) | Better quality; requires substantially more RAM/resources |

Download size is not the same as RAM required. Context length and other apps also affect memory use.

Optional alternative often listed for coding:

```bash
ollama pull deepseek-coder-v2
```

### Beginner notes

- Models are stored by Ollama, not inside the Anvil app bundle
- Larger models are slower and need more memory
- If you hit out-of-memory errors, switch to the 3B tier

---

## In Anvil

1. Provider: **ollama**
2. Base URL: `http://127.0.0.1:11434`
3. Select / refresh models
4. **Anvil: Test Ollama Connection**

| Symptom | Likely cause |
|---------|----------------|
| Connection failed | Ollama not running; wrong base URL — try `ollama serve` |
| Model not installed | `ollama pull <model>` then refresh |
| No models appear | Pull at least one model |
| Slow / out of memory | Use `qwen2.5-coder:3b` |

More: [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
