/** @deprecated Canonical: packages/agent-core — do not extend. */
import type { ModelSettings } from '@shared/types'

export type ModelErrorKind =
  | 'connection'
  | 'timeout'
  | 'http'
  | 'model_not_found'
  | 'malformed'
  | 'aborted'
  | 'unknown'

export class ModelRequestError extends Error {
  readonly kind: ModelErrorKind
  readonly provider: string
  readonly model: string
  readonly endpoint: string
  readonly status?: number
  readonly causeCode?: string

  constructor(options: {
    kind: ModelErrorKind
    message: string
    provider: string
    model: string
    endpoint: string
    status?: number
    causeCode?: string
    cause?: unknown
  }) {
    super(options.message)
    this.name = 'ModelRequestError'
    this.kind = options.kind
    this.provider = options.provider
    this.model = options.model
    this.endpoint = options.endpoint
    this.status = options.status
    this.causeCode = options.causeCode
    if (options.cause instanceof Error) {
      this.cause = options.cause
    }
  }

  toUserMessage(): string {
    const parts = [
      this.message,
      `provider=${this.provider}`,
      `model=${this.model}`,
      `endpoint=${this.endpoint}`
    ]
    if (this.status != null) parts.push(`status=${this.status}`)
    if (this.causeCode) parts.push(`code=${this.causeCode}`)
    return parts.join(' | ')
  }
}

export function trimSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

export function authHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
}

export function formatFetchFailure(
  err: unknown,
  meta: { provider: string; model: string; endpoint: string }
): ModelRequestError {
  if (err instanceof ModelRequestError) return err

  if (err instanceof Error && err.name === 'AbortError') {
    return new ModelRequestError({
      kind: 'aborted',
      message: 'Request aborted',
      ...meta
    })
  }

  const cause = err instanceof Error ? (err.cause as NodeJS.ErrnoException | undefined) : undefined
  const code = cause?.code || (err as NodeJS.ErrnoException)?.code
  const message = err instanceof Error ? err.message : String(err)

  if (code === 'ECONNREFUSED' || message.includes('ECONNREFUSED')) {
    return new ModelRequestError({
      kind: 'connection',
      message: 'Ollama not running (connection refused). Start Ollama and try again.',
      causeCode: 'ECONNREFUSED',
      cause: err,
      ...meta
    })
  }

  if (code === 'ENOTFOUND' || message.includes('ENOTFOUND')) {
    return new ModelRequestError({
      kind: 'connection',
      message: 'Host not found. Check the Base URL.',
      causeCode: 'ENOTFOUND',
      cause: err,
      ...meta
    })
  }

  if (
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    message.includes('TimeoutError') ||
    message.toLowerCase().includes('timeout')
  ) {
    return new ModelRequestError({
      kind: 'timeout',
      message: 'Connection timed out waiting for the model server.',
      causeCode: code || 'TIMEOUT',
      cause: err,
      ...meta
    })
  }

  if (message === 'fetch failed') {
    return new ModelRequestError({
      kind: 'connection',
      message: `Connection failed${cause?.message ? `: ${cause.message}` : ''}`,
      causeCode: code,
      cause: err,
      ...meta
    })
  }

  return new ModelRequestError({
    kind: 'unknown',
    message,
    causeCode: code,
    cause: err,
    ...meta
  })
}

export async function httpJson<T>(options: {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: unknown
  signal?: AbortSignal
  timeoutMs?: number
  provider: string
  model: string
}): Promise<{ data: T; status: number }> {
  const endpoint = options.url
  const meta = { provider: options.provider, model: options.model, endpoint }
  const timeoutMs = options.timeoutMs ?? 60_000
  const controller = new AbortController()
  const onAbort = (): void => controller.abort()
  options.signal?.addEventListener('abort', onAbort)

  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(endpoint, {
      method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
      headers: {
        Accept: 'application/json',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    })

    const text = await res.text()
    if (!res.ok) {
      const lower = text.toLowerCase()
      const kind: ModelErrorKind =
        res.status === 404 || lower.includes('not found') || lower.includes('model')
          ? 'model_not_found'
          : 'http'
      throw new ModelRequestError({
        kind,
        message:
          kind === 'model_not_found'
            ? `Model not found or endpoint missing: ${text.slice(0, 300) || res.statusText}`
            : `HTTP ${res.status}: ${text.slice(0, 300) || res.statusText}`,
        status: res.status,
        ...meta
      })
    }

    if (!text) {
      throw new ModelRequestError({
        kind: 'malformed',
        message: 'Empty response from model server',
        status: res.status,
        ...meta
      })
    }

    try {
      return { data: JSON.parse(text) as T, status: res.status }
    } catch {
      throw new ModelRequestError({
        kind: 'malformed',
        message: `Malformed JSON response: ${text.slice(0, 200)}`,
        status: res.status,
        ...meta
      })
    }
  } catch (err) {
    if (err instanceof ModelRequestError) throw err
    if (err instanceof Error && err.name === 'AbortError') {
      if (options.signal?.aborted) {
        throw new ModelRequestError({ kind: 'aborted', message: 'Request aborted', ...meta })
      }
      throw new ModelRequestError({
        kind: 'timeout',
        message: `Request timed out after ${timeoutMs}ms`,
        causeCode: 'TIMEOUT',
        ...meta
      })
    }
    throw formatFetchFailure(err, meta)
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

export function describeConnectionStatus(
  result: { ok: boolean; status: string; message: string; models?: string[] }
): string {
  return `${result.status}: ${result.message}`
}

export function settingsEndpoint(settings: ModelSettings, path: string): string {
  return `${trimSlash(settings.baseUrl)}${path.startsWith('/') ? path : `/${path}`}`
}
