/** @deprecated Canonical: packages/agent-core — do not extend. */
import fs from 'fs/promises'
import path from 'path'

export class PathGuard {
  constructor(private workspaceRoot: string) {}

  get root(): string {
    return this.workspaceRoot
  }

  setRoot(root: string): void {
    this.workspaceRoot = path.resolve(root)
  }

  resolve(relativeOrAbsolute: string): string {
    const candidate = path.isAbsolute(relativeOrAbsolute)
      ? relativeOrAbsolute
      : path.resolve(this.workspaceRoot, relativeOrAbsolute)
    const resolved = path.resolve(candidate)
    const root = path.resolve(this.workspaceRoot)
    const rel = path.relative(root, resolved)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Path escapes workspace: ${relativeOrAbsolute}`)
    }
    return resolved
  }

  toRelative(absolutePath: string): string {
    const resolved = this.resolve(absolutePath)
    return path.relative(this.workspaceRoot, resolved).split(path.sep).join('/')
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(relativePath))
      return true
    } catch {
      return false
    }
  }
}
