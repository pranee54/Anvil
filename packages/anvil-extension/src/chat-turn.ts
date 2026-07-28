/**
 * Explicit chat turn state machine — UI renders only from this.
 */

export type TurnStatus =
  | 'submitted'
  | 'investigating'
  | 'reasoning'
  | 'tool_running'
  | 'editing'
  | 'executing'
  | 'answering'
  | 'completed'
  | 'failed'
  | 'stopped'

export type ActivityKind =
  | 'thinking'
  | 'search'
  | 'read'
  | 'tool'
  | 'edit'
  | 'terminal'
  | 'diagnostic'
  | 'test'
  | 'warning'
  | 'error'

export type ActivityStatus = 'running' | 'done' | 'failed'

export interface TurnActivity {
  id: string
  kind: ActivityKind
  label: string
  detail?: string
  status: ActivityStatus
  files?: Array<{ path: string; range?: string; additions?: number; deletions?: number }>
  query?: string
  matches?: number
  command?: string
  output?: string
  summary?: string
  seconds?: number
}

export interface ChatTurn {
  id: string
  userMessage: string
  status: TurnStatus
  activities: TurnActivity[]
  answer: string
  sources: string[]
  fileChanges: Array<{ path: string; additions?: number; deletions?: number }>
  createdAt: number
  completedAt?: number
  /** When completed, activities collapse behind this unless expanded */
  collapsedSummary?: string
  error?: string
  activitiesExpanded?: boolean
}

export type AgentUiEventLike = {
  kind: string
  id: string
  label?: string
  text?: string
  phase?: string
  status?: string
  query?: string
  matches?: number
  files?: Array<string | { path: string; additions?: number; deletions?: number }>
  detail?: string
  command?: string
  summary?: string
  output?: string
  ok?: boolean
  count?: number
}

const HIDDEN = new Set(['phase', 'task_started', 'task_finished', 'status', 'permission'])
const GENERIC = /^(working|understanding|exploring|planning|editing|testing|verifying|answering|done|analysis complete)$/i

export function shouldHideEvent(ev: AgentUiEventLike): boolean {
  if (HIDDEN.has(ev.kind)) return true
  if (ev.kind === 'verification' && /grounded|deterministic|unsafe prose/i.test(ev.label || '')) return true
  if (ev.label && GENERIC.test(ev.label.trim())) return true
  return false
}

export class TurnMachine {
  private turns: ChatTurn[] = []
  private activeId: string | null = null
  private thoughtStartedAt = 0
  private readMergeId = 'act_reads'
  private seenEventIds = new Set<string>()

  snapshot(): ChatTurn[] {
    return this.turns.map((t) => ({
      ...t,
      activities: t.activities.map((a) => ({ ...a, files: a.files?.map((f) => ({ ...f })) })),
      sources: [...t.sources],
      fileChanges: t.fileChanges.map((f) => ({ ...f }))
    }))
  }

  getActive(): ChatTurn | null {
    if (!this.activeId) return null
    return this.turns.find((t) => t.id === this.activeId) || null
  }

  clear(): void {
    this.turns = []
    this.activeId = null
    this.seenEventIds.clear()
    this.thoughtStartedAt = 0
  }

  loadPersisted(turns: ChatTurn[]): void {
    this.turns = turns.map((t) => ({
      ...t,
      status: t.status === 'completed' || t.status === 'failed' || t.status === 'stopped' ? t.status : 'completed',
      activities: (t.activities || []).map((a) => ({ ...a, status: a.status === 'running' ? 'done' : a.status }))
    }))
    this.activeId = null
    this.seenEventIds.clear()
  }

