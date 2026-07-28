import * as vscode from 'vscode'
import type { FileChange } from '@anvil/agent-core'

/**
 * Opens a native VS Code diff for a proposed change.
 * Left = original (checkpoint), Right = current disk (Anvil edit).
 */
export async function showNativeDiff(
  workspaceRoot: vscode.Uri,
  change: FileChange
): Promise<void> {
  const right = vscode.Uri.joinPath(workspaceRoot, change.path)
  const leftScheme = 'anvil-original'
  const left = vscode.Uri.from({
    scheme: leftScheme,
    path: `/${change.path}`,
    query: encodeURIComponent(change.before ?? '')
  })

  await vscode.commands.executeCommand(
    'vscode.diff',
    left,
    right,
    `Anvil: ${change.path} (original ↔ proposed)`
  )
}

export function registerOriginalContentProvider(
  context: vscode.ExtensionContext
): void {
  const provider = new (class implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(uri: vscode.Uri): string {
      try {
        return decodeURIComponent(uri.query || '')
      } catch {
        return ''
      }
    }
  })()
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('anvil-original', provider)
  )
}

export async function acceptChange(
  workspaceRoot: vscode.Uri,
  change: FileChange
): Promise<void> {
  // Already on disk — accepting means keep proposed content.
  void workspaceRoot
  void change
}

export async function rejectChangeToOriginal(
  workspaceRoot: vscode.Uri,
  change: FileChange
): Promise<void> {
  const uri = vscode.Uri.joinPath(workspaceRoot, change.path)
  if (change.kind === 'added' || change.before === undefined) {
    await vscode.workspace.fs.delete(uri, { useTrash: true })
    return
  }
  await vscode.workspace.fs.writeFile(uri, Buffer.from(change.before, 'utf8'))
}
