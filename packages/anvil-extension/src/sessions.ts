import { randomUUID } from 'crypto'
import type { AgentMode } from '@anvil/agent-core'
import type { ChatTurn } from './chat-turn'

export type ChatRole = 'user' | 'assistant'

/** Legacy message shape kept for migration */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  activities?: unknown[]
  streaming?: boolean
}

export interface ChatSession {
  id: string
  workspace: string
  title: string
  createdAt: number
  updatedAt: number
  mode: AgentMode
  model: string
  /** Preferred: turn-based conversation */
  turns?: ChatTurn[]
  /** Legacy flat messages — migrated on load */
  messages: ChatMessage[]
}

const STORAGE_KEY = 'anvil.chat.sessions.v2'
const STORAGE_KEY_LEGACY = 'anvil.chat.sessions.v1'
const ACTIVE_KEY = 'anvil.chat.activeSessionId'

export function titleFromPrompt(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, ' ').trim()
  if (!cleaned) return 'New chat'
  const max = 48
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max - 1)}…`
}

export class SessionStore {
  constructor(
    private readonly memento: {
      get<T>(key: string): T | undefined
      update(key: string, value: unknown): Thenable<void>
    }
  ) {}

  listForWorkspace(workspace: string): ChatSession[] {
    return this.all()
      .filter((s) => s.workspace === workspace)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  get(id: string): ChatSession | undefined {
    return this.all().find((s) => s.id === id)
  }

  getActiveId(): string | undefined {
    return this.memento.get<string>(ACTIVE_KEY)
  }

  async setActiveId(id: string | undefined): Promise<void> {
    await this.memento.update(ACTIVE_KEY, id)
  }

  async create(input: {
    workspace: string
    mode: AgentMode
    model: string
    firstPrompt?: string
  }): Promise<ChatSession> {
    const now = Date.now()
    const session: ChatSession = {
      id: randomUUID(),
      workspace: input.workspace,
      title: input.firstPrompt ? titleFromPrompt(input.firstPrompt) : 'New chat',
      createdAt: now,
      updatedAt: now,
      mode: input.mode,
      model: input.model,
      turns: [],
      messages: []
    }
    const sessions = this.all()
    sessions.unshift(session)
    await this.save(sessions.slice(0, 40))
    await this.setActiveId(session.id)
    return session
  }

  async saveSession(session: ChatSession): Promise<void> {
    session.updatedAt = Date.now()
    // Keep legacy messages in sync for model history
    if (session.turns?.length) {
      session.messages = turnsToMessages(session.turns)
    }
    const sessions = this.all().filter((s) => s.id !== session.id)
    sessions.unshift(session)
    await this.save(sessions.slice(0, 40))
  }

  async delete(id: string): Promise<void> {
    const sessions = this.all().filter((s) => s.id !== id)
    await this.save(sessions)
    if (this.getActiveId() === id) await this.setActiveId(sessions[0]?.id)
  }

  historyForModel(session: ChatSession, limit = 12): Array<{ role: 'user' | 'assistant'; content: string }> {
    const turns = session.turns?.length ? session.turns : messagesToPseudoTurns(session.messages)
    const pairs: Array<{ role: 'user' | 'assistant'; content: string }> = []
    for (const t of turns) {
      if (t.userMessage?.trim()) pairs.push({ role: 'user', content: t.userMessage })
      if (t.answer?.trim() && (t.status === 'completed' || t.status === 'failed' || t.status === 'stopped')) {
        pairs.push({ role: 'assistant', content: t.answer })
      }
    }
    return pairs.slice(-limit)
  }

  private all(): ChatSession[] {
    const v2 = this.memento.get<ChatSession[]>(STORAGE_KEY)
    if (v2?.length) return v2.map(normalizeSession)
    const v1 = this.memento.get<ChatSession[]>(STORAGE_KEY_LEGACY)
    if (v1?.length) return v1.map(normalizeSession)
    return []
  }

  private async save(sessions: ChatSession[]): Promise<void> {
    await this.memento.update(STORAGE_KEY, sessions)
  }
}

function normalizeSession(s: ChatSession): ChatSession {
  if (!s.turns?.length && s.messages?.length) {
    s.turns = messagesToPseudoTurns(s.messages)
  }
  if (!s.turns) s.turns = []
  if (!s.messages) s.messages = turnsToMessages(s.turns)
  return s
}

function messagesToPseudoTurns(messages: ChatMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = []
  let pendingUser: ChatMessage | null = null
  for (const m of messages) {
    if (m.role === 'user') {
      pendingUser = m
    } else if (m.role === 'assistant' && pendingUser) {
      turns.push({
        id: pendingUser.id || m.id,
        userMessage: pendingUser.content,
        status: 'completed',
        activities: [],
        answer: m.content,
        sources: [],
        fileChanges: [],
        createdAt: pendingUser.createdAt,
        completedAt: m.createdAt,
        collapsedSummary: 'Investigated codebase'
      })
      pendingUser = null
    }
  }
  return turns
}

function turnsToMessages(turns: ChatTurn[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const t of turns) {
    out.push({
      id: `${t.id}_u`,
      role: 'user',
      content: t.userMessage,
      createdAt: t.createdAt
    })
    if (t.answer) {
      out.push({
        id: `${t.id}_a`,
        role: 'assistant',
        content: t.answer,
        createdAt: t.completedAt || t.createdAt
      })
    }
  }
  return out
}
