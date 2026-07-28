import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type {
  AgentActivity,
  AgentRunEvent,
  ChatMessage,
  FileChange,
  PendingPermission
} from '@shared/types'
import { useAppStore } from '../stores/app-store'

export function AgentPanel(): JSX.Element {
  const workspacePath = useAppStore((s) => s.workspacePath)
  const mode = useAppStore((s) => s.mode)
  const messages = useAppStore((s) => s.messages)
  const activities = useAppStore((s) => s.activities)
  const running = useAppStore((s) => s.running)
  const permission = useAppStore((s) => s.permission)
  const addMessage = useAppStore((s) => s.addMessage)
  const addActivity = useAppStore((s) => s.addActivity)
  const clearActivities = useAppStore((s) => s.clearActivities)
  const upsertChange = useAppStore((s) => s.upsertChange)
  const setPermission = useAppStore((s) => s.setPermission)
  const setRunning = useAppStore((s) => s.setRunning)
  const appendTerminal = useAppStore((s) => s.appendTerminal)
  const [input, setInput] = useState('')
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const off = window.anvil.onAgentEvent((event: AgentRunEvent) => {
      if (event.type === 'activity') addActivity(event.data as AgentActivity)
      if (event.type === 'message') addMessage(event.data as ChatMessage)
      if (event.type === 'file_change') upsertChange(event.data as FileChange)
      if (event.type === 'permission_request') setPermission(event.data as PendingPermission)
      if (event.type === 'terminal') appendTerminal(String(event.data))
      if (event.type === 'done') {
        setRunning(false)
        setPermission(null)
      }
    })
    return off
  }, [addActivity, addMessage, appendTerminal, setPermission, setRunning, upsertChange])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [messages, activities])

  async function send(): Promise<void> {
    const text = input.trim()
    if (!text || !workspacePath || running) return
    setInput('')
    clearActivities()
    addMessage({
      id: `u_${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now()
    })
    setRunning(true)
    try {
      await window.anvil.runAgent({
        message: text,
        mode,
        workspacePath
      })
    } catch (err) {
      setRunning(false)
      addActivity({
        id: `err_${Date.now()}`,
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
        timestamp: Date.now()
      })
    }
  }

  return (
    <aside className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <span>Agent · {mode}</span>
        {running ? (
          <button className="btn danger" onClick={() => void window.anvil.abortAgent()}>
            Stop
          </button>
        ) : (
          <span className="badge">idle</span>
        )}
      </div>

      <div ref={scroller} style={{ flex: 1, overflow: 'auto', padding: 12, display: 'grid', gap: 12 }}>
        {messages.length === 0 && activities.length === 0 ? (
          <div className="empty-state" style={{ padding: 8 }}>
            Ask Anvil to inspect the repo, edit files, run commands, and fix errors.
          </div>
        ) : null}

        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: 10,
              background: m.role === 'user' ? '#152033' : '#121a24'
            }}
          >
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>
              {m.role === 'user' ? 'You' : 'Anvil'}
            </div>
            <div className="mono" style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>
              {m.role === 'assistant' ? <ReactMarkdown>{m.content}</ReactMarkdown> : m.content}
            </div>
          </div>
        ))}

        {activities.length > 0 && (
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: 10,
              background: '#0f1720'
            }}
          >
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>Activity</div>
            <div style={{ display: 'grid', gap: 6 }}>
              {activities.map((a) => (
                <div
                  key={a.id}
                  className="mono"
                  style={{
                    fontSize: 12,
                    whiteSpace: 'pre-wrap',
                    color:
                      a.type === 'error'
                        ? 'var(--danger)'
                        : a.type === 'permission'
                          ? 'var(--ask)'
                          : a.type === 'tool'
                            ? 'var(--accent)'
                            : 'var(--text-dim)'
                  }}
                >
                  {a.message}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {permission && (
        <div
          style={{
            borderTop: '1px solid var(--border)',
            padding: 10,
            background: '#2a2110',
            display: 'grid',
            gap: 8
          }}
        >
          <div style={{ fontSize: 13 }}>
            <strong>Permission required</strong>
            <div style={{ color: 'var(--ask)', marginTop: 4 }}>{permission.reason}</div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
              {permission.toolName}: {JSON.stringify(permission.arguments).slice(0, 200)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn primary"
              onClick={() => {
                void window.anvil.resolvePermission(permission.id, true)
                setPermission(null)
              }}
            >
              Allow
            </button>
            <button
              className="btn danger"
              onClick={() => {
                void window.anvil.resolvePermission(permission.id, false)
                setPermission(null)
              }}
            >
              Deny
            </button>
          </div>
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--border)', padding: 10, display: 'grid', gap: 8 }}>
        <textarea
          className="textarea mono"
          rows={4}
          placeholder={
            workspacePath
              ? 'e.g. Inspect this project, find the auth flow, and summarize architecture…'
              : 'Open a project first'
          }
          value={input}
          disabled={!workspacePath || running}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <button className="btn primary" disabled={!workspacePath || running || !input.trim()} onClick={() => void send()}>
          {running ? 'Running…' : 'Send (⌘↵)'}
        </button>
      </div>
    </aside>
  )
}