  /** Create turn with user message first — never emit activities before user text exists. */
  beginTurn(userMessage: string, id?: string): ChatTurn {
    const turn: ChatTurn = {
      id: id || `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      userMessage,
      status: 'submitted',
      activities: [],
      answer: '',
      sources: [],
      fileChanges: [],
      createdAt: Date.now()
    }
    this.turns.push(turn)
    this.activeId = turn.id
    this.thoughtStartedAt = Date.now()
    this.seenEventIds.clear()
    return turn
  }

  setStatus(status: TurnStatus): void {
    const t = this.getActive()
    if (!t) return
    if (t.status === 'completed' || t.status === 'failed' || t.status === 'stopped') return
    t.status = status
  }

  applyEvent(ev: AgentUiEventLike): void {
    const t = this.getActive()
    if (!t || t.status === 'completed' || t.status === 'failed' || t.status === 'stopped') return
    if (shouldHideEvent(ev)) return
    if (ev.id && this.seenEventIds.has(ev.id) && ev.status !== 'done' && ev.status !== 'failed') return
    if (ev.id) this.seenEventIds.add(ev.id)

    if (ev.kind === 'work_summary' && ev.text?.trim()) {
      this.upsertThinking(ev.text.trim(), false)
      this.setStatus('reasoning')
      return
    }

    if (ev.kind === 'search') {
      this.closeOpenThinking()
      this.setStatus('investigating')
      const files = (ev.files || []).map((f) => (typeof f === 'string' ? f : f.path)).filter(Boolean)
      const id = ev.id || 'act_search'
      let a = t.activities.find((x) => x.id === id || (x.kind === 'search' && x.status === 'running'))
      if (!a) {
        a = {
          id,
          kind: 'search',
          label: 'Searched codebase',
          status: ev.status === 'running' ? 'running' : 'done',
          query: ev.query,
          matches: ev.matches,
          files: files.map((path) => ({ path }))
        }
        t.activities.push(a)
      } else {
        a.status = ev.status === 'running' ? 'running' : 'done'
        a.query = ev.query || a.query
        a.matches = ev.matches ?? a.matches
        const map = new Map((a.files || []).map((f) => [f.path, f]))
        for (const p of files) map.set(p, { path: p })
        a.files = [...map.values()]
      }
      return
    }

    if (ev.kind === 'read_group') {
      this.closeOpenThinking()
      this.setStatus('investigating')
      const incoming = (ev.files || [])
        .map((f) => (typeof f === 'string' ? { path: f } : { path: f.path }))
        .filter((f) => f.path)
      let a = t.activities.find((x) => x.id === this.readMergeId)
      if (!a) {
        a = {
          id: this.readMergeId,
          kind: 'read',
          label: 'Read files',
          status: 'done',
          files: []
        }
        t.activities.push(a)
      }
      const map = new Map((a.files || []).map((f) => [f.path, f]))
      for (const f of incoming) map.set(f.path, f)
      a.files = [...map.values()]
      a.label = `Read ${a.files.length} file${a.files.length === 1 ? '' : 's'}`
      a.status = ev.status === 'running' ? 'running' : 'done'
      return
    }

    if (ev.kind === 'edit_group') {
      this.closeOpenThinking()
      this.setStatus('editing')
      for (const f of ev.files || []) {
        if (typeof f === 'string' || !f.path) continue
        const id = `edit_${f.path}`
        let a = t.activities.find((x) => x.id === id)
        if (!a) {
          a = {
            id,
            kind: 'edit',
            label: 'Edited',
            status: ev.status === 'running' ? 'running' : 'done',
            files: [{ path: f.path, additions: f.additions, deletions: f.deletions }]
          }
          t.activities.push(a)
        } else {
          a.status = ev.status === 'running' ? 'running' : 'done'
          a.files = [{ path: f.path, additions: f.additions ?? a.files?.[0]?.additions, deletions: f.deletions ?? a.files?.[0]?.deletions }]
        }
        const existing = t.fileChanges.find((c) => c.path === f.path)
        if (existing) {
          existing.additions = f.additions ?? existing.additions
          existing.deletions = f.deletions ?? existing.deletions
        } else {
          t.fileChanges.push({ path: f.path, additions: f.additions, deletions: f.deletions })
        }
      }
      return
    }

    if (ev.kind === 'command') {
      this.closeOpenThinking()
      this.setStatus('executing')
      const status: ActivityStatus =
        ev.status === 'failed' ? 'failed' : ev.status === 'running' || ev.status === 'start' ? 'running' : 'done'
      let a = t.activities.find((x) => x.id === ev.id)
      const label = ev.label && !/^(running command|command finished|command failed)$/i.test(ev.label)
        ? ev.label
        : 'Ran'
      if (!a) {
        a = {
          id: ev.id,
          kind: 'terminal',
          label,
          status,
          command: ev.command,
          summary: ev.summary,
          output: ev.output
        }
        t.activities.push(a)
      } else {
        a.status = status
        a.command = ev.command || a.command
        a.label = label
        a.summary = ev.summary ?? a.summary
        a.output = ev.output ?? a.output
      }
      return
    }

    if (ev.kind === 'diagnostics') {
      this.closeOpenThinking()
      this.upsertActivity({
        id: ev.id,
        kind: 'diagnostic',
        label: ev.label || 'Checked diagnostics',
        detail: ev.count != null ? String(ev.count) : undefined,
        status: ev.status === 'running' ? 'running' : 'done'
      })
      return
    }

    if (ev.kind === 'trace') {
      if (GENERIC.test((ev.label || '').trim())) return
      if (/traced implementation|analysis complete|searched codebase|read relevant/i.test(ev.label || '')) return
      if (/startup|documented command|verified instruction/i.test(ev.label || '')) {
        this.upsertThinking([ev.label, ev.detail].filter(Boolean).join(' — '), false)
        return
      }
      this.upsertActivity({
        id: ev.id,
        kind: 'tool',
        label: ev.label || 'Traced',
        detail: ev.detail,
        status: 'done'
      })
      return
    }

    if (ev.kind === 'error') {
      this.upsertActivity({
        id: ev.id,
        kind: 'error',
        label: ev.label || 'Error',
        detail: ev.detail,
        status: 'failed'
      })
    }
  }

  appendAnswerDelta(text: string): void {
    const t = this.getActive()
    if (!t) return
    this.closeOpenThinking()
    this.setStatus('answering')
    t.answer += text
  }

  setAnswer(text: string): void {
    const t = this.getActive()
    if (!t) return
    this.closeOpenThinking()
    t.answer = text
    this.setStatus('answering')
  }

  setSources(files: string[]): void {
    const t = this.getActive()
    if (!t) return
    t.sources = [...new Set(files.filter(Boolean))]
  }

  complete(opts?: { error?: string; stopped?: boolean }): void {
    const t = this.getActive()
    if (!t) return
    this.closeOpenThinking()
    for (const a of t.activities) {
      if (a.status === 'running') a.status = 'done'
    }
    if (opts?.stopped) t.status = 'stopped'
    else if (opts?.error) {
      t.status = 'failed'
      t.error = opts.error
    } else t.status = 'completed'
    t.completedAt = Date.now()
    t.collapsedSummary = buildCollapsedSummary(t)
    this.activeId = null
  }

  stop(): void {
    this.complete({ stopped: true })
  }

  /** Persistable shape — drop running spinners */
  toPersisted(): ChatTurn[] {
    return this.snapshot().map((t) => ({
      ...t,
      status:
        t.status === 'completed' || t.status === 'failed' || t.status === 'stopped' ? t.status : 'completed',
      activities: t.activities.map((a) => ({ ...a, status: a.status === 'running' ? 'done' : a.status })),
      activitiesExpanded: false
    }))
  }

  private upsertThinking(text: string, running: boolean): void {
    const t = this.getActive()
    if (!t) return
    const open = [...t.activities].reverse().find((a) => a.kind === 'thinking' && a.status === 'running')
    const last = [...t.activities].reverse().find((a) => a.kind === 'thinking')
    const needNew =
      !open &&
      last &&
      last.status === 'done' &&
      t.activities.some((a) => a.kind === 'search' || a.kind === 'read' || a.kind === 'edit')

    let a = open
    if (!a && needNew) {
      this.thoughtStartedAt = Date.now()
      a = {
        id: `think_${Date.now().toString(36)}`,
        kind: 'thinking',
        label: 'Thought briefly',
        status: running ? 'running' : 'done',
        detail: text,
        seconds: running ? undefined : Math.max(1, Math.round((Date.now() - this.thoughtStartedAt) / 1000))
      }
      t.activities.push(a)
    } else if (!a && !last) {
      this.thoughtStartedAt = Date.now()
      a = {
        id: 'think_active',
        kind: 'thinking',
        label: running ? 'Thinking' : 'Thought briefly',
        status: running ? 'running' : 'done',
        detail: text
      }
      t.activities.push(a)
    } else if (!a && last) {
      a = last
    }
    if (!a) return
    if (text) a.detail = text
    a.status = running ? 'running' : 'done'
    if (!running) {
      a.seconds = Math.max(1, Math.round((Date.now() - (this.thoughtStartedAt || Date.now())) / 1000))
      a.label = a.seconds <= 2 ? 'Thought briefly' : `Thought for ${a.seconds}s`
    } else {
      a.label = 'Thinking'
    }
  }

  private closeOpenThinking(): void {
    const t = this.getActive()
    if (!t) return
    for (const a of t.activities) {
      if (a.kind === 'thinking' && a.status === 'running') {
        a.status = 'done'
        a.seconds = Math.max(1, Math.round((Date.now() - (this.thoughtStartedAt || Date.now())) / 1000))
        a.label = a.seconds <= 2 ? 'Thought briefly' : `Thought for ${a.seconds}s`
        if (!a.detail) a.detail = undefined
      }
    }
  }

  private upsertActivity(a: TurnActivity): void {
    const t = this.getActive()
    if (!t) return
    const existing = t.activities.find((x) => x.id === a.id)
    if (existing) Object.assign(existing, a)
    else t.activities.push(a)
  }
}

export function buildCollapsedSummary(t: ChatTurn): string {
  const reads = t.activities.find((a) => a.kind === 'read')
  const n = reads?.files?.length || t.sources.length
  const edits = t.fileChanges.length
  const parts: string[] = []
  if (n > 0) parts.push(`${n} file${n === 1 ? '' : 's'}`)
  if (edits > 0) parts.push(`${edits} edit${edits === 1 ? '' : 's'}`)
  if (!parts.length) return 'Investigated codebase'
  return `Investigated codebase · ${parts.join(' · ')}`
}

export function thinkingLabel(a: TurnActivity): string {
  if (a.status === 'running') return 'Thinking'
  if (a.seconds != null && a.seconds <= 2) return 'Thought briefly'
  if (a.seconds != null) return `Thought for ${a.seconds}s`
  return a.label || 'Thought briefly'
}
