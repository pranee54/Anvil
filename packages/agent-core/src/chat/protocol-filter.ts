/**
 * Filters model/tool protocol text so it never appears in the chat UI.
 * Streaming must NEVER .trim() per-chunk — that glues words together.
 */

const TOOL_JSON_LINE =
  /^\s*\{[\s\S]*"name"\s*:\s*"[a-zA-Z0-9_]+"[\s\S]*"arguments"\s*:/

const TOOL_JSON_BLOCK =
  /```(?:json)?\s*\{\s*"name"\s*:\s*"[a-zA-Z0-9_]+"[\s\S]*?"arguments"\s*:[\s\S]*?\}\s*```/gi

const BARE_TOOL_JSON =
  /(?:^|\n)\s*\{\s*"name"\s*:\s*"[a-zA-Z0-9_]+"\s*,\s*"arguments"\s*:\s*\{[\s\S]*?\}\s*\}\s*(?=\n|$)/g

export function looksLikeToolProtocol(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (TOOL_JSON_LINE.test(t)) return true
  if (/^\s*\{\s*"name"\s*:/.test(t) && t.includes('arguments')) return true
  if (/^```(?:json)?\s*\{\s*"name"\s*:/i.test(t)) return true
  return false
}

export type SanitizeOptions = {
  /** When true (default for complete messages), trim ends and collapse blank lines. */
  finalize?: boolean
}

/** Remove tool-call JSON / protocol blobs from assistant-visible text. */
export function sanitizeAssistantText(text: string, options: SanitizeOptions = {}): string {
  const finalize = options.finalize !== false
  let out = text.replace(TOOL_JSON_BLOCK, '')
  out = out.replace(BARE_TOOL_JSON, '\n')
  out = out
    .split('\n')
    .filter((line) => !looksLikeToolProtocol(line))
    .join('\n')
  if (finalize) {
    return out.replace(/\n{3,}/g, '\n\n').trim()
  }
  // Streaming: preserve all whitespace; only strip complete protocol lines
  return out
}

/**
 * Streaming accumulator: keep raw text, emit only newly visible safe deltas
 * without trimming chunk boundaries.
 */
export class StreamProtocolFilter {
  private raw = ''
  private emitted = 0
  private hold = false

  push(delta: string): string {
    this.raw += delta
    if (looksLikeToolProtocol(this.raw)) {
      this.hold = true
      return ''
    }
    const trimmedStart = this.raw.trimStart()
    if (
      (trimmedStart.startsWith('{') || trimmedStart.startsWith('```')) &&
      trimmedStart.length < 120 &&
      !trimmedStart.includes('\n\n')
    ) {
      this.hold = true
      return ''
    }
    this.hold = false
    const safe = sanitizeAssistantText(this.raw, { finalize: false })
    if (safe.length <= this.emitted) return ''
    const next = safe.slice(this.emitted)
    this.emitted = safe.length
    return next
  }

  flush(): string {
    if (this.hold && looksLikeToolProtocol(this.raw)) {
      this.reset()
      return ''
    }
    const safe = sanitizeAssistantText(this.raw, { finalize: true })
    const next = safe.slice(Math.min(this.emitted, safe.length))
    this.reset()
    return next
  }

  /** Full sanitized text accumulated so far (finalized). */
  snapshot(): string {
    return sanitizeAssistantText(this.raw, { finalize: true })
  }

  reset(): void {
    this.raw = ''
    this.emitted = 0
    this.hold = false
  }
}
