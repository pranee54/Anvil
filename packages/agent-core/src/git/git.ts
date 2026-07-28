import { runTerminalCommand } from '../terminal/runner'

export async function gitStatus(cwd: string): Promise<string> {
  const result = await runTerminalCommand({ command: 'git status --short --branch', cwd, timeoutMs: 15_000 })
  if (result.exitCode !== 0) {
    return result.stderr || result.stdout || 'Not a git repository or git failed'
  }
  return result.stdout || '(clean)'
}

export async function gitDiff(cwd: string, filePath?: string, staged = false): Promise<string> {
  const parts = ['git', 'diff']
  if (staged) parts.push('--staged')
  if (filePath) parts.push('--', quote(filePath))
  const result = await runTerminalCommand({
    command: parts.join(' '),
    cwd,
    timeoutMs: 30_000
  })
  if (result.exitCode !== 0) {
    return result.stderr || result.stdout || 'git diff failed'
  }
  return result.stdout || '(no diff)'
}

function quote(value: string): string {
  if (/^[a-zA-Z0-9_./@-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'\\''`)}'`
}
