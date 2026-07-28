import * as fs from 'fs/promises'
import * as path from 'path'
import * as vscode from 'vscode'

export type ContextKind = 'file' | 'selection' | 'codebase' | 'problems' | 'folder' | 'git' | 'terminal'

export interface ContextAttachment {
  id: string
  kind: ContextKind
  label: string
  /** Injected into the agent prompt */
  content: string
}

export async function pickContextAttachment(): Promise<ContextAttachment | null> {
  type CtxItem = vscode.QuickPickItem & { contextKind: ContextKind }
  const picked = await vscode.window.showQuickPick<CtxItem>(
    [
      { label: '@file', description: 'Attach a workspace file', contextKind: 'file' },
      { label: '@selection', description: 'Attach current selection', contextKind: 'selection' },
      { label: '@codebase', description: 'Instruct agent to explore the repo', contextKind: 'codebase' },
      { label: '@problems', description: 'Attach current diagnostics', contextKind: 'problems' },
      { label: '@folder', description: 'Attach a folder listing', contextKind: 'folder' },
      { label: '@git', description: 'Instruct agent to inspect git', contextKind: 'git' }
    ],
    { placeHolder: 'Attach context' }
  )
  if (!picked) return null

  switch (picked.contextKind) {
    case 'file':
      return attachFile()
    case 'selection':
      return attachSelection()
    case 'codebase':
      return {
        id: `codebase_${Date.now()}`,
        kind: 'codebase',
        label: '@codebase',
        content: 'User attached @codebase — use inspect_project / search_files / search_code / read_file.'
      }
    case 'problems':
      return attachProblems()
    case 'folder':
      return attachFolder()
    case 'git':
      return {
        id: `git_${Date.now()}`,
        kind: 'git',
        label: '@git',
        content: 'User attached @git — use git_status and git_diff tools.'
      }
    default:
      return null
  }
}

async function attachFile(): Promise<ContextAttachment | null> {
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: 'Attach',
    defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri
  })
  if (!uris?.[0]) return null
  const uri = uris[0]
  const rel = vscode.workspace.asRelativePath(uri)
  const bytes = await vscode.workspace.fs.readFile(uri)
  const text = Buffer.from(bytes).toString('utf8').slice(0, 12_000)
  return {
    id: `file_${rel}_${Date.now()}`,
    kind: 'file',
    label: rel,
    content: `@file ${rel}\n\`\`\`\n${text}\n\`\`\``
  }
}

function attachSelection(): ContextAttachment | null {
  const editor = vscode.window.activeTextEditor
  if (!editor || editor.selection.isEmpty) {
    void vscode.window.showWarningMessage('No selection in the active editor.')
    return null
  }
  const rel = vscode.workspace.asRelativePath(editor.document.uri)
  const text = editor.document.getText(editor.selection).slice(0, 8000)
  return {
    id: `sel_${Date.now()}`,
    kind: 'selection',
    label: `${rel}:${editor.selection.start.line + 1}`,
    content: `@selection ${rel}\n\`\`\`\n${text}\n\`\`\``
  }
}

function attachProblems(): ContextAttachment {
  const lines = collectDiagnostics(40)
  return {
    id: `problems_${Date.now()}`,
    kind: 'problems',
    label: `@problems (${lines.length})`,
    content:
      lines.length === 0
        ? '@problems — no diagnostics.'
        : `@problems\n${lines.map((l) => `- ${l}`).join('\n')}`
  }
}

async function attachFolder(): Promise<ContextAttachment | null> {
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (!folder) return null
  const rel = await vscode.window.showInputBox({
    prompt: 'Relative folder path',
    value: 'src'
  })
  if (rel == null) return null
  const abs = path.join(folder.uri.fsPath, rel)
  let entries: string[] = []
  try {
    entries = (await fs.readdir(abs)).slice(0, 80)
  } catch {
    void vscode.window.showErrorMessage(`Cannot read folder: ${rel}`)
    return null
  }
  return {
    id: `folder_${rel}_${Date.now()}`,
    kind: 'folder',
    label: `${rel}/`,
    content: `@folder ${rel}\n${entries.map((e) => `- ${e}`).join('\n')}`
  }
}

export function collectDiagnostics(limit = 40): string[] {
  const out: string[] = []
  for (const [uri, diags] of vscode.languages.getDiagnostics()) {
    for (const d of diags) {
      if (d.severity > vscode.DiagnosticSeverity.Warning) continue
      const sev =
        d.severity === vscode.DiagnosticSeverity.Error
          ? 'error'
          : d.severity === vscode.DiagnosticSeverity.Warning
            ? 'warning'
            : 'info'
      out.push(
        `${sev} ${vscode.workspace.asRelativePath(uri)}:${d.range.start.line + 1} ${d.message}`
      )
      if (out.length >= limit) return out
    }
  }
  return out
}

export function buildIdeBridgeDiagnostics(): Array<{
  path: string
  line: number
  severity: 'error' | 'warning' | 'info' | 'hint'
  message: string
  source?: string
}> {
  const items: Array<{
    path: string
    line: number
    severity: 'error' | 'warning' | 'info' | 'hint'
    message: string
    source?: string
  }> = []
  for (const [uri, diags] of vscode.languages.getDiagnostics()) {
    for (const d of diags) {
      const severity =
        d.severity === vscode.DiagnosticSeverity.Error
          ? 'error'
          : d.severity === vscode.DiagnosticSeverity.Warning
            ? 'warning'
            : d.severity === vscode.DiagnosticSeverity.Information
              ? 'info'
              : 'hint'
      items.push({
        path: vscode.workspace.asRelativePath(uri),
        line: d.range.start.line + 1,
        severity,
        message: d.message,
        source: d.source
      })
    }
  }
  return items
}

export async function enrichPrompt(
  message: string,
  attachments: ContextAttachment[]
): Promise<string> {
  const parts = [message]
  if (attachments.length) {
    parts.push('', '--- Attached context ---')
    for (const a of attachments) parts.push(a.content)
  }

  parts.push('', '--- IDE context ---')
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (folder) parts.push(`Workspace: ${folder.uri.fsPath}`)

  const editor = vscode.window.activeTextEditor
  if (editor) {
    parts.push(`Open file: ${vscode.workspace.asRelativePath(editor.document.uri)}`)
    parts.push(`Caret: line ${editor.selection.active.line + 1}`)
  }

  const tabs = vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .map((t) => {
      const input = t.input as { uri?: vscode.Uri } | undefined
      return input?.uri ? vscode.workspace.asRelativePath(input.uri) : null
    })
    .filter(Boolean)
    .slice(0, 12)
  if (tabs.length) parts.push(`Open tabs: ${tabs.join(', ')}`)

  if (/@problems\b/i.test(message) && !attachments.some((a) => a.kind === 'problems')) {
    parts.push(attachProblems().content)
  }
  if (/@codebase\b/i.test(message)) {
    parts.push('User referenced @codebase — explore with tools.')
  }
  if (/@git\b/i.test(message)) {
    parts.push('User referenced @git — use git_status / git_diff.')
  }
  if (/@selection\b/i.test(message) && editor && !editor.selection.isEmpty) {
    const sel = attachSelection()
    if (sel) parts.push(sel.content)
  }

  return parts.join('\n')
}
