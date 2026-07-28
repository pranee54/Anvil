import fs from 'fs/promises'
import path from 'path'
import fg from 'fast-glob'
import type { PathGuard } from '../repository/path-guard'
import type { IgnoreEngine } from '../repository/ignore-engine'
import {
  getRepositoryMap,
  type RepositoryMap,
  type VerifiedRunCommand
} from '../repository/repo-map'
import { classifyQuery, type ClassifiedQuery, type QueryIntent } from '../context/query-intent'
import { canExposeToModel, isSecretPath } from '../permissions/policy'
import type { AppSettings } from '../types'

export type EvidenceItem = {
  claim: string
  path: string
  startLine?: number
  endLine?: number
  confidence: 'verified' | 'likely'
}

export type InvestigationBrief = {
  intent: QueryIntent
  classified: ClassifiedQuery
  map: RepositoryMap
  filesRead: string[]
  evidence: EvidenceItem[]
  excerpts: Array<{ path: string; content: string }>
  searchHits: string[]
  verifiedRunCommands: VerifiedRunCommand[]
  /** Compact text injected into the model context (not shown raw to users). */
  modelContext: string
  activityLabels: string[]
}

const HOW_TO_USE_READS = [
  'README.md',
  'INSTALL.md',
  'GETTING_STARTED.md',
  'extension/CLIENT-INSTALL.txt',
  'extension/README.md',
  'extension/chrome/README.md',
  'extension/firefox/README.md',
  'extension/chrome/manifest.json',
  'extension/firefox/manifest.json',
  'package.json',
  'composer.json',
  'docker-compose.yml',
  'docker-compose.yaml',
  'Dockerfile',
  'backend/includes/config.php',
  'backend/sql/schema.sql',
  'extension/build-client.sh',
  'extension/sync-to-firefox.sh'
]

const CAPABILITY_READS = [
  'extension/CLIENT-INSTALL.txt',
  'extension/README.md',
  'extension/chrome/README.md',
  'extension/chrome/manifest.json',
  'extension/firefox/manifest.json',
  'extension/README.md',
  'extension/chrome/README.md',
  'backend/includes/config.php',
  'backend/includes/auth.php',
  'backend/api/auth/login.php',
  'backend/api/proxy/config.php',
  'backend/api/proxy/session.php',
  'backend/api/profile/config.php',
  'backend/api/usage/report.php',
  'backend/admin/index.php',
  'backend/sql/schema.sql',
  'extension/CLIENT-INSTALL.txt'
]

const PROXY_FLOW_READS = [
  'extension/chrome/manifest.json',
  'extension/chrome/background.js',
  'backend/api/proxy/config.php',
  'backend/api/proxy/session.php',
  'backend/includes/proxy_providers.php',
  'backend/includes/auth.php'
]

const LOGIN_FLOW_READS = [
  'backend/api/auth/login.php',
  'backend/includes/auth.php',
  'extension/chrome/background.js',
  'backend/api/auth/logout.php'
]

