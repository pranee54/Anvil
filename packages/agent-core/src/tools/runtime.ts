import fs from 'fs/promises'
import path from 'path'
import fg from 'fast-glob'
import { createTwoFilesPatch } from 'diff'
import type { AppSettings, FileChange, IdeBridge, ToolCall, ToolResult } from '../types'
import { PathGuard } from '../repository/path-guard'
import { IgnoreEngine } from '../repository/ignore-engine'
import { ContextEngine } from '../context/context-engine'
import { runTerminalCommand } from '../terminal/runner'
import { gitDiff, gitStatus } from '../git/git'
import {
  canExposeToModel,
  classifyFileMutation,
  classifyShellCommand,
  isSecretPath
} from '../permissions/policy'

export type PermissionResolver = (prompt: {
  id: string
  toolName: string
  reason: string
  arguments: Record<string, unknown>
}) => Promise<boolean>

export type ChangeListener = (change: FileChange) => void

export class ToolRuntime {
  private ignore: IgnoreEngine
  private context: ContextEngine
  private pendingChanges = new Map<string, FileChange>()

  constructor(
    private guard: PathGuard,
    private settings: AppSettings,
    private resolvePermission: PermissionResolver,
    private onChange: ChangeListener,
    private providerIsLocal: boolean,
    private ide?: IdeBridge
  ) {
    this.ignore = new IgnoreEngine(guard.root)
    this.context = new ContextEngine(guard)
  }

  setIdeBridge(ide: IdeBridge | undefined): void {
    this.ide = ide
  }

  getChanges(): FileChange[] {
    return [...this.pendingChanges.values()]
  }

