import fs from 'fs/promises'
import path from 'path'
import fg from 'fast-glob'
import type { PathGuard } from './path-guard'
import type { IgnoreEngine } from './ignore-engine'

export type StackSignal =
  | 'php'
  | 'browser_extension'
  | 'nodejs'
  | 'react'
  | 'nextjs'
  | 'laravel'
  | 'flutter'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'docker'
  | 'sql'

export type EntryPoint = {
  path: string
  kind: string
  reason: string
}

export type VerifiedRunCommand = {
  command: string
  source: string
  confidence: 'verified'
}

export type RepositoryMap = {
  root: string
  builtAt: number
  stacks: StackSignal[]
  languages: string[]
  topFolders: string[]
  entryPoints: EntryPoint[]
  importantFiles: string[]
  apiRoutes: string[]
  packageScripts: string[]
  verifiedRunCommands: VerifiedRunCommand[]
  readmePaths: string[]
  fileCount: number
}

type CacheEntry = { map: RepositoryMap; fingerprint: string }

const cache = new Map<string, CacheEntry>()

export async function getRepositoryMap(
  guard: PathGuard,
  ignore: IgnoreEngine
): Promise<RepositoryMap> {
  await ignore.ensureLoaded()
  const root = guard.root
  const fingerprint = await fingerprintWorkspace(root)
  const hit = cache.get(root)
  if (hit && hit.fingerprint === fingerprint) return hit.map

  const map = await buildRepositoryMap(guard, ignore)
  cache.set(root, { map, fingerprint })
  return map
}

export function invalidateRepositoryMap(root?: string): void {
  if (root) cache.delete(root)
  else cache.clear()
}

async function fingerprintWorkspace(root: string): Promise<string> {
  const markers = [
    'package.json',
    'composer.json',
    'pubspec.yaml',
    'README.md',
    'extension/chrome/manifest.json',
    'backend/includes/config.php',
    'backend/sql/schema.sql'
  ]
  const parts: string[] = []
  for (const m of markers) {
    try {
      const st = await fs.stat(path.join(root, m))
      parts.push(`${m}:${st.mtimeMs}`)
    } catch {
      // absent
    }
  }
  return parts.join('|') || `empty:${root}`
}

