/** @deprecated Canonical: packages/agent-core — do not extend. */
import fs from 'fs/promises'
import path from 'path'
import fg from 'fast-glob'
import type { ProjectSummary, ProjectType } from '@shared/types'
import { IgnoreEngine } from '../repository/ignore-engine'
import { PathGuard } from '../repository/path-guard'
import { isSecretPath } from '../permissions/policy'

const IMPORTANT_PATTERNS: Record<ProjectType, string[]> = {
  flutter: ['pubspec.yaml', 'analysis_options.yaml', 'lib/main.dart', 'AGENTS.md', 'README.md'],
  nodejs: ['package.json', 'tsconfig.json', 'src/index.ts', 'src/index.js', 'index.js', 'AGENTS.md', 'README.md'],
  react: ['package.json', 'vite.config.*', 'src/main.tsx', 'src/App.tsx', 'AGENTS.md', 'README.md'],
  nextjs: ['package.json', 'next.config.*', 'app/page.tsx', 'app/layout.tsx', 'AGENTS.md', 'README.md'],
  laravel: ['composer.json', 'artisan', 'routes/web.php', 'AGENTS.md', 'README.md'],
  python: ['pyproject.toml', 'requirements.txt', 'main.py', 'AGENTS.md', 'README.md'],
  unknown: ['README.md', 'AGENTS.md', 'package.json', 'composer.json', 'pubspec.yaml']
}

const ENTRY_CANDIDATES = [
  'README.md',
  'AGENTS.md',
  'package.json',
  'composer.json',
  'pubspec.yaml',
  'pyproject.toml',
  'requirements.txt',
  'src/index.js',
  'src/index.ts',
  'src/main.ts',
  'src/main.tsx',
  'src/App.tsx',
  'lib/main.dart',
  'main.py',
  'index.js'
]

export type ContextIntent = 'overview' | 'targeted' | 'implementation'

export class ContextEngine {
  private ignore: IgnoreEngine

  constructor(private guard: PathGuard) {
    this.ignore = new IgnoreEngine(guard.root)
  }

  async refresh(root: string): Promise<void> {
    this.guard.setRoot(root)
    this.ignore = new IgnoreEngine(root)
    await this.ignore.load()
  }

  async detectProjectType(): Promise<ProjectType> {
    const root = this.guard.root
    const has = async (p: string) => {
      try {
        await fs.access(path.join(root, p))
        return true
      } catch {
        return false
      }
    }

    if (await has('pubspec.yaml')) return 'flutter'
    if ((await has('artisan')) && (await has('composer.json'))) return 'laravel'
    if ((await has('next.config.js')) || (await has('next.config.mjs')) || (await has('next.config.ts'))) {
      return 'nextjs'
    }
    if (await has('package.json')) {
      try {
        const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as {
          dependencies?: Record<string, string>
          devDependencies?: Record<string, string>
        }
        const deps = { ...pkg.dependencies, ...pkg.devDependencies }
        if (deps.next) return 'nextjs'
        if (deps.react || deps['react-dom']) return 'react'
        return 'nodejs'
      } catch {
        return 'nodejs'
      }
    }
    if ((await has('pyproject.toml')) || (await has('requirements.txt')) || (await has('setup.py'))) {
      return 'python'
    }
    return 'unknown'
  }

  async listSourceFiles(max = 500): Promise<string[]> {
    await this.ignore.ensureLoaded()
    const entries = await fg(['**/*'], {
      cwd: this.guard.root,
      onlyFiles: true,
      dot: false,
      absolute: false,
      suppressErrors: true,
      followSymbolicLinks: false
    })

    return entries
      .filter((p) => !this.ignore.ignores(p) && !isSecretPath(p) && !isProbablyBinary(p))
      .slice(0, max)
  }

  async buildTreeOutline(maxEntries = 80): Promise<string> {
    const files = await this.listSourceFiles(maxEntries)
    return files.map((f) => `- ${f}`).join('\n')
  }

