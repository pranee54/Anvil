import type { SourceReference, VerifiedInstruction } from './evidence-types'

/**
 * Extract ordered setup/use instructions from documentation text.
 * Deterministic — no model.
 */
export function extractDocInstructions(
  path: string,
  content: string
): { instructions: VerifiedInstruction[]; commands: Array<{ command: string; line: number }>; urls: string[] } {
  const lines = content.split(/\r?\n/)
  const instructions: VerifiedInstruction[] = []
  const commands: Array<{ command: string; line: number }> = []
  const urls: string[] = []
  let section = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const n = i + 1

    const heading =
      line.match(/^#{1,3}\s+(.+)/)?.[1] ||
      line.match(/^([A-Z][A-Z0-9 /()_.-]{3,})\s*$/)?.[1] ||
      line.match(/^─{3,}|^═{3,}/)
        ? section
        : null

    if (/^#{1,3}\s+/.test(line)) {
      section = line.replace(/^#{1,3}\s+/, '').trim()
    } else if (/^[A-Z][A-Z0-9 /()_.-]{4,}$/.test(line.trim()) && line.trim().length < 60) {
      section = line.trim()
    }

    // Numbered steps
    const step = line.match(/^\s*(\d+)[.)]\s+(.+)/)
    if (step) {
      const action = step[2].replace(/`([^`]+)`/g, '$1').trim()
      if (action.length > 3) {
        instructions.push({
          action,
          section: section || undefined,
          evidence: [{ path, startLine: n, endLine: n, excerpt: line.trim() }]
        })
      }
    }

    // Bullet requirements that look like instructions
    const bullet = line.match(/^\s*[-*•]\s+(.+)/)
    if (bullet && /\b(load|open|enable|select|click|run|install|require|turn on|unzip)\b/i.test(bullet[1])) {
      instructions.push({
        action: bullet[1].trim(),
        section: section || undefined,
        evidence: [{ path, startLine: n, endLine: n, excerpt: line.trim() }]
      })
    }

    // Inline paths like chrome://extensions
    if (/chrome:\/\/|about:debugging|example\.com/i.test(line)) {
      const found = line.match(/(chrome:\/\/[^\s`]+|about:debugging[^\s`]*|https?:\/\/[^\s)`]+)/gi) || []
      urls.push(...found)
    }

    // Commands in backticks or code fence body (tracked separately)
    const cmdInline = line.match(/`((?:\.\/)?[\w./-]+(?:\s+[\w./"-]+)*)`/)
    if (cmdInline && /^(npm |pnpm |yarn |composer |flutter |docker |\.\/|php |node |mysql )/i.test(cmdInline[1])) {
      commands.push({ command: cmdInline[1], line: n })
    }
  }

  // Fenced code blocks
  const fence = /```(?:bash|sh|shell|zsh)?\n([\s\S]*?)```/gi
  let m: RegExpExecArray | null
  while ((m = fence.exec(content))) {
    const blockStart = content.slice(0, m.index).split(/\n/).length
    for (const raw of m[1].split('\n')) {
      const t = raw.replace(/^\s*\$\s*/, '').trim()
      if (!t || t.startsWith('#')) continue
      if (/^(npm |pnpm |yarn |composer |flutter |docker |\.\/|php |node |mysql |sync-to-firefox)/i.test(t)) {
        commands.push({ command: t, line: blockStart })
      }
    }
  }

  return {
    instructions: dedupeInstructions(instructions),
    commands: dedupeCommands(commands),
    urls: [...new Set(urls)]
  }
}

function dedupeInstructions(items: VerifiedInstruction[]): VerifiedInstruction[] {
  const seen = new Set<string>()
  const out: VerifiedInstruction[] = []
  for (const item of items) {
    const k = item.action.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(item)
  }
  return out
}

function dedupeCommands(items: Array<{ command: string; line: number }>): Array<{ command: string; line: number }> {
  const seen = new Set<string>()
  const out: Array<{ command: string; line: number }> = []
  for (const item of items) {
    const k = item.command.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(item)
  }
  return out
}

export function sourceKey(ref: SourceReference): string {
  return ref.path
}