export async function investigateRepository(options: {
  guard: PathGuard
  ignore: IgnoreEngine
  message: string
  history?: Array<{ role: string; content: string }>
  settings: AppSettings
  providerIsLocal: boolean
  maxFiles?: number
  maxCharsPerFile?: number
}): Promise<InvestigationBrief> {
  const {
    guard,
    ignore,
    message,
    history,
    settings,
    providerIsLocal,
    maxFiles = 10,
    maxCharsPerFile = 5_000
  } = options

  const historyHint = (history || [])
    .slice(-4)
    .map((t) => t.content)
    .join('\n')
    .slice(0, 4_000)

  const classified = classifyQuery(message, historyHint)
  const map = await getRepositoryMap(guard, ignore)
  const activityLabels: string[] = ['Understanding project']

  const filesToRead = pickFilesToRead(classified, map, maxFiles)
  const evidence: EvidenceItem[] = []
  const excerpts: Array<{ path: string; content: string }> = []
  const filesRead: string[] = []

  for (const file of filesToRead) {
    if (isSecretPath(file) && !canExposeToModel(file, settings, providerIsLocal)) continue
    try {
      const abs = guard.resolve(file)
      const full = await fs.readFile(abs, 'utf8')
      if (full.includes('\u0000')) continue
      // Evidence from a larger sample so truncation cannot hide key API calls
      evidence.push(...deriveEvidence(file, full.slice(0, 80_000)))
      let content = full
      if (file.endsWith('background.js') || content.length > maxCharsPerFile * 2) {
        content = extractRelevantSlices(content, classified.searchHints, maxCharsPerFile)
      } else if (content.length > maxCharsPerFile) {
        content = `${content.slice(0, maxCharsPerFile)}\n\n...[truncated]`
      }
      filesRead.push(file)
      excerpts.push({ path: file, content })
      activityLabels.push(activityLabelFor(file))
    } catch {
      // missing file — skip
    }
  }

  const searchHits: string[] = []
  if (classified.searchHints.length) {
    activityLabels.push('Searching implementation')
    for (const hint of classified.searchHints.slice(0, 4)) {
      const hits = await lexicalSearch(guard, ignore, hint, settings, providerIsLocal, 8)
      searchHits.push(...hits)
    }
  }

  // Follow search hits into extra reads if budget remains
  for (const hit of searchHits) {
    if (filesRead.length >= maxFiles) break
    const file = hit.split(':')[0]
    if (!file || filesRead.includes(file)) continue
    try {
      const abs = guard.resolve(file)
      let content = await fs.readFile(abs, 'utf8')
      if (content.includes('\u0000')) continue
      content =
        file.endsWith('.js') || content.length > maxCharsPerFile
          ? extractRelevantSlices(content, classified.searchHints, maxCharsPerFile)
          : content.slice(0, maxCharsPerFile)
      filesRead.push(file)
      excerpts.push({ path: file, content })
      evidence.push(...deriveEvidence(file, content))
    } catch {
      // skip
    }
  }

  const modelContext = formatBrief({
    classified,
    map,
    filesRead,
    excerpts,
    searchHits: [...new Set(searchHits)].slice(0, 24),
    verifiedRunCommands: map.verifiedRunCommands,
    evidence
  })

  return {
    intent: classified.intent,
    classified,
    map,
    filesRead,
    evidence,
    excerpts,
    searchHits: [...new Set(searchHits)].slice(0, 24),
    verifiedRunCommands: map.verifiedRunCommands,
    modelContext,
    activityLabels: [...new Set(activityLabels)]
  }
}

function pickFilesToRead(classified: ClassifiedQuery, map: RepositoryMap, maxFiles: number): string[] {
  const selected: string[] = []
  const add = (p: string | undefined) => {
    if (!p || selected.includes(p)) return
    if (selected.length >= maxFiles) return
    selected.push(p)
  }

  for (const r of map.readmePaths.slice(0, 3)) add(r)

  const intent = classified.intent
  if (intent === 'HOW_TO_USE_PROJECT' || intent === 'HOW_TO_RUN') {
    for (const p of HOW_TO_USE_READS) add(p)
    for (const r of map.readmePaths) add(r)
    for (const e of map.entryPoints) {
      if (e.kind === 'docs' || e.kind === 'manifest' || e.kind === 'config') add(e.path)
    }
  } else if (intent === 'CAPABILITIES' || intent === 'GENERAL_PROJECT') {
    for (const p of CAPABILITY_READS) add(p)
    for (const e of map.entryPoints) add(e.path)
    for (const a of map.apiRoutes.slice(0, 8)) add(a)
  } else if (
    intent === 'LOCATE_FEATURE' ||
    intent === 'FOLLOW_UP' ||
    intent === 'SECURITY' ||
    intent === 'EXPLAIN_CODE'
  ) {
    const blob = classified.searchHints.join(' ')
    if (/proxy|session|chrome/.test(blob)) {
      for (const p of PROXY_FLOW_READS) add(p)
    }
    if (/login|auth|jwt|password|security/.test(blob) || intent === 'SECURITY') {
      for (const p of LOGIN_FLOW_READS) add(p)
    }
    for (const e of map.entryPoints) add(e.path)
    for (const a of map.apiRoutes) {
      if (classified.searchHints.some((h: string) => a.toLowerCase().includes(h.toLowerCase()))) add(a)
    }
  } else {
    for (const e of map.entryPoints.slice(0, 8)) add(e.path)
    for (const p of map.importantFiles.slice(0, 6)) add(p)
  }

  // Always include manifests / schema if present in map
  for (const e of map.entryPoints) {
    if (e.kind === 'manifest' || e.kind === 'schema' || e.kind === 'php_entry') add(e.path)
  }

  return selected.slice(0, maxFiles)
}

