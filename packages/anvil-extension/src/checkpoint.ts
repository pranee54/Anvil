import * as vscode from 'vscode'
import type { FileChange } from '@anvil/agent-core'

export interface TaskCheckpoint {
  taskId: string
  startedAt: number
  /** path → original content before any Anvil edit in this task (undefined = did not exist) */
  originals: Map<string, string | undefined>
  changes: Map<string, FileChange>
}

export class CheckpointStore {
  private current: TaskCheckpoint | null = null

  begin(taskId: string): void {
    this.current = {
      taskId,
      startedAt: Date.now(),
      originals: new Map(),
      changes: new Map()
    }
  }

  recordChange(change: FileChange & { taskId?: string }): void {
    if (!this.current) return
    if (change.taskId && change.taskId !== this.current.taskId) return
    if (!this.current.originals.has(change.path)) {
      this.current.originals.set(change.path, change.before)
    }
    this.current.changes.set(change.path, change)
  }

  getCurrent(): TaskCheckpoint | null {
    return this.current
  }

  listChanges(): FileChange[] {
    return this.current ? [...this.current.changes.values()] : []
  }

  async revertTask(workspaceRoot: vscode.Uri): Promise<number> {
    if (!this.current) return 0
    let count = 0
    for (const [rel, original] of this.current.originals) {
      const uri = vscode.Uri.joinPath(workspaceRoot, rel)
      try {
        if (original === undefined) {
          await vscode.workspace.fs.delete(uri, { useTrash: true })
        } else {
          await vscode.workspace.fs.writeFile(uri, Buffer.from(original, 'utf8'))
        }
        count += 1
      } catch (err) {
        console.error('checkpoint revert failed', rel, err)
      }
    }
    this.current.changes.clear()
    return count
  }

  clear(): void {
    this.current = null
  }
}
