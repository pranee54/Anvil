import { describe, expect, it } from 'vitest'
import {
  sanitizeAssistantText,
  StreamProtocolFilter
} from '../packages/agent-core/src/chat/protocol-filter'

describe('streaming whitespace', () => {
  it('preserves spaces across chunk boundaries', () => {
    const filter = new StreamProtocolFilter()
    const chunks = ['Based', ' on', ' the', ' provided', ' workspace']
    let out = ''
    for (const c of chunks) out += filter.push(c)
    out += filter.flush()
    expect(out).toBe('Based on the provided workspace')
  })

  it('does not trim per-chunk when finalize is false', () => {
    expect(sanitizeAssistantText(' on', { finalize: false })).toBe(' on')
    expect(sanitizeAssistantText('Based', { finalize: false })).toBe('Based')
  })

  it('finalize trims complete messages only', () => {
    expect(sanitizeAssistantText('  hello  ', { finalize: true })).toBe('hello')
  })

  it('handles markdown split across chunks', () => {
    const filter = new StreamProtocolFilter()
    let out = ''
    for (const c of ['**Bold', ' title**', '\n\n', 'Next', ' paragraph']) {
      out += filter.push(c)
    }
    out += filter.flush()
    expect(out).toContain('**Bold title**')
    expect(out).toContain('Next paragraph')
  })
})
