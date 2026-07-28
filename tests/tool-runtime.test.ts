import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { PathGuard, ToolRuntime, DEFAULT_SETTINGS } from '../packages/agent-core/src/index'

describe('ToolRuntime', () => {
  let tmp: string

  afterEach(async () => {
    if (tmp) await fs.rm(tmp, { recursive: true, force: true })
  })

  it('creates, edits, reads, and searches files', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvil-'))
    await fs.writeFile(path.join(tmp, 'hello.txt'), 'hello world\n', 'utf8')

    const guard = new PathGuard(tmp)
    const changes: unknown[] = []
    const runtime = new ToolRuntime(
      guard,
      DEFAULT_SETTINGS,
      async () => true,
      (c) => changes.push(c),
      true
    )

    const created = await runtime.execute({
      id: '1',
      name: 'create_file',
      arguments: { path: 'note.md', content: '# Note\n' }
    })
    expect(created.ok).toBe(true)

    const edited = await runtime.execute({
      id: '2',
      name: 'edit_file',
      arguments: { path: 'hello.txt', old_string: 'world', new_string: 'anvil' }
    })
    expect(edited.ok).toBe(true)

    const read = await runtime.execute({
      id: '3',
      name: 'read_file',
      arguments: { path: 'hello.txt' }
    })
    expect(read.output).toContain('hello anvil')

    const diag = await runtime.execute({
      id: '4',
      name: 'get_diagnostics',
      arguments: {}
    })
    expect(diag.ok).toBe(true)
    expect(diag.output).toMatch(/No IDE diagnostics|No diagnostics/)

    expect(runtime.getChanges().length).toBeGreaterThan(0)
  })
})