  async buildSummary(): Promise<ProjectSummary> {
    await this.ignore.ensureLoaded()
    const type = await this.detectProjectType()
    const files = await this.listSourceFiles(400)
    const patterns = IMPORTANT_PATTERNS[type]
    const important = await fg(patterns, {
      cwd: this.guard.root,
      onlyFiles: true,
      absolute: false,
      suppressErrors: true
    })

    let agentsMd: string | undefined
    try {
      agentsMd = await fs.readFile(path.join(this.guard.root, 'AGENTS.md'), 'utf8')
    } catch {
      // optional
    }

    return {
      root: this.guard.root,
      type,
      files: files.slice(0, 200),
      importantFiles: important.filter((p) => !this.ignore.ignores(p)).slice(0, 20),
      agentsMd: agentsMd?.slice(0, 6_000)
    }
  }

  classifyIntent(userMessage: string): ContextIntent {
    const lower = userMessage.toLowerCase()
    if (
      /\b(how (does|do|is)|what (is|does)|explain|overview|architecture|works?|understand)\b/.test(
        lower
      ) &&
      !/\b(add|implement|create|fix|edit|change|refactor|write|delete|run)\b/.test(lower)
    ) {
      return 'overview'
    }
    if (/\b(add|implement|create|fix|edit|change|refactor|write|delete|feature)\b/.test(lower)) {
      return 'implementation'
    }
    return 'targeted'
  }

  /**
   * Progressive context: seed with a small set of architecture files.
   * The agent should pull additional files via tools.
   */
  async selectInitialContext(
    userMessage: string,
    options: { maxFiles?: number } = {}
  ): Promise<{ files: string[]; intent: ContextIntent; reason: string }> {
    const summary = await this.buildSummary()
    const intent = this.classifyIntent(userMessage)
    const maxFiles = options.maxFiles ?? (intent === 'overview' ? 4 : intent === 'implementation' ? 6 : 5)

    const selected: string[] = []
    const add = (file: string | undefined): void => {
      if (!file) return
      if (selected.includes(file)) return
      if (selected.length >= maxFiles) return
      selected.push(file)
    }

    for (const candidate of ENTRY_CANDIDATES) {
      if (summary.files.includes(candidate) || summary.importantFiles.includes(candidate)) {
        add(candidate)
      } else if (await this.guard.exists(candidate)) {
        add(candidate)
      }
    }

    for (const file of summary.importantFiles) {
      add(file)
    }

    if (intent !== 'overview') {
      const tokens = tokenize(userMessage)
      const scored = summary.files
        .map((file) => {
          const lower = file.toLowerCase()
          let score = 0
          for (const t of tokens) {
            if (lower.includes(t)) score += 3
            if (path.basename(lower).includes(t)) score += 5
          }
          return { file, score }
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)

      for (const item of scored) add(item.file)
    }

    return {
      files: selected.slice(0, maxFiles),
      intent,
      reason:
        intent === 'overview'
          ? 'overview request — seeded with README/entry/config only'
          : 'progressive seed — use tools to read more files as needed'
    }
  }

  /** @deprecated use selectInitialContext */
  async selectContext(userMessage: string, maxFiles = 6): Promise<string[]> {
    const result = await this.selectInitialContext(userMessage, { maxFiles })
    return result.files
  }

  async readCompact(relativePath: string, maxChars = 6_000): Promise<string> {
    const abs = this.guard.resolve(relativePath)
    const content = await fs.readFile(abs, 'utf8')
    if (content.length <= maxChars) return content
    return `${content.slice(0, maxChars)}\n\n...[truncated ${content.length - maxChars} chars]`
  }
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .filter((t) => t.length > 2 && !STOP.has(t))
}

const STOP = new Set([
  'the',
  'and',
  'for',
  'with',
  'this',
  'that',
  'from',
  'into',
  'using',
  'please',
  'project',
  'file',
  'code',
  'add',
  'make',
  'create',
  'update',
  'fix',
  'run',
  'show',
  'analyze',
  'how',
  'does',
  'what',
  'work',
  'works',
  'explain'
])

function isProbablyBinary(filePath: string): boolean {
  return /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tar|bz2|7z|rar|exe|dll|so|dylib|wasm|mp4|mp3|woff2?|ttf|otf|class|o|a|pyc|db|sqlite)$/i.test(
    filePath
  )
}
