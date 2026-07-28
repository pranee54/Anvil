# Install Anvil on macOS

Two paths:

- **A. Packaged `Anvil.app`** — recommended for trying the product
- **B. Build from source** — for contributors and local packaging

## Prerequisites

| Tool | Notes |
|------|--------|
| macOS | Apple Silicon (`arm64`) or Intel (`x86_64`) |
| [Node.js](https://nodejs.org/) | **≥ 18** (verified with Node 22) |
| npm | Bundled with Node (verified with npm 10) |
| Git | Required for cloning the repository |
| [Ollama](https://ollama.com) | Required for local AI — see [LOCAL-AI.md](LOCAL-AI.md) |
| curl, unzip | Used by the packaging script |
| jq *or* Python 3 | Used to merge `product.json` during packaging |

Optional: Xcode Command Line Tools (for codesign / general build tooling).

## A. Using a packaged Anvil.app

### 1. Obtain Anvil.app

Either download a release artifact when published, or build locally:

```bash
git clone https://github.com/pranee54/Anvil.git
cd Anvil
npm install
npm run anvil:package:mac
```

This produces `dist/Anvil.app`.

First run downloads a pinned VSCodium zip into `ide/cache/` (hundreds of MB). Subsequent packages reuse the cache.

### 2. Install

```bash
# Optional: put it in Applications
cp -R dist/Anvil.app /Applications/
```

Or drag `dist/Anvil.app` into **Applications** in Finder.

### 3. Launch

```bash
open dist/Anvil.app
# or
open /Applications/Anvil.app
```

Also available after packaging:

```bash
npm run anvil:launch
```

### 4. Gatekeeper (unsigned / ad-hoc signed builds)

Local packages are **ad-hoc signed**, not Apple Developer ID signed or notarized.

If macOS blocks launch:

1. **Preferred:** Finder → right-click `Anvil.app` → **Open** → confirm
2. Or: **System Settings → Privacy & Security** → **Open Anyway**
3. Advanced (clears quarantine attributes): `xattr -cr /path/to/Anvil.app`

Do not treat `xattr` as the default everyday instruction for end users — use Right-click → Open first.

## B. Building Anvil from source

```bash
git clone https://github.com/pranee54/Anvil.git
cd Anvil
npm install
npm run build:agent
npm run build:extension
npm test
npm run typecheck:extension
npm run anvil:package:mac
open dist/Anvil.app
```

### Day-to-day agent development (no full re-package)

```bash
npm run build:ide-ext
```

Then in VS Code / Anvil: **Run and Debug → Anvil: Extension Development Host**.

### Optional: prepare a full Code-OSS tree

```bash
npm run prepare:code-oss
```

This clones upstream Code-OSS into `ide/code-oss/` (gitignored). Full upstream builds are long; the VSCodium overlay path above is the supported packaging path for Desktop V1.

## After install

1. Install Ollama and pull a model — [LOCAL-AI.md](LOCAL-AI.md)
2. Open a project folder in Anvil
3. Select model → Test connection → Open Anvil Chat (`Cmd+L`)

See [USAGE.md](USAGE.md) and [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
