import type { ModelSettings, ToolDefinition } from '../types'
import { normalizeCompletion, toolsToOpenAi } from './adapter'
import { authHeaders, httpJson, ModelRequestError, settingsEndpoint, trimSlash } from './http'
import type { ChatCompletionMessage, ChatCompletionResult, ModelProvider } from './types'

export class OpenAICompatibleProvider implements ModelProvider {
  readonly id = 'openai-compatible'

  async testConnection(settings: ModelSettings): Promise<{
    ok: boolean
    status: 'connected' | 'connection_failed' | 'model_not_found' | 'disconnected'
    message: string
  }> {
    try {
      await httpJson({
        url: `${trimSlash(settings.baseUrl)}/models`,
        headers: authHeaders(settings.apiKey),
        provider: this.id,
        model: settings.model || '(list)',
        timeoutMs: 8_000
      })
      return { ok: true, status: 'connected', message: 'Connected to OpenAI-compatible endpoint.' }
    } catch (err) {
      if (err instanceof ModelRequestError) {
        return {
          ok: false,
          status: err.kind === 'model_not_found' ? 'model_not_found' : 'connection_failed',
          message: err.toUserMessage()
        }
      }
      return { ok: false, status: 'disconnected', message: String(err) }
    }
  }

  async chat(options: {
    settings: ModelSettings
    messages: ChatCompletionMessage[]
    tools: ToolDefinition[]
    signal?: AbortSignal
    onDelta?: (delta: { text?: string }) => void
  }): Promise<ChatCompletionResult> {
    void options.onDelta
    const url = settingsEndpoint(options.settings, '/chat/completions')
    const { data } = await httpJson<{
      choices?: Array<{
        finish_reason?: string
        message?: ChatCompletionMessage & {
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
        }
      }>
    }>({
      url,
      method: 'POST',
      headers: authHeaders(options.settings.apiKey),
      body: {
        model: options.settings.model,
        messages: options.messages,
        temperature: options.settings.temperature,
        max_tokens: options.settings.maxTokens,
        tools: options.tools.length ? toolsToOpenAi(options.tools) : undefined
      },
      signal: options.signal,
      timeoutMs: 180_000,
      provider: this.id,
      model: options.settings.model
    })

    const choice = data.choices?.[0]
    const message = choice?.message
    if (!message) {
      throw new ModelRequestError({
        kind: 'malformed',
        message: 'No completion returned',
        provider: this.id,
        model: options.settings.model,
        endpoint: url
      })
    }

    return normalizeCompletion(
      {
        role: 'assistant',
        content: message.content || '',
        tool_calls: message.tool_calls
      },
      choice?.finish_reason || 'stop'
    ).result
  }
}

export class AnthropicProvider implements ModelProvider {
  readonly id = 'anthropic'
  async testConnection(): Promise<{
    ok: boolean
    status: 'disconnected'
    message: string
  }> {
    return {
      ok: false,
      status: 'disconnected',
      message: 'Anthropic is not enabled in this release. Use Ollama or an OpenAI-compatible endpoint.'
    }
  }
  async chat(_options: {
    settings: ModelSettings
    messages: ChatCompletionMessage[]
    tools: ToolDefinition[]
    signal?: AbortSignal
    onDelta?: (delta: { text?: string }) => void
  }): Promise<ChatCompletionResult> {
    throw new Error(
      'Anthropic is not enabled in this release. Use Ollama or an OpenAI-compatible endpoint.'
    )
  }
}

export class GeminiProvider implements ModelProvider {
  readonly id = 'gemini'
  async testConnection(): Promise<{
    ok: boolean
    status: 'disconnected'
    message: string
  }> {
    return {
      ok: false,
      status: 'disconnected',
      message: 'Gemini is not enabled in this release. Use Ollama or an OpenAI-compatible endpoint.'
    }
  }
  async chat(_options: {
    settings: ModelSettings
    messages: ChatCompletionMessage[]
    tools: ToolDefinition[]
    signal?: AbortSignal
    onDelta?: (delta: { text?: string }) => void
  }): Promise<ChatCompletionResult> {
    throw new Error(
      'Gemini is not enabled in this release. Use Ollama or an OpenAI-compatible endpoint.'
    )
  }
}