function activityLabelFor(file: string): string {
  if (file.includes('manifest')) return 'Reading extension manifest'
  if (file.includes('proxy')) return 'Tracing proxy session API'
  if (file.includes('login') || file.includes('auth')) return 'Reading authentication'
  if (file.includes('background')) return 'Reading extension background'
  if (file.includes('schema')) return 'Reading database schema'
  if (file.toLowerCase().includes('readme')) return 'Reading documentation'
  return `Reading ${path.posix.basename(file)}`
}

function deriveEvidence(file: string, content: string): EvidenceItem[] {
  const items: EvidenceItem[] = []
  const lower = content.toLowerCase()
  const push = (claim: string, confidence: 'verified' | 'likely' = 'verified') => {
    items.push({ claim, path: file, confidence })
  }

  if (file.endsWith('manifest.json')) {
    push('Browser extension manifest defines permissions and background entry')
    if (/proxy/i.test(content)) push('Extension requests browser proxy permission')
  }
  if (file.includes('proxy/session.php')) {
    push('Backend records proxy session start/end events')
  }
  if (file.includes('proxy/config.php')) {
    push('Backend serves allocated proxy configuration to authenticated clients')
  }
  if (file.includes('auth/login.php')) {
    push('Backend login endpoint authenticates users and returns a token')
  }
  if (file.includes('background.js')) {
    if (/auth\/login\.php/.test(content)) push('Extension calls backend login API')
    if (/proxy\/config\.php/.test(content)) push('Extension fetches proxy config from backend')
    if (/proxy\/session\.php/.test(content)) push('Extension reports proxy sessions to backend')
    if (/chrome\.proxy/.test(content)) push('Extension applies browser proxy settings via chrome.proxy')
  }
  if (file.includes('schema.sql')) {
    if (/proxy_sessions/.test(lower)) push('Database stores proxy session rows')
    if (/users/.test(lower)) push('Database has users table')
  }
  if (file.includes('admin/')) {
    push('Admin UI exists for management tasks')
  }
  if (file.includes('usage/') || file.includes('telemetry/')) {
    push('Usage/telemetry reporting endpoints exist')
  }
  if (file.includes('profile/config')) {
    push('Fingerprint/profile configuration is served to clients')
  }
  return items
}

function extractRelevantSlices(content: string, hints: string[], maxChars: number): string {
  const lines = content.split(/\r?\n/)
  const forced = [
    ...hints,
    'auth/login',
    'proxy/config',
    'proxy/session',
    'chrome.proxy',
    'Authorization',
    'Bearer',
    'fetchProxyConfig',
    'logProxySession',
    'applyProxy'
  ]
  const re = new RegExp([...new Set(forced)].map(escapeRegex).filter(Boolean).join('|'), 'i')
  const windows: string[] = []
  let used = 0
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i])) continue
    const start = Math.max(0, i - 8)
    const end = Math.min(lines.length, i + 24)
    const slice = lines
      .slice(start, end)
      .map((l, idx) => `${start + idx + 1}| ${l}`)
      .join('\n')
    if (used + slice.length > maxChars) break
    windows.push(`--- lines ${start + 1}-${end} ---\n${slice}`)
    used += slice.length
    i = end
  }
  if (!windows.length) {
    return content.slice(0, maxChars)
  }
  return windows.join('\n\n').slice(0, maxChars)
}

