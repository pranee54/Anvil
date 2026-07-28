import { describe, expect, it } from 'vitest'
import {
  classifyFileMutation,
  classifyShellCommand,
  isSecretPath,
  PathGuard,
  toolsForMode,
  DEFAULT_SETTINGS
} from '../packages/agent-core/src/index'

describe('permissions', () => {
  it('detects secret paths', () => {
    expect(isSecretPath('.env')).toBe(true)
    expect(isSecretPath('src/app.ts')).toBe(false)
  })

  it('blocks destructive shell by default', () => {
    const result = classifyShellCommand('rm -rf /', DEFAULT_SETTINGS)
    expect(result.level).toBe('deny')
  })

  it('asks for installs', () => {
    const result = classifyShellCommand('npm install lodash', DEFAULT_SETTINGS)
    expect(result.level).toBe('ask')
  })

  it('allows analyze commands', () => {
    const result = classifyShellCommand('flutter analyze', DEFAULT_SETTINGS)
    expect(result.level).toBe('safe')
  })

  it('allows node verification commands', () => {
    const result = classifyShellCommand('node src/index.js', DEFAULT_SETTINGS)
    expect(result.level).toBe('safe')
  })

  it('asks before deleting files', () => {
    const result = classifyFileMutation('delete_file', 'src/a.ts', DEFAULT_SETTINGS)
    expect(result.level).toBe('ask')
  })

  it('auto-allows routine edits', () => {
    const result = classifyFileMutation('edit_file', 'src/a.ts', DEFAULT_SETTINGS)
    expect(result.level).toBe('safe')
  })
})

describe('path guard', () => {
  it('blocks path escape', () => {
    const guard = new PathGuard('/tmp/project')
    expect(() => guard.resolve('../outside')).toThrow(/escapes/)
  })
})

describe('tools for mode', () => {
  it('ask mode excludes writes and terminal', () => {
    const names = toolsForMode('ask').map((t) => t.name)
    expect(names).not.toContain('edit_file')
    expect(names).not.toContain('run_terminal')
    expect(names).toContain('read_file')
    expect(names).toContain('get_diagnostics')
  })

  it('agent mode includes terminal', () => {
    const names = toolsForMode('agent').map((t) => t.name)
    expect(names).toContain('run_terminal')
    expect(names).toContain('edit_file')
  })
})
