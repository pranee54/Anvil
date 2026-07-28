import { sanitizeAssistantText } from '@anvil/agent-core'

const NOISE_LINE =
  /^(Detected type:|Project root:|No AGENTS\.md|AGENTS\.md instructions:|File sample \(|INTERNAL PROJECT BRIEF|Tracked source files:|Likely important paths|Top-level areas:|Detected stack hint:|Rules for the user-facing)/i

/** Strip agent-internal metadata the model sometimes echoes into answers. */
export function sanitizeUserFacingAnswer(text: string): string {
  let out = sanitizeAssistantText(text || '')
  out = out
    .split('\n')
    .filter((line) => !NOISE_LINE.test(line.trim()))
    .join('\n')
  out = out.replace(/File sample \(\d+\s+of\s+\d+\):[\s\S]*?(?=\n\n[A-Z]|\n#|$)/gi, '')
  out = out.replace(/No AGENTS\.md found\.?/gi, '')
  out = out.replace(/Detected type:\s*unknown/gi, '')
  out = out.replace(/Project root:\s*.+/gi, '')
  // Strip common unverified invented startup claims unless we can't prove — remove absolute-path narration
  out = out.replace(/^[^\n]*(?:\/Applications\/XAMPP|htdocs)[^\n]*$/gim, '')
  out = out.replace(
    /\bphp\s+index\.php\b[^.!\n]*(?:port\s*80)?[^.!\n]*[.!]?/gi,
    'I haven\'t found a documented startup command yet.'
  )
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

export function toolLifecycleKey(card: {
  title?: string
  path?: string
  command?: string
  category?: string
  detail?: string
}): string {
  const title = (card.title || '').toLowerCase()
  if (
    /understanding project|inspect(ing)? project|project analyzed|inspection failed|analyzing project/.test(
      title
    )
  ) {
    return 'inspect_project'
  }
  if (/search(ing)?/.test(title)) {
    return `search:${(card.detail || '').slice(0, 80)}`
  }
  if (/checking problems|diagnostics/.test(title)) {
    return `diagnostics:${card.path || 'workspace'}`
  }
  if (/git status|git diff|checking git|reading git/.test(title)) {
    return `git:${title.includes('diff') ? 'diff' : 'status'}:${card.path || ''}`
  }
  if (/reading |tracing |understanding /.test(title) && !card.path) {
    return `read:${normalizeTitle(card.title || '')}`
  }
  if (card.path) {
    const kind = /edit|edited|write|creat/.test(title) ? 'edit' : /list|folder/.test(title) ? 'list' : 'read'
    return `${kind}:${card.path}`
  }
  if (card.command) return `terminal:${card.command}`
  return `status:${normalizeTitle(card.title || '')}`
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/^(✓|✕|▸)\s*/, '')
    .trim()
}

/** Never surface internal tool payloads (briefs, JSON args) in the default chat UI. */
export function safeExpandable(text: string | undefined): string | undefined {
  if (!text?.trim()) return undefined
  if (/INTERNAL PROJECT BRIEF|File sample \(|"arguments"\s*:/.test(text)) return undefined
  return text
}

export function isTerminalResultTitle(title: string): boolean {
  const t = title.toLowerCase()
  return (
    t.includes('analyzed') ||
    t.includes('completed') ||
    t.includes('failed') ||
    t === 'done' ||
    t.startsWith('edited') ||
    t.includes('no issues')
  )
}
