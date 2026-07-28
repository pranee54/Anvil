import type { ToolCall, ToolDefinition } from '@shared/types'

export interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
  name?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

export interface ChatCompletionResult {
  message: ChatCompletionMessage
  toolCalls: ToolCall[]
  finishReason: string
}

export interface ModelProvider {
  readonly id: string
  chat(options: {
    settings: import('@shared/types').ModelSettings
    messages: ChatCompletionMessage[]
    tools: ToolDefinition[]
    signal?: AbortSignal
  }): Promise<ChatCompletionResult>
  listModels?(baseUrl: string, apiKey?: string): Promise<import('@shared/types').OllamaModel[]>
  testConnection?(
    settings: import('@shared/types').ModelSettings
  ): Promise<{
    ok: boolean
    status: ConnectionStatus
    message: string
    models?: string[]
  }>
}

export type ConnectionStatus =
  | 'connected'
  | 'disconnected'
  | 'ollama_not_running'
  | 'model_not_found'
  | 'connection_failed'
