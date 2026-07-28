import type { ModelSettings, OllamaModel, ToolDefinition } from '../types'
import { normalizeCompletion, toolsToOpenAi } from './adapter'
import { httpJson, ModelRequestError, settingsEndpoint, trimSlash } from './http'
import type { ChatCompletionMessage, ChatCompletionResult, ConnectionStatus, ModelProvider } from './types'

export class OllamaProvider implements ModelProvider {
  readonly id = 'ollama'

  async listModels(baseUrl: string): Promise<OllamaModel[]> {
    const url = `${trimSlash(baseUrl)}/api/tags`
    const { data } = await httpJson<{
      models?: Array<{ name: string; size?: number; modified_at?: string }>
    }>({
      url,
      provider: this.id,
      model: '(list)',
      timeoutMs: 8_000
    })
    return (data.models ?? []).map((m) => ({
      name: m.name,
      size: m.size ?? 0,
      modifiedAt: m.modified_at
    }))
  }

  async testConnection(settings: ModelSettings): Promise<{
    ok: boolean
    status: ConnectionStatus
    message: string
    models?: string[]
  }> {
    try {
      const models = await this.listModels(settings.baseUrl)
      const names = models.map((m) => m.name)
      if (!names.length) {
        return {
          ok: false,
          status: 'connected',
          message: 'Connected to Ollama, but no models are installed. Run: ollama pull <model>',
          models: names
        }
      }
      if (settings.model && !names.includes(settings.model)) {
        const partial = names.find(
          (n) => n === settings.model || n.startsWith(`${settings.model}:`) || settings.model.startsWith(`${n}:`)
        )
        if (!partial) {
          return {
            ok: false,
            status: 'model_not_found',
            message: `Model "${settings.model}" not found. Available: ${names.slice(0, 8).join(', ')}`,
            models: names
          }
        }
      }

      // Lightweight show call validates the selected model loads metadata
      if (settings.model) {
        await httpJson({
          url: settingsEndpoint(settings, '/api/show'),
          method: 'POST',
          body: { model: settings.model },
          provider: this.id,
          model: settings.model,
          timeoutMs: 15_000
        })
      }

      return {
        ok: true,
        status: 'connected',
        message: `Connected. ${names.length} model(s) available.`,
        models: names
      }
    } catch (err) {
      return this.mapConnectionError(err, settings)
    }
  }

  async chat(options: {
    settings: ModelSettings
    messages: ChatCompletionMessage[]
    tools: ToolDefinition[]
    signal?: AbortSignal
    onDelta?: import('./types').StreamDeltaHandler
  }): Promise<ChatCompletionResult> {
    const url = settingsEndpoint(options.settings, '/api/chat')
    const useStream = Boolean(options.onDelta)
    const body = {
      model: options.settings.model,
      messages: options.messages.map(toOllamaMessage),
      stream: useStream,
      options: {
        temperature: options.settings.temperature,
        num_predict: options.settings.maxTokens
      },
      tools: options.tools.length ? toolsToOpenAi(options.tools) : undefined
    }

    let attempt = 0
    let lastError: unknown
    while (attempt < 2) {
      attempt += 1
      try {
        if (useStream) {
          return await this.chatStreaming(url, body, options.settings.model, options.signal, options.onDelta!)
        }

        const { data } = await httpJson<{
          message?: {
            role?: string
            content?: string
            tool_calls?: Array<{
              id?: string
              function?: { name?: string; arguments?: string | Record<string, unknown> }
            }>
          }
          done_reason?: string
          error?: string
        }>({
          url,
          method: 'POST',
          body,
          signal: options.signal,
          timeoutMs: 180_000,
          provider: this.id,
          model: options.settings.model
        })

        if (data.error) {
          throw new ModelRequestError({
            kind: data.error.toLowerCase().includes('not found') ? 'model_not_found' : 'http',
            message: data.error,
            provider: this.id,
            model: options.settings.model,
            endpoint: url
          })
        }

        return normalizeOllamaMessage(data.message, data.done_reason || 'stop')
      } catch (err) {
        lastError = err
        const retryable =
          err instanceof ModelRequestError &&
          (err.kind === 'timeout' || err.kind === 'connection' || (err.status != null && err.status >= 500))
        if (!retryable || attempt >= 2) break
      }
    }
    throw lastError instanceof ModelRequestError
      ? lastError
      : new ModelRequestError({
          kind: 'unknown',
          message: lastError instanceof Error ? lastError.message : String(lastError),
          provider: this.id,
          model: options.settings.model,
          endpoint: url
        })
  }

