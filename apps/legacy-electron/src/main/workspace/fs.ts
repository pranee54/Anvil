import fs from 'fs/promises'
import path from 'path'
import { dialog, BrowserWindow } from 'electron'
import type { FileNode } from '@shared/types'
import { IgnoreEngine } from '../repository/ignore-engine'
import { assertInsideWorkspace } from './paths'

export async function openFolderDialog(win: BrowserWindow | null): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    properties: ['openDirectory', 'createDirectory']
  }
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return null
  return result.filePaths[0]
}

export async function buildFileTree(root: string, maxDepth = 6): Promise<FileNode[]> {
  const ignore = new IgnoreEngine(root)
  await ignore.load()
  return walk(root, '', ignore, 0, maxDepth)
}

async function walk(
  root: string,
  rel: string,
  ignore: IgnoreEngine,
  depth: number,
  maxDepth: number
): Promise<FileNode[]> {
  if (depth > maxDepth) return []
  const abs = rel ? path.join(root, rel) : root
  let entries
  try {
    entries = await fs.readdir(abs, { withFileTypes: true })
  } catch {
    return []
  }

  const nodes: FileNode[] = []
  const sorted = entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  for (const entry of sorted) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name
    if (ignore.ignores(childRel) || ignore.ignores(childRel + (entry.isDirectory() ? '/' : ''))) {
      continue
    }
    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: childRel,
        type: 'directory',
        children: await walk(root, childRel, ignore, depth + 1, maxDepth)
      })
    } else {
      nodes.push({ name: entry.name, path: childRel, type: 'file' })
    }
  }
  return nodes
}

export async function readWorkspaceFile(root: string, relativePath: string): Promise<string> {
  const abs = assertInsideWorkspace(root, relativePath)
  return fs.readFile(abs, 'utf8')
}

export async function writeWorkspaceFile(
  root: string,
  relativePath: string,
  content: string
): Promise<void> {
  const abs = assertInsideWorkspace(root, relativePath)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, content, 'utf8')
}