  updateSettings(settings: AppSettings, providerIsLocal: boolean): void {
    this.settings = settings
    this.providerIsLocal = providerIsLocal
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      await this.ignore.ensureLoaded()
      const output = await this.dispatch(call)
      return { toolCallId: call.id, name: call.name, ok: true, output }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.startsWith('PERMISSION_REQUIRED:')) {
        const reason = message.replace('PERMISSION_REQUIRED:', '').trim()
        return {
          toolCallId: call.id,
          name: call.name,
          ok: false,
          output: `Permission denied or not granted: ${reason}`,
          permissionRequired: true,
          permissionPrompt: reason
        }
      }
      return {
        toolCallId: call.id,
        name: call.name,
        ok: false,
        output: message
      }
    }
  }

  private async requireAsk(toolName: string, reason: string, args: Record<string, unknown>): Promise<void> {
    const allowed = await this.resolvePermission({
      id: callId(),
      toolName,
      reason,
      arguments: args
    })
    if (!allowed) throw new Error(`PERMISSION_REQUIRED:${reason}`)
  }

  private async dispatch(call: ToolCall): Promise<string> {
    const args = call.arguments
    switch (call.name) {
      case 'inspect_project':
        return this.inspectProject()
      case 'get_diagnostics':
        return this.getDiagnostics(
          args.path ? String(args.path) : undefined,
          args.severity ? String(args.severity) : undefined
        )
      case 'list_directory':
        return this.listDirectory(String(args.path ?? '.'))
      case 'search_files':
        return this.searchFiles(String(args.pattern ?? '**/*'), Number(args.maxResults ?? 50))
      case 'search_code':
        return this.searchCode({
          query: String(args.query ?? ''),
          glob: args.glob ? String(args.glob) : undefined,
          maxResults: Number(args.maxResults ?? 30),
          caseSensitive: Boolean(args.caseSensitive)
        })
      case 'read_file':
        return this.readFile(
          String(args.path),
          args.startLine ? Number(args.startLine) : undefined,
          args.endLine ? Number(args.endLine) : undefined
        )
      case 'create_file':
        return this.createFile(String(args.path), String(args.content ?? ''))
      case 'write_file':
        return this.writeFile(String(args.path), String(args.content ?? ''))
      case 'edit_file':
        return this.editFile(
          String(args.path),
          String(args.old_string ?? ''),
          String(args.new_string ?? ''),
          Boolean(args.replace_all)
        )
      case 'delete_file':
        return this.deleteFile(String(args.path))
      case 'run_terminal':
        return this.runTerminal(
          String(args.command),
          args.cwd ? String(args.cwd) : undefined,
          args.timeoutMs ? Number(args.timeoutMs) : undefined
        )
      case 'git_status':
        return gitStatus(this.guard.root)
      case 'git_diff':
        return gitDiff(
          this.guard.root,
          args.path ? String(args.path) : undefined,
          Boolean(args.staged)
        )
      default:
        throw new Error(`Unknown tool: ${call.name}`)
    }
  }

  private async inspectProject(): Promise<string> {
    const { getRepositoryMap } = await import('../repository/repo-map')
    const map = await getRepositoryMap(this.guard, this.ignore)
    const typeLabel = map.stacks.length ? map.stacks.join(', ') : 'unspecified'
    return [
      'INTERNAL PROJECT BRIEF (for the agent — do NOT paste this block or a file dump into the user-facing answer).',
      `Stacks (multi): ${typeLabel}`,
      `Languages: ${map.languages.join(', ') || 'mixed'}`,
      `Tracked source files: ~${map.fileCount}`,
      `Top-level areas:\n${map.topFolders.map((f) => `- ${f}`).join('\n')}`,
      `Entry points:\n${
        map.entryPoints.map((e) => `- ${e.path} (${e.kind}: ${e.reason})`).join('\n') || '- (none)'
      }`,
      `API routes:\n${map.apiRoutes.slice(0, 20).map((a) => `- ${a}`).join('\n') || '- (none)'}`,
      `Verified run commands:\n${
        map.verifiedRunCommands.map((c) => `- ${c.command} ← ${c.source}`).join('\n') ||
        '- none documented — do NOT invent php index.php / ports'
      }`,
      'Rules for the user-facing reply:',
      '- Explain verified capabilities from files you READ — not folder names alone.',
      '- Only list a few clickable important files (about 5–10 max).',
      '- For how-to-run: only verified commands. Otherwise say you have not found a documented startup command.',
      '- Never dump a repository file sample or "Detected type: unknown" into the chat.'
    ].join('\n')
  }

  private async getDiagnostics(pathFilter?: string, minSeverity?: string): Promise<string> {
    if (!this.ide?.getDiagnostics) {
      return 'No IDE diagnostics provider attached. Open the project in Anvil IDE / VS Code extension host.'
    }
    const order = { error: 0, warning: 1, info: 2, hint: 3 } as const
    const min = (minSeverity as keyof typeof order) || 'warning'
    const minRank = order[min] ?? 1
    let items = this.ide.getDiagnostics()
    if (pathFilter) {
      items = items.filter((d) => d.path === pathFilter || d.path.startsWith(pathFilter))
    }
    items = items.filter((d) => (order[d.severity] ?? 3) <= minRank)
    if (!items.length) return 'No diagnostics found.'
    return items
      .slice(0, 80)
      .map((d) => `${d.severity.toUpperCase()} ${d.path}:${d.line} ${d.message}${d.source ? ` (${d.source})` : ''}`)
      .join('\n')
  }

  private async listDirectory(relativePath: string): Promise<string> {
    const abs = this.guard.resolve(relativePath)
    const entries = await fs.readdir(abs, { withFileTypes: true })
    const lines: string[] = []
    for (const entry of entries) {
      const rel = path.posix.join(normalizeRel(relativePath), entry.name)
      if (this.ignore.ignores(rel)) continue
      lines.push(`${entry.isDirectory() ? 'dir ' : 'file'} ${rel}`)
    }
    return lines.sort().join('\n') || '(empty)'
  }

  private async searchFiles(pattern: string, maxResults: number): Promise<string> {
    const matches = await fg([pattern], {
      cwd: this.guard.root,
      onlyFiles: true,
      absolute: false,
      suppressErrors: true
    })
    const filtered = matches.filter((p) => !this.ignore.ignores(p)).slice(0, maxResults)
    return filtered.join('\n') || '(no matches)'
  }

  private async searchCode(opts: {
    query: string
    glob?: string
    maxResults: number
    caseSensitive: boolean
  }): Promise<string> {
    if (!opts.query) throw new Error('query is required')
    const files = await fg([opts.glob || '**/*'], {
      cwd: this.guard.root,
      onlyFiles: true,
      absolute: false,
      suppressErrors: true
    })
    const flags = opts.caseSensitive ? 'g' : 'gi'
    let regex: RegExp
    try {
      regex = new RegExp(opts.query, flags)
    } catch {
      regex = new RegExp(escapeRegex(opts.query), flags)
    }

    const hits: string[] = []
    for (const file of files) {
      if (this.ignore.ignores(file) || isSecretPath(file)) continue
      if (!canExposeToModel(file, this.settings, this.providerIsLocal)) continue
      let content: string
      try {
        content = await fs.readFile(this.guard.resolve(file), 'utf8')
      } catch {
        continue
      }
      if (content.includes('\u0000')) continue
      const lines = content.split(/\r?\n/)
      for (let i = 0; i < lines.length; i++) {
        if (!regex.test(lines[i])) continue
        regex.lastIndex = 0
        hits.push(`${file}:${i + 1}: ${lines[i].slice(0, 240)}`)
        if (hits.length >= opts.maxResults) {
          return hits.join('\n')
        }
      }
    }
    return hits.join('\n') || '(no matches)'
  }

  private async readFile(relativePath: string, startLine?: number, endLine?: number): Promise<string> {
    if (isSecretPath(relativePath) && !canExposeToModel(relativePath, this.settings, this.providerIsLocal)) {
      throw new Error('Refusing to send secret file to cloud model without permission')
    }
    const abs = this.guard.resolve(relativePath)
    const content = await fs.readFile(abs, 'utf8')
    if (content.includes('\u0000')) throw new Error('Binary file cannot be read as text')
    if (startLine == null && endLine == null) {
      const max = this.settings.context.maxFileBytes
      if (Buffer.byteLength(content, 'utf8') > max) {
        return `${content.slice(0, max)}\n\n...[truncated]`
      }
      return content
    }
    const lines = content.split(/\r?\n/)
    const start = Math.max(1, startLine ?? 1)
    const end = Math.min(lines.length, endLine ?? lines.length)
    return lines
      .slice(start - 1, end)
      .map((line, idx) => `${start + idx}| ${line}`)
      .join('\n')
  }

  private async createFile(relativePath: string, content: string): Promise<string> {
    const decision = classifyFileMutation('create_file', relativePath, this.settings)
    if (decision.level === 'deny') throw new Error(decision.reason || 'Denied')
    if (decision.level === 'ask') {
      await this.requireAsk('create_file', decision.reason || 'Create file?', { path: relativePath })
    }
    const abs = this.guard.resolve(relativePath)
    try {
      await fs.access(abs)
      throw new Error(`File already exists: ${relativePath}`)
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('File already exists')) throw err
    }
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content, 'utf8')
    this.recordChange({ path: relativePath, kind: 'added', after: content })
    return `Created ${relativePath}`
  }

  private async writeFile(relativePath: string, content: string): Promise<string> {
    const decision = classifyFileMutation('write_file', relativePath, this.settings)
    if (decision.level === 'deny') throw new Error(decision.reason || 'Denied')
    if (decision.level === 'ask') {
      await this.requireAsk('write_file', decision.reason || 'Write file?', { path: relativePath })
    }
    const abs = this.guard.resolve(relativePath)
    let before: string | undefined
    let kind: FileChange['kind'] = 'added'
    try {
      before = await fs.readFile(abs, 'utf8')
      kind = 'modified'
    } catch {
      await fs.mkdir(path.dirname(abs), { recursive: true })
    }
    await fs.writeFile(abs, content, 'utf8')
    this.recordChange({ path: relativePath, kind, before, after: content })
    return `Wrote ${relativePath}`
  }

  private async editFile(
    relativePath: string,
    oldString: string,
    newString: string,
    replaceAll: boolean
  ): Promise<string> {
    if (!oldString) throw new Error('old_string is required')
    const decision = classifyFileMutation('edit_file', relativePath, this.settings)
    if (decision.level === 'deny') throw new Error(decision.reason || 'Denied')
    if (decision.level === 'ask') {
      await this.requireAsk('edit_file', decision.reason || 'Edit file?', { path: relativePath })
    }
    const abs = this.guard.resolve(relativePath)
    const before = await fs.readFile(abs, 'utf8')
    if (!before.includes(oldString)) {
      throw new Error(`old_string not found in ${relativePath}`)
    }
    const after = replaceAll ? before.split(oldString).join(newString) : before.replace(oldString, newString)
    if (before === after) throw new Error('Edit produced no changes')
    await fs.writeFile(abs, after, 'utf8')
    this.recordChange({ path: relativePath, kind: 'modified', before, after })
    const patch = createTwoFilesPatch(relativePath, relativePath, before, after)
    return `Edited ${relativePath}\n${patch.slice(0, 8000)}`
  }

  private async deleteFile(relativePath: string): Promise<string> {
    const decision = classifyFileMutation('delete_file', relativePath, this.settings)
    if (decision.level === 'deny') throw new Error(decision.reason || 'Denied')
    await this.requireAsk('delete_file', decision.reason || 'Delete file?', { path: relativePath })
    const abs = this.guard.resolve(relativePath)
    const before = await fs.readFile(abs, 'utf8').catch(() => undefined)
    await fs.unlink(abs)
    this.recordChange({ path: relativePath, kind: 'deleted', before })
    return `Deleted ${relativePath}`
  }

  private async runTerminal(command: string, cwdRel?: string, timeoutMs?: number): Promise<string> {
    const decision = classifyShellCommand(command, this.settings)
    if (decision.level === 'deny') throw new Error(decision.reason || 'Denied')
    if (decision.level === 'ask') {
      await this.requireAsk('run_terminal', decision.reason || 'Run command?', { command, cwd: cwdRel })
    }
    const cwd = cwdRel ? this.guard.resolve(cwdRel) : this.guard.root
    const result = await runTerminalCommand({ command, cwd, timeoutMs })
    const output = [
      `$ ${command}`,
      `cwd: ${cwd}`,
      `exit: ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}`,
      result.stdout ? `stdout:\n${result.stdout}` : '',
      result.stderr ? `stderr:\n${result.stderr}` : ''
    ]
      .filter(Boolean)
      .join('\n')
    this.ide?.onTerminalCommand?.(command, output)
    return output
  }

  private recordChange(change: FileChange): void {
    const existing = this.pendingChanges.get(change.path)
    const merged: FileChange = {
      ...change,
      before: existing?.before ?? change.before,
      after: change.after,
      kind: existing?.kind === 'added' && change.kind === 'modified' ? 'added' : change.kind,
      accepted: false,
      rejected: false
    }
    this.pendingChanges.set(change.path, merged)
    this.onChange(merged)
  }

  async applyChange(relativePath: string): Promise<void> {
    const change = this.pendingChanges.get(relativePath)
    if (!change) return
    change.accepted = true
    change.rejected = false
    this.pendingChanges.set(relativePath, change)
    this.onChange(change)
  }

  async rejectChange(relativePath: string): Promise<void> {
    const change = this.pendingChanges.get(relativePath)
    if (!change) return
    const abs = this.guard.resolve(relativePath)
    if (change.kind === 'added') {
      await fs.unlink(abs).catch(() => undefined)
    } else if (change.kind === 'deleted' && change.before != null) {
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, change.before, 'utf8')
    } else if (change.before != null) {
      await fs.writeFile(abs, change.before, 'utf8')
    }
    change.rejected = true
    change.accepted = false
    this.pendingChanges.set(relativePath, change)
    this.onChange(change)
  }

  async revertChange(relativePath: string): Promise<void> {
    await this.rejectChange(relativePath)
  }
}

function normalizeRel(p: string): string {
  if (!p || p === '.') return ''
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function callId(): string {
  return `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}
