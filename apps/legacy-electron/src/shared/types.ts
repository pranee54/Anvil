export type AgentMode = 'ask' | 'edit' | 'agent'

export type PermissionLevel = 'safe' | 'ask' | 'deny'

export type ModelProviderId =
  | 'ollama'
  | 'openai-compatible'
  | 'anthropic'
  | 'gemini'

export type ProjectType =
  | 'flutter'
  | 'nodejs'
  | 'react'
  | 'nextjs'
  | 'laravel'
  | 'python'
  | 'unknown'

export type ConnectionStatus =
  | 'connected'
  | 'disconnected'
  | 'ollama_not_running'
  | 'model_not_found'
  | 'connection_failed'

export interface ModelSettings {
  provider: ModelProviderId
  model: string
  baseUrl: string
  apiKey?: string
  temperature: number
  maxTokens: number
  maxIterations: number
}

export interface AppSettings {
  model: ModelSettings
  agentMode: AgentMode
  permissions: {
    allowDeletes: boolean
    allowInstalls: boolean
    allowDestructiveShell: boolean
    shareSecretsWithCloud: boolean
  }
  context: {
    maxFiles: number
    maxFileBytes: number
    maxContextChars: number
    maxInitialFiles: number
    maxToolResultChars: number
    maxTerminalChars: number
  }
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp: number
  toolName?: string
  toolCallId?: string
  activity?: AgentActivity[]
}

export interface AgentActivity {
  id: string
  type: 'plan' | 'tool' | 'result' | 'error' | 'status' | 'permission'
  message: string
  toolName?: string
  timestamp: number
  meta?: Record<string, unknown>
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  permission: PermissionLevel
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolResult {
  toolCallId: string
  name: string
  ok: boolean
  output: string
  permissionRequired?: boolean
  permissionPrompt?: string
}

export interface FileChange {
  path: string
  kind: 'added' | 'modified' | 'deleted'
  before?: string
  after?: string
  accepted?: boolean
  rejected?: boolean
}

export interface PendingPermission {
  id: string
  toolName: string
  reason: string
  arguments: Record<string, unknown>
}

export interface AgentRunRequest {
  message: string
  mode: AgentMode
  workspacePath: string
  conversationId?: string
}

export interface AgentRunEvent {
  type:
    | 'activity'
    | 'message'
    | 'tool_start'
    | 'tool_end'
    | 'file_change'
    | 'permission_request'
    | 'terminal'
    | 'done'
    | 'error'
  data: unknown
}

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

export interface ProjectSummary {
  root: string
  type: ProjectType
  files: string[]
  importantFiles: string[]
  gitStatus?: string
  agentsMd?: string
}

export interface OllamaModel {
  name: string
  size: number
  modifiedAt?: string
}

export interface ProviderTestResult {
  ok: boolean
  status: ConnectionStatus
  message: string
  models?: string[]
}

export interface TerminalCommandResult {
  command: string
  cwd: string
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  model: {
    provider: 'ollama',
    model: 'qwen2.5-coder:3b',
    baseUrl: 'http://127.0.0.1:11434',
    temperature: 0.2,
    maxTokens: 2048,
    maxIterations: 24
  },
  agentMode: 'agent',
  permissions: {
    allowDeletes: false,
    allowInstalls: false,
    allowDestructiveShell: false,
    shareSecretsWithCloud: false
  },
  context: {
    maxFiles: 12,
    maxFileBytes: 80_000,
    maxContextChars: 24_000,
    maxInitialFiles: 6,
    maxToolResultChars: 8_000,
    maxTerminalChars: 6_000
  }
}