async function lexicalSearch(
  guard: PathGuard,
  ignore: IgnoreEngine,
  query: string,
  settings: AppSettings,
  providerIsLocal: boolean,
  maxResults: number
): Promise<string[]> {
  await ignore.ensureLoaded()
  const files = await fg(['**/*.{js,ts,tsx,php,json,md,sql}'], {
    cwd: guard.root,
    onlyFiles: true,
    absolute: false,
    suppressErrors: true,
    deep: 6
  })
  let regex: RegExp
  try {
    regex = new RegExp(query, 'i')
  } catch {
    regex = new RegExp(escapeRegex(query), 'i')
  }
  const hits: string[] = []
  for (const file of files) {
    if (ignore.ignores(file) || isSecretPath(file)) continue
    if (!canExposeToModel(file, settings, providerIsLocal)) continue
    let content: string
    try {
      content = await fs.readFile(guard.resolve(file), 'utf8')
    } catch {
      continue
    }
    if (content.includes('\u0000')) continue
    const lines = content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (!regex.test(lines[i])) continue
      regex.lastIndex = 0
      hits.push(`${file}:${i + 1}: ${lines[i].trim().slice(0, 160)}`)
      if (hits.length >= maxResults) return hits
    }
  }
  return hits
}

function formatBrief(input: {
  classified: ClassifiedQuery
  map: RepositoryMap
  filesRead: string[]
  excerpts: Array<{ path: string; content: string }>
  searchHits: string[]
  verifiedRunCommands: VerifiedRunCommand[]
  evidence: EvidenceItem[]
}): string {
  const { classified, map, filesRead, excerpts, searchHits, verifiedRunCommands, evidence } = input
  const stacks = map.stacks.length ? map.stacks.join(', ') : 'unspecified (multi-folder workspace)'
  const runBlock =
    verifiedRunCommands.length > 0
      ? verifiedRunCommands.map((c) => `- VERIFIED from ${c.source}: \`${c.command}\``).join('\n')
      : '- No documented startup command found in README/package scripts. Do NOT invent php index.php, ports, or npm start.'

  return [
    'INTERNAL INVESTIGATION BRIEF (ground truth from files already read — do NOT dump this block to the user).',
    `User intent: ${classified.intent} (${classified.reason})`,
    `Stacks detected (may be multiple): ${stacks}`,
    `Languages: ${map.languages.join(', ') || 'mixed'}`,
    `Top folders: ${map.topFolders.join('; ')}`,
    `Entry points: ${map.entryPoints.map((e) => `${e.path} [${e.kind}]`).join('; ') || '(none)'}`,
    `API routes found: ${map.apiRoutes.slice(0, 15).join(', ') || '(none)'}`,
    `Files read (${filesRead.length}): ${filesRead.join(', ')}`,
    '',
    'Verified evidence claims:',
    ...(evidence.length
      ? evidence.map((e) => `- [${e.confidence}] ${e.claim} ← ${e.path}`)
      : ['- (limited — answer cautiously)']),
    '',
    'Startup / run commands:',
    runBlock,
    '',
    'Search hits (file:line: snippet):',
    searchHits.length ? searchHits.join('\n') : '(none)',
    '',
    'File excerpts:',
    ...excerpts.map((e) => `### ${e.path}\n\`\`\`\n${e.content}\n\`\`\``),
    '',
    'ANSWER RULES:',
    '- Answer the user intent using ONLY verified evidence above.',
    '- Prefer capability / flow explanation over workspace path narration.',
    '- Never mention AGENTS.md absence, htdocs, or absolute filesystem paths unless asked.',
    '- Never invent run commands or ports. If none verified, say you have not found a documented startup command.',
    '- Cite workspace-relative file paths (clickable). Optionally end with Sources: N files.',
    '- Use Verified vs Likely wording when uncertain.',
    '- You may use flow lines (Name\\n↓\\nName) when the flow is verified.'
  ].join('\n')
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
