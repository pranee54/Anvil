import { describe, expect, it } from 'vitest'
import path from 'path'
import { recoverToolCallsFromText, normalizeCompletion, parseToolCalls } from '../packages/agent-core/src/models/adapter'
import { formatFetchFailure, ModelRequestError } from '../packages/agent-core/src/models/http'
import { ContextEngine } from '../packages/agent-core/src/context/context-engine'
import { PathGuard } from '../packages/agent-core/src/repository/path-guard'

describe('formatFetchFailure', () => {
  it('unwraps ECONNREFUSED from fetch failed', () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), {
      code: 'ECONNREFUSED'
    })
    const err = Object.assign(new TypeError('fetch failed'), { cause })
    const formatted = formatFetchFailure(err, {
      provider: 'ollama',
      model: 'qwen2.5-coder:3b',
      endpoint: 'http://127.0.0.1:11434/api/chat'
    })
    expect(formatted).toBeInstanceOf(ModelRequestError)
    expect(formatted.kind).toBe('connection')
    expect(formatted.toUserMessage()).toContain('Ollama not running')
  })
})

describe('tool call adapter', () => {
  it('parses native tool calls', () => {
    const { calls, warnings } = parseToolCalls([
      {
        id: '1',
        function: { name: 'read_file', arguments: '{"path":"src/index.js"}' }
      }
    ])
    expect(warnings).toEqual([])
    expect(calls[0]?.name).toBe('read_file')
  })

  it('recovers NDJSON tool calls from text', () => {
    const recovered = recoverToolCallsFromText(
      [
        '{"name":"read_file","arguments":{"path":"src/index.js"}}',
        '{"name":"edit_file","arguments":{"path":"src/index.js","old_string":"a","new_string":"b"}}'
      ].join('\n')
    )
    expect(recovered.recovered).toBe(true)
    expect(recovered.calls.map((c) => c.name)).toEqual(['read_file', 'edit_file'])
  })

  it('normalizes empty tool calls with content', () => {
    const result = normalizeCompletion({ role: 'assistant', content: 'All done.' }, 'stop')
    expect(result.result.toolCalls).toEqual([])
  })
})

describe('progressive context', () => {
  it('seeds few files for overview questions', async () => {
    const root = path.resolve(__dirname, '../demo-project')
    const engine = new ContextEngine(new PathGuard(root))
    await engine.refresh(root)
    const seed = await engine.selectInitialContext('how does this project work?', { maxFiles: 6 })
    expect(seed.intent).toBe('overview')
    expect(seed.files.length).toBeLessThanOrEqual(6)
    expect(seed.files.length).toBeGreaterThan(0)
  })

  it('detects php extension+backend workspaces', async () => {
    const root = process.env.ANVIL_FIXTURE_WORKSPACE || ''
    if (!root) return
    const fs = await import('fs/promises')
    try {
      await fs.access(root)
    } catch {
      return
    }
    const engine = new ContextEngine(new PathGuard(root))
    await engine.refresh(root)
    const summary = await engine.buildSummary()
    expect(summary.type).toBe('php')
    expect(summary.importantFiles.some((f) => f.includes('manifest.json') || f.endsWith('.php'))).toBe(true)
    const brief = [
      'INTERNAL PROJECT BRIEF',
      `Detected stack hint: ${summary.type}`,
      `Tracked source files: ~${summary.files.length}`
    ].join('\n')
    expect(brief).not.toMatch(/File sample/i)
    expect(brief).not.toMatch(/Detected type: unknown/)
  })
})
