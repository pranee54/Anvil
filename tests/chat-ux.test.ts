import { describe, expect, it } from 'vitest'
import {
  looksLikeToolProtocol,
  sanitizeAssistantText,
  toolsForMode
} from '../packages/agent-core/src/index'
import { sanitizeUserFacingAnswer, toolLifecycleKey, safeExpandable } from '../packages/anvil-extension/src/answer-sanitize'
import { titleFromPrompt } from '../packages/anvil-extension/src/sessions'

describe('tool protocol filtering', () => {
  it('detects raw tool JSON', () => {
    expect(looksLikeToolProtocol('{"name": "inspect_project", "arguments": {}}')).toBe(true)
    expect(looksLikeToolProtocol('Here is how the project works.')).toBe(false)
  })

  it('strips tool JSON from assistant text', () => {
    const raw = [
      '{"name": "inspect_project", "arguments": {}}',
      '',
      'This repo has three parts.'
    ].join('\n')
    const clean = sanitizeAssistantText(raw)
    expect(clean).not.toContain('inspect_project')
    expect(clean).toContain('three parts')
  })
})

describe('user-facing metadata filter', () => {
  it('removes file samples and unknown type noise', () => {
    const raw = [
      'Detected type: unknown',
      'No AGENTS.md found.',
      'File sample (80 of 101):',
      'backend/a.php',
      'extension/b.js',
      '',
      'SampleApp has a browser extension and backend API.'
    ].join('\n')
    const clean = sanitizeUserFacingAnswer(raw)
    expect(clean).not.toMatch(/File sample/i)
    expect(clean).not.toMatch(/Detected type/i)
    expect(clean).not.toMatch(/AGENTS\.md/i)
    expect(clean).toContain('SampleApp')
  })

  it('hides internal expandable payloads', () => {
    expect(safeExpandable('INTERNAL PROJECT BRIEF\nfoo')).toBeUndefined()
    expect(safeExpandable('{"name":"x","arguments":{}}')).toBeUndefined()
    expect(safeExpandable('exit: 0\nok')).toBe('exit: 0\nok')
  })
})

describe('tool lifecycle keys', () => {
  it('maps start/result of same op to one key family', () => {
    const start = toolLifecycleKey({ category: 'status', title: 'Inspecting project', detail: 'workspace' })
    const done = toolLifecycleKey({ category: 'result', title: 'Project analyzed', detail: 'ok' })
    expect(start).toBe(done)
    expect(start).toBe('inspect_project')
  })

  it('keys reads by path', () => {
    expect(toolLifecycleKey({ category: 'read', title: 'Reading', path: 'a.php' })).toBe(
      toolLifecycleKey({ category: 'result', title: 'File read', path: 'a.php' })
    )
  })
})

describe('modes', () => {
  it('plan mode is read-only', () => {
    const names = toolsForMode('plan').map((t) => t.name)
    expect(names).not.toContain('edit_file')
  })
})

describe('session title', () => {
  it('builds a short title', () => {
    expect(titleFromPrompt('Explain how this project works').length).toBeLessThanOrEqual(48)
  })
})

describe('commands package', () => {
  it('registers Open Chat and Cmd+L binding in package.json', async () => {
    const fs = await import('fs/promises')
    const path = await import('path')
    const raw = await fs.readFile(
      path.resolve(__dirname, '../packages/anvil-extension/package.json'),
      'utf8'
    )
    const pkg = JSON.parse(raw) as {
      contributes: {
        commands: Array<{ command: string }>
        keybindings: Array<{ command: string; mac?: string }>
        viewsContainers: { secondarySidebar?: Array<{ id: string }> }
      }
    }
    const commands = pkg.contributes.commands.map((c) => c.command)
    expect(commands).toContain('anvil.openChat')
    expect(commands).toContain('anvil.newChat')
    expect(commands).toContain('anvil.openChatInEditor')
    expect(
      pkg.contributes.keybindings.some((k) => k.command === 'anvil.openChat' && k.mac === 'cmd+l')
    ).toBe(true)
    expect(pkg.contributes.viewsContainers.secondarySidebar?.some((c: { id: string }) => c.id === 'anvil-agent')).toBe(
      true
    )
  })
})
