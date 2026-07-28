import type { ToolCall, ToolDefinition } from '../types'
import type { ChatCompletionMessage, ChatCompletionResult } from './types'

const KNOWN_TOOLS = new Set([
  'list_directory',
  'search_files',
  'search_code',
  'read_file',
  'create_file',
  'write_file',
  'edit_file',
  'delete_file',
  'run_terminal',
  'git_status',
  'git_diff',
  'inspect_project',
  'get_diagnostics'
])

export interface NormalizedCompletion {
  result: ChatCompletionResult
  warnings: string[]
  recoveredFromText: boolean
}

export function toolsToOpenAi(tools: ToolDefinition[]): unknown[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }))
}

export function parseToolCalls(
  raw?: Array<{ id?: string; function?: { name?: string; arguments?: string | Record<string, unknown> } }>
): { calls: ToolCall[]; warnings: string[] } {
  if (!raw?.length) return { calls: [], warnings: [] }
  const warnings: string[] = []
  const calls: ToolCall[] = []

  raw.forEach((item, index) => {
    const name = item.function?.name?.trim()
    if (!name) {
      warnings.push(`tool_call[${index}] missing function name`)
      return
    }
    if (!KNOWN_TOOLS.has(name)) {
      warnings.push(`Unknown tool "${name}" ignored`)
      return
    }

    let args: Record<string, unknown> = {}
    const rawArgs = item.function?.arguments
    if (typeof rawArgs === 'string') {
      try {
        args = JSON.parse(rawArgs || '{}') as Record<string, unknown>
      } catch {
        warnings.push(`Malformed arguments for ${name}; using empty object`)
        args = {}
      }
    } else if (rawArgs && typeof rawArgs === 'object') {
      args = rawArgs
    }

    calls.push({
      id: item.id || `call_${index}_${name}`,
      name,
      arguments: args
    })
  })

  return { calls, warnings }
}

/** Recover tool calls from models that emit JSON/text instead of native tool_calls */
export function recoverToolCallsFromText(content: string): {
  calls: ToolCall[]
  cleanedContent: string
  recovered: boolean
} {
  if (!content.trim()) return { calls: [], cleanedContent: content, recovered: false }

  const calls: ToolCall[] = []
  let cleaned = content

  // ```json ... tool call patterns
  const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidates = [fence?.[1], content]

  for (const candidate of candidates) {
    if (!candidate) continue
    const trimmed = candidate.trim()

    // Single JSON value
    try {
      const parsed = JSON.parse(trimmed) as unknown
      const extracted = extractCalls(parsed)
      if (extracted.length) {
        calls.push(...extracted)
        cleaned = content.replace(fence?.[0] ?? trimmed, '').trim()
        break
      }
    } catch {
      // continue
    }

    // NDJSON / multiple JSON objects (common with smaller local models)
    const ndjsonCalls = parseNdjsonToolCalls(trimmed)
    if (ndjsonCalls.length) {
      calls.push(...ndjsonCalls)
      cleaned = ''
      break
    }
  }

  if (!calls.length) {
    const invokeRe =
      /(?:tool_call|function_call)\s*[:=]\s*([a-z_]+)\s*(?:\((\{[\s\S]*?\})\)|\n?\s*(\{[\s\S]*?\}))?/gi
    let match: RegExpExecArray | null
    while ((match = invokeRe.exec(content)) !== null) {
      const name = match[1]
      if (!KNOWN_TOOLS.has(name)) continue
      let args: Record<string, unknown> = {}
      const raw = match[2] || match[3]
      if (raw) {
        try {
          args = JSON.parse(raw) as Record<string, unknown>
        } catch {
          args = {}
        }
      }
      calls.push({ id: `recovered_${calls.length}_${name}`, name, arguments: args })
    }
  }

  return { calls, cleanedContent: cleaned, recovered: calls.length > 0 }
}

function parseNdjsonToolCalls(text: string): ToolCall[] {
  const objects = extractJsonObjects(text)
  const calls: ToolCall[] = []
  for (const obj of objects) {
    calls.push(...extractCalls(obj))
  }
  return calls
}

function extractJsonObjects(text: string): unknown[] {
  const results: unknown[] = []
  let i = 0
  while (i < text.length) {
    const start = text.indexOf('{', i)
    if (start < 0) break
    let depth = 0
    let inString = false
    let escape = false
    let end = -1
    for (let j = start; j < text.length; j++) {
      const ch = text[j]
      if (inString) {
        if (escape) escape = false
        else if (ch === '\\') escape = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') inString = true
      else if (ch === '{') depth += 1
      else if (ch === '}') {
        depth -= 1
        if (depth === 0) {
          end = j
          break
        }
      }
    }
    if (end < 0) break
    const slice = text.slice(start, end + 1)
    try {
      results.push(JSON.parse(slice))
    } catch {
      // skip invalid
    }
    i = end + 1
  }
  return results
}

function extractCalls(parsed: unknown): ToolCall[] {
  if (!parsed || typeof parsed !== 'object') return []

  if (Array.isArray(parsed)) {
    return parsed.flatMap((item, i) => normalizeOne(item, i))
  }

  const obj = parsed as Record<string, unknown>
  if (Array.isArray(obj.tool_calls)) {
    return obj.tool_calls.flatMap((item, i) => normalizeOne(item, i))
  }
  if (obj.name && typeof obj.name === 'string') {
    return normalizeOne(obj, 0)
  }
  if (obj.function && typeof obj.function === 'object') {
    return normalizeOne(obj, 0)
  }
  return []
}

function normalizeOne(item: unknown, index: number): ToolCall[] {
  if (!item || typeof item !== 'object') return []
  const obj = item as Record<string, unknown>
  const fn = (obj.function as Record<string, unknown> | undefined) ?? obj
  const name = String(fn.name ?? obj.name ?? '').trim()
  if (!KNOWN_TOOLS.has(name)) return []

  let args: Record<string, unknown> = {}
  const rawArgs = fn.arguments ?? obj.arguments ?? obj.parameters
  if (typeof rawArgs === 'string') {
    try {
      args = JSON.parse(rawArgs) as Record<string, unknown>
    } catch {
      args = {}
    }
  } else if (rawArgs && typeof rawArgs === 'object') {
    args = rawArgs as Record<string, unknown>
  }

  return [{ id: `recovered_${index}_${name}`, name, arguments: args }]
}

export function normalizeCompletion(
  message: ChatCompletionMessage,
  finishReason: string
): NormalizedCompletion {
  const warnings: string[] = []
  const parsed = parseToolCalls(message.tool_calls)
  warnings.push(...parsed.warnings)

  let toolCalls = parsed.calls
  let content = message.content || ''
  let recoveredFromText = false

  if (!toolCalls.length && content) {
    const recovered = recoverToolCallsFromText(content)
    if (recovered.recovered) {
      toolCalls = recovered.calls
      content = recovered.cleanedContent
      recoveredFromText = true
      warnings.push(`Recovered ${toolCalls.length} tool call(s) from text response`)
    }
  }

  return {
    warnings,
    recoveredFromText,
    result: {
      message: {
        role: 'assistant',
        content,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments)
          }
        }))
      },
      toolCalls,
      finishReason: toolCalls.length ? 'tool_calls' : finishReason || 'stop'
    }
  }
}

export function estimateChars(messages: ChatCompletionMessage[]): number {
  return messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0)
}
