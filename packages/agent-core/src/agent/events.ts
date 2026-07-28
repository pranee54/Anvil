/**
 * Structured agent activity events for the IDE UI.
 * Never carry private chain-of-thought or system prompts.
 */

export type AgentPhase =
  | 'understanding'
  | 'exploring'
  | 'planning'
  | 'editing'
  | 'testing'
  | 'verifying'
  | 'answering'
  | 'done'

export type AgentUiEvent =
  | {
      kind: 'task_started'
      id: string
      label: string
      mode: string
    }
  | {
      kind: 'phase'
      id: string
      phase: AgentPhase
      label: string
      status: 'start' | 'done'
    }
  | {
      kind: 'work_summary'
      id: string
      text: string
    }
  | {
      kind: 'search'
      id: string
      label: string
      query?: string
      matches?: number
      files?: string[]
      status: 'running' | 'done'
    }
  | {
      kind: 'read_group'
      id: string
      label: string
      files: string[]
      status: 'running' | 'done'
    }
  | {
      kind: 'trace'
      id: string
      label: string
      detail?: string
      status: 'running' | 'done'
    }
  | {
      kind: 'command'
      id: string
      label: string
      command: string
      status: 'running' | 'done' | 'failed'
      summary?: string
      output?: string
    }
  | {
      kind: 'edit_group'
      id: string
      label: string
      files: Array<{ path: string; additions?: number; deletions?: number }>
      status: 'running' | 'done'
    }
  | {
      kind: 'diagnostics'
      id: string
      label: string
      count?: number
      status: 'running' | 'done'
    }
  | {
      kind: 'verification'
      id: string
      label: string
      ok: boolean
      detail?: string
    }
  | {
      kind: 'status'
      id: string
      label: string
    }
  | {
      kind: 'permission'
      id: string
      toolName: string
      reason: string
      command?: string
    }
  | {
      kind: 'error'
      id: string
      label: string
      detail?: string
      retryable?: boolean
    }
  | {
      kind: 'task_finished'
      id: string
      label: string
      filesRead?: number
      filesChanged?: number
    }

export function agentEventId(prefix = 'ev'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}
