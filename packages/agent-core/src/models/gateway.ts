import type { ModelSettings, ToolDefinition } from '../types'
import { OllamaProvider } from './ollama'
import { AnthropicProvider, GeminiProvider, OpenAICompatibleProvider } from './providers'
import type { ChatCompletionMessage, ChatCompletionResult, ModelProvider } from './types'

export type { ChatCompletionMessage, ChatCompletionResult, ModelProvider, ConnectionStatus } from './types'
export { ModelRequestError } from './http'
export { estimateChars, normalizeCompletion } from './adapter'

export class ModelGateway {
  private providers: Record<string, ModelProvider> = {
    ollama: new OllamaProvider(),
    'openai-compatible': new OpenAICompatibleProvider(),
    anthropic: new AnthropicProvider(),
    gemini: new GeminiProvider()
  }

  get(providerId: string): ModelProvider {
    const provider = this.providers[providerId]
    if (!provider) throw new Error(`Unknown provider: ${providerId}`)
    return provider
  }

  async chat(options: {
    settings: ModelSettings
    messages: ChatCompletionMessage[]
    tools: ToolDefinition[]
    signal?: AbortSignal
    onDelta?: import('./types').StreamDeltaHandler
  }): Promise<ChatCompletionResult> {
    return this.get(options.settings.provider).chat(options)
  }
}
