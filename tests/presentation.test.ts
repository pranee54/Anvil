import { describe, expect, it } from 'vitest'
import {
  TurnMachine,
  shouldHideEvent,
  buildCollapsedSummary,
  thinkingLabel
} from '../packages/anvil-extension/src/chat-turn'
import { normalizeMarkdown, stripProtocolNoise } from '../packages/anvil-extension/src/markdown-normalize'
import { classifyQuery } from '../packages/agent-core/src/context/query-intent'
import { titleFromPrompt } from '../packages/anvil-extension/src/sessions'

describe('turn state machine', () => {
  it('never places activities before user message exists', () => {
    const m = new TurnMachine()
    const turn = m.beginTurn('how to use this project')
    expect(turn.userMessage).toBe('how to use this project')
    expect(turn.status).toBe('submitted')
    expect(m.snapshot()[0].userMessage).toBeTruthy()
    m.applyEvent({
      kind: 'work_summary',
      id: 's1',
      text: "I'm checking installation docs."
    })
    const snap = m.snapshot()[0]
    expect(snap.activities[0].kind).toBe('thinking')
    expect(snap.activities[0].detail).toContain('installation')
  })

  it('hides lifecycle phase noise', () => {
    expect(shouldHideEvent({ kind: 'phase', id: '1', label: 'Understanding' })).toBe(true)
    expect(shouldHideEvent({ kind: 'task_started', id: '1', label: 'Working' })).toBe(true)
    expect(shouldHideEvent({ kind: 'task_finished', id: '1', label: 'Done' })).toBe(true)
  })

  it('dedupes and merges reads', () => {
    const m = new TurnMachine()
    m.beginTurn('q')
    m.applyEvent({
      kind: 'read_group',
      id: 'r1',
      files: ['a.ts', 'b.ts'],
      status: 'done'
    })
    m.applyEvent({
      kind: 'read_group',
      id: 'r2',
      files: ['b.ts', 'c.ts'],
      status: 'done'
    })
    const read = m.snapshot()[0].activities.find((a) => a.kind === 'read')
    expect(read?.files).toHaveLength(3)
    expect(read?.label).toBe('Read 3 files')
  })

  it('collapses on complete', () => {
    const m = new TurnMachine()
    m.beginTurn('q')
    m.applyEvent({
      kind: 'read_group',
      id: 'r',
      files: ['a.ts', 'b.ts'],
      status: 'done'
    })
    m.setAnswer('Final answer here.')
    m.complete()
    const t = m.snapshot()[0]
    expect(t.status).toBe('completed')
    expect(t.collapsedSummary).toMatch(/Investigated/)
    expect(buildCollapsedSummary(t)).toContain('2 files')
  })

  it('stop clears running state', () => {
    const m = new TurnMachine()
    m.beginTurn('q')
    m.applyEvent({ kind: 'work_summary', id: 's', text: 'Working on it.' })
    m.stop()
    expect(m.snapshot()[0].status).toBe('stopped')
    expect(m.getActive()).toBeNull()
  })

  it('thinking label is compact', () => {
    expect(
      thinkingLabel({
        id: '1',
        kind: 'thinking',
        label: 'x',
        status: 'done',
        seconds: 1,
        detail: 'hi'
      })
    ).toBe('Thought briefly')
  })
})

describe('markdown normalize', () => {
  it('fixes glued headings', () => {
    expect(normalizeMarkdown('###1. Install')).toContain('### 1. Install')
    expect(normalizeMarkdown('##Chrome')).toContain('## Chrome')
  })

  it('strips tool protocol noise', () => {
    const raw = '{"name":"read_file","arguments":{}}\nHello world'
    expect(stripProtocolNoise(raw)).toBe('Hello world')
  })
})

describe('intent coverage', () => {
  it('classifies how to use and Telugu capability queries', () => {
    expect(classifyQuery('how to use this project').intent).toBe('HOW_TO_USE_PROJECT')
    expect(classifyQuery('ee project em chestundi?').intent).toBe('CAPABILITIES')
    expect(classifyQuery('login flow explain cheyyi').intent).toBe('LOCATE_FEATURE')
  })
})

describe('session title', () => {
  it('builds short title', () => {
    expect(titleFromPrompt('Explain how this project works').length).toBeLessThanOrEqual(48)
  })
})