  private async chatStreaming(
    url: string,
    body: unknown,
    model: string,
    signal: AbortSignal | undefined,
    onDelta: import('./types').StreamDeltaHandler
  ): Promise<ChatCompletionResult> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: JSON.stringify(body),
      signal
    })

    if (!res.ok) {
      const text = await res.text()
      const kind =
        res.status === 404 || text.toLowerCase().includes('not found') ? 'model_not_found' : 'http'
      throw new ModelRequestError({
        kind,
        message: text.slice(0, 400) || `HTTP ${res.status}`,
        status: res.status,
        provider: this.id,
        model,
        endpoint: url
      })
    }

    if (!res.body) {
      throw new ModelRequestError({
        kind: 'malformed',
        message: 'Empty stream body from Ollama',
        provider: this.id,
        model,
        endpoint: url
      })
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''
    let doneReason = 'stop'
    let toolCalls: Array<{
      id?: string
      function?: { name?: string; arguments?: string | Record<string, unknown> }
    }> = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        let chunk: {
          message?: {
            content?: string
            tool_calls?: typeof toolCalls
          }
          done?: boolean
          done_reason?: string
          error?: string
        }
        try {
          chunk = JSON.parse(trimmed) as typeof chunk
        } catch {
          continue
        }
        if (chunk.error) {
          throw new ModelRequestError({
            kind: chunk.error.toLowerCase().includes('not found') ? 'model_not_found' : 'http',
            message: chunk.error,
            provider: this.id,
            model,
            endpoint: url
          })
        }
        const delta = chunk.message?.content ?? ''
        if (delta) {
          content += delta
          onDelta({ text: delta })
        }
        if (chunk.message?.tool_calls?.length) {
          toolCalls = chunk.message.tool_calls
        }
        if (chunk.done) {
          doneReason = chunk.done_reason || (toolCalls.length ? 'tool_calls' : 'stop')
        }
      }
    }

    return normalizeOllamaMessage(
      { content, tool_calls: toolCalls },
      doneReason
    )
  }

  private mapConnectionError(
    err: unknown,
    settings: ModelSettings
  ): { ok: boolean; status: ConnectionStatus; message: string; models?: string[] } {
    if (err instanceof ModelRequestError) {
      if (err.kind === 'connection' && err.causeCode === 'ECONNREFUSED') {
        return {
          ok: false,
          status: 'ollama_not_running',
          message: `Ollama not running at ${settings.baseUrl}. Start it with: ollama serve`
        }
      }
      if (err.kind === 'model_not_found') {
        return { ok: false, status: 'model_not_found', message: err.toUserMessage() }
      }
      if (err.kind === 'timeout') {
        return { ok: false, status: 'connection_failed', message: err.toUserMessage() }
      }
      return { ok: false, status: 'connection_failed', message: err.toUserMessage() }
    }
    return {
      ok: false,
      status: 'disconnected',
      message: err instanceof Error ? err.message : String(err)
    }
  }
}

function normalizeOllamaMessage(
  message:
    | {
        content?: string
        tool_calls?: Array<{
          id?: string
          function?: { name?: string; arguments?: string | Record<string, unknown> }
        }>
      }
    | undefined,
  doneReason: string
): ChatCompletionResult {
  return normalizeCompletion(
    {
      role: 'assistant',
      content: message?.content ?? '',
      tool_calls: (message?.tool_calls ?? []).map((tc, i) => ({
        id: tc.id || `ollama_call_${i}`,
        type: 'function' as const,
        function: {
          name: tc.function?.name || 'unknown',
          arguments:
            typeof tc.function?.arguments === 'string'
              ? tc.function.arguments
              : JSON.stringify(tc.function?.arguments ?? {})
        }
      }))
    },
    doneReason
  ).result
}

function toOllamaMessage(message: ChatCompletionMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      content: message.content,
      tool_name: message.name
    }
  }
  if (message.tool_calls?.length) {
    return {
      role: 'assistant',
      content: message.content || '',
      tool_calls: message.tool_calls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.function.name,
          arguments: safeParse(tc.function.arguments)
        }
      }))
    }
  }
  return {
    role: message.role,
    content: message.content
  }
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
