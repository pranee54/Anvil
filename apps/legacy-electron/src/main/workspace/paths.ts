import path from 'path'
import { PathGuard } from '../repository/path-guard'

export function assertInsideWorkspace(root: string, relativePath: string): string {
  const guard = new PathGuard(root)
  return guard.resolve(relativePath)
}

export function toPosixRelative(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join('/')
}