async function buildRepositoryMap(guard: PathGuard, ignore: IgnoreEngine): Promise<RepositoryMap> {
  const root = guard.root
  const has = async (p: string) => {
    try {
      await fs.access(path.join(root, p))
      return true
    } catch {
      return false
    }
  }

  const stacks: StackSignal[] = []
  const languages = new Set<string>()
  const entryPoints: EntryPoint[] = []
  const important: string[] = []
  const apiRoutes: string[] = []
  const packageScripts: string[] = []
  const verifiedRunCommands: VerifiedRunCommand[] = []
  const readmePaths: string[] = []

  const addEntry = (p: string, kind: string, reason: string) => {
    if (entryPoints.some((e) => e.path === p)) return
    entryPoints.push({ path: p, kind, reason })
    if (!important.includes(p)) important.push(p)
  }

  if (await has('pubspec.yaml')) {
    stacks.push('flutter')
    languages.add('dart')
    addEntry('pubspec.yaml', 'config', 'Flutter package manifest')
    if (await has('lib/main.dart')) addEntry('lib/main.dart', 'entry', 'Flutter app entry')
  }

  if ((await has('artisan')) && (await has('composer.json'))) {
    stacks.push('laravel')
    languages.add('php')
    addEntry('artisan', 'cli', 'Laravel CLI')
    addEntry('composer.json', 'config', 'PHP dependencies')
    if (await has('routes/web.php')) addEntry('routes/web.php', 'routes', 'Web routes')
  } else if (await has('composer.json')) {
    stacks.push('php')
    languages.add('php')
    addEntry('composer.json', 'config', 'PHP dependencies')
  }

  if (await has('package.json')) {
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as {
        main?: string
        module?: string
        scripts?: Record<string, string>
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      if (deps.next) stacks.push('nextjs')
      else if (deps.react || deps['react-dom']) stacks.push('react')
      else stacks.push('nodejs')
      languages.add('javascript')
      addEntry('package.json', 'config', 'Node package manifest')
      if (pkg.main) addEntry(pkg.main, 'entry', 'package.json main')
      if (pkg.module) addEntry(pkg.module, 'entry', 'package.json module')
      for (const [name, cmd] of Object.entries(pkg.scripts || {})) {
        packageScripts.push(`${name}: ${cmd}`)
        if (['start', 'dev', 'serve', 'develop'].includes(name)) {
          verifiedRunCommands.push({
            command: `npm run ${name}`,
            source: 'package.json',
            confidence: 'verified'
          })
        }
      }
    } catch {
      stacks.push('nodejs')
    }
  }

  if ((await has('pyproject.toml')) || (await has('requirements.txt')) || (await has('setup.py'))) {
    stacks.push('python')
    languages.add('python')
    if (await has('pyproject.toml')) addEntry('pyproject.toml', 'config', 'Python project')
    if (await has('requirements.txt')) addEntry('requirements.txt', 'config', 'Python deps')
    if (await has('main.py')) addEntry('main.py', 'entry', 'Python entry')
  }

  if (await has('go.mod')) {
    stacks.push('go')
    languages.add('go')
    addEntry('go.mod', 'config', 'Go module')
  }
  if (await has('Cargo.toml')) {
    stacks.push('rust')
    languages.add('rust')
    addEntry('Cargo.toml', 'config', 'Rust crate')
  }
  if ((await has('pom.xml')) || (await has('build.gradle')) || (await has('build.gradle.kts'))) {
    stacks.push('java')
    languages.add('java')
  }
  if ((await has('Dockerfile')) || (await has('docker-compose.yml')) || (await has('docker-compose.yaml'))) {
    stacks.push('docker')
    if (await has('Dockerfile')) addEntry('Dockerfile', 'config', 'Container build')
    if (await has('docker-compose.yml')) addEntry('docker-compose.yml', 'config', 'Compose services')
    if (await has('docker-compose.yaml')) addEntry('docker-compose.yaml', 'config', 'Compose services')
  }

  const manifests = await fg(['**/manifest.json'], {
    cwd: root,
    onlyFiles: true,
    absolute: false,
    suppressErrors: true,
    deep: 5
  })
  const extManifests = manifests.filter(
    (p) => !ignore.ignores(p) && (p.includes('extension') || p.includes('chrome') || p.includes('firefox'))
  )
  if (extManifests.length) {
    if (!stacks.includes('browser_extension')) stacks.push('browser_extension')
    languages.add('javascript')
    for (const m of extManifests.slice(0, 4)) {
      addEntry(m, 'manifest', 'Browser extension manifest')
      try {
        const raw = JSON.parse(await fs.readFile(path.join(root, m), 'utf8')) as {
          background?: { service_worker?: string; scripts?: string[] }
          action?: { default_popup?: string }
          browser_action?: { default_popup?: string }
        }
        const dir = path.posix.dirname(m)
        const sw = raw.background?.service_worker
        if (sw) addEntry(path.posix.join(dir, sw), 'service_worker', 'Extension background')
        for (const s of raw.background?.scripts || []) {
          addEntry(path.posix.join(dir, s), 'background', 'Extension background script')
        }
        const popup = raw.action?.default_popup || raw.browser_action?.default_popup
        if (popup) addEntry(path.posix.join(dir, popup), 'popup', 'Extension popup')
      } catch {
        // ignore bad manifest
      }
    }
  }

  const phpFiles = await fg(['**/*.php'], {
    cwd: root,
    onlyFiles: true,
    absolute: false,
    suppressErrors: true,
    deep: 6
  })
  const phpOk = phpFiles.filter((p) => !ignore.ignores(p)).slice(0, 200)
  if (phpOk.length && !stacks.includes('php') && !stacks.includes('laravel')) {
    stacks.push('php')
    languages.add('php')
  }
  for (const p of phpOk) {
    if (p.includes('/api/') || p.startsWith('api/')) {
      apiRoutes.push(p)
      if (important.length < 40) important.push(p)
    }
  }
  for (const candidate of [
    'backend/includes/config.php',
    'backend/includes/auth.php',
    'backend/includes/db.php',
    'backend/admin/index.php',
    'backend/api/auth/login.php',
    'backend/api/proxy/config.php',
    'backend/api/proxy/session.php',
    'index.php',
    'public/index.php'
  ]) {
    if (await has(candidate)) addEntry(candidate, 'php_entry', 'PHP entry/config')
  }

  const sqlFiles = await fg(['**/*.sql'], {
    cwd: root,
    onlyFiles: true,
    absolute: false,
    suppressErrors: true,
    deep: 5
  })
  if (sqlFiles.some((p) => !ignore.ignores(p))) {
    stacks.push('sql')
    languages.add('sql')
    for (const s of sqlFiles.filter((p) => !ignore.ignores(p)).slice(0, 3)) {
      addEntry(s, 'schema', 'Database schema')
    }
  }

  const readmes = await fg(['**/README.md', '**/readme.md', '**/CLIENT-INSTALL.txt'], {
    cwd: root,
    onlyFiles: true,
    absolute: false,
    suppressErrors: true,
    deep: 4
  })
  for (const r of readmes.filter((p) => !ignore.ignores(p)).slice(0, 8)) {
    readmePaths.push(r)
    addEntry(r, 'docs', 'Documentation')
    try {
      const text = await fs.readFile(path.join(root, r), 'utf8')
      for (const cmd of extractDocumentedCommands(text)) {
        verifiedRunCommands.push({ command: cmd, source: r, confidence: 'verified' })
      }
    } catch {
      // skip
    }
  }

  const files = await fg(['**/*'], {
    cwd: root,
    onlyFiles: true,
    absolute: false,
    suppressErrors: true,
    followSymbolicLinks: false
  })
  const filtered = files.filter((p) => !ignore.ignores(p) && !isBinary(p))
  const topFolders = summarizeFolders(filtered)

  // Prefer unique stacks
  const uniqueStacks = [...new Set(stacks)]

  return {
    root,
    builtAt: Date.now(),
    stacks: uniqueStacks.length ? uniqueStacks : [],
    languages: [...languages],
    topFolders,
    entryPoints: entryPoints.slice(0, 40),
    importantFiles: [...new Set(important)].slice(0, 50),
    apiRoutes: [...new Set(apiRoutes)].slice(0, 40),
    packageScripts: packageScripts.slice(0, 30),
    verifiedRunCommands: dedupeCommands(verifiedRunCommands).slice(0, 20),
    readmePaths,
    fileCount: filtered.length
  }
}

