import fs from 'fs/promises'
import path from 'path'
import ignore, { type Ignore } from 'ignore'

const DEFAULT_IGNORES = [
  'node_modules/',
  '.git/',
  'out/',
  'dist/',
  'build/',
  'coverage/',
  '.dart_tool/',
  '.next/',
  '.nuxt/',
  'vendor/',
  '__pycache__/',
  '*.pyc',
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  'id_rsa*',
  '*.log',
  '.DS_Store',
  '*.min.js',
  '*.min.css',
  'package-lock.json',
  'bun.lock',
  'yarn.lock',
  'pnpm-lock.yaml',
  '.anvil/'
]

export class IgnoreEngine {
  private ig: Ignore = ignore()
  private loaded = false

  constructor(private root: string) {}

  async load(): Promise<void> {
    this.ig = ignore().add(DEFAULT_IGNORES)
    await this.addIfExists('.gitignore')
    await this.addIfExists('.aiignore')
    this.loaded = true
  }

  private async addIfExists(name: string): Promise<void> {
    try {
      const content = await fs.readFile(path.join(this.root, name), 'utf8')
      this.ig.add(content)
    } catch {
      // optional
    }
  }

  async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.load()
  }

  ignores(relativePath: string): boolean {
    const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '')
    if (!normalized || normalized === '.') return false
    return this.ig.ignores(normalized)
  }
}