function extractDocumentedCommands(readme: string): string[] {
  const cmds: string[] = []
  const fence = /```(?:bash|sh|shell|zsh)?\n([\s\S]*?)```/gi
  let m: RegExpExecArray | null
  while ((m = fence.exec(readme))) {
    for (const line of m[1].split('\n')) {
      const t = line.replace(/^\s*\$\s*/, '').trim()
      if (/^(npm |pnpm |yarn |composer |php artisan |flutter |python |pip |docker |mysql )/i.test(t)) {
        cmds.push(t)
      }
    }
  }
  // Explicit "run:" style lines
  for (const line of readme.split('\n')) {
    const run = line.match(/^\s*(?:run|start|launch)\s*[:\-]\s*`?([^`\n]+)`?/i)
    if (run) cmds.push(run[1].trim())
  }
  return cmds
}

function dedupeCommands(items: VerifiedRunCommand[]): VerifiedRunCommand[] {
  const seen = new Set<string>()
  const out: VerifiedRunCommand[] = []
  for (const item of items) {
    const k = item.command.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(item)
  }
  return out
}

function summarizeFolders(files: string[]): string[] {
  const counts = new Map<string, number>()
  for (const f of files) {
    const top = f.split('/')[0]
    if (!top || top.startsWith('.')) continue
    counts.set(top, (counts.get(top) || 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, n]) => `${name}/ (${n} files)`)
}

function isBinary(filePath: string): boolean {
  return /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tar|bz2|7z|rar|exe|dll|so|dylib|wasm|mp4|mp3|woff2?|ttf|otf|class|o|a|pyc|db|sqlite)$/i.test(
    filePath
  )
}
