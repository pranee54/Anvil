import { randomUUID } from 'crypto'
import type {
  AgentActivity,
  AgentMode,
  AgentRunEvent,
  AppSettings,
  FileChange,
  IdeBridge,
  PendingPermission,
  ToolActivityCard
} from '../types'
import { toolsForMode } from '../tool-defs'
import { ContextEngine } from '../context/context-engine'
import { PathGuard } from '../repository/path-guard'
import { IgnoreEngine } from '../repository/ignore-engine'
import { ToolRuntime } from '../tools/runtime'
import { estimateChars, ModelGateway, ModelRequestError, type ChatCompletionMessage } from '../models/gateway'
import { looksLikeToolProtocol, sanitizeAssistantText, StreamProtocolFilter } from '../chat/protocol-filter'
import { investigateRepository } from './investigate'
import { agentEventId, type AgentUiEvent } from './events'
import { buildEvidenceBundle } from './evidence-bundle'
import { finalizeGroundedAnswer } from './answer-grounding'

export type AgentEventEmitter = (event: AgentRunEvent) => void

export class AgentOrchestrator {
  private abortController: AbortController | null = null
  private permissionWaiters = new Map<string, { resolve: (allowed: boolean) => void }>()
  private recentSignatures: string[] = []
  private runtime: ToolRuntime | null = null
  private gateway = new ModelGateway()
  private ide: IdeBridge | undefined
  private taskId: string | null = null

  constructor(
    private getSettings: () => AppSettings,
    private emit: AgentEventEmitter
  ) {}

  setIdeBridge(ide: IdeBridge | undefined): void {
    this.ide = ide
    this.runtime?.setIdeBridge(ide)
  }

  abort(): void {
    this.abortController?.abort()
    for (const [id, waiter] of this.permissionWaiters) {
      waiter.resolve(false)
      this.permissionWaiters.delete(id)
    }
  }

  resolvePermission(id: string, allowed: boolean): void {
    const waiter = this.permissionWaiters.get(id)
    if (!waiter) return
    this.permissionWaiters.delete(id)
    waiter.resolve(allowed)
  }

  getChanges(): FileChange[] {
    return this.runtime?.getChanges() ?? []
  }

  getTaskId(): string | null {
    return this.taskId
  }

  async applyChange(path: string): Promise<void> {
    await this.runtime?.applyChange(path)
  }

  async rejectChange(path: string): Promise<void> {
    await this.runtime?.rejectChange(path)
  }

  async revertChange(path: string): Promise<void> {
    await this.runtime?.revertChange(path)
  }

  async revertAllTaskChanges(): Promise<FileChange[]> {
    const changes = this.getChanges()
    for (const change of [...changes].reverse()) {
      await this.runtime?.revertChange(change.path)
    }
    return changes
  }

  async run(options: {
    message: string
    mode: AgentMode
    workspacePath: string
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
  }): Promise<void> {
    this.abort()
    this.abortController = new AbortController()
    this.recentSignatures = []
    this.taskId = randomUUID()

    const settings = this.getSettings()
    const guard = new PathGuard(options.workspacePath)
    const context = new ContextEngine(guard)
    await context.refresh(options.workspacePath)

    const providerIsLocal = settings.model.provider === 'ollama'

    this.runtime = new ToolRuntime(
      guard,
      settings,
      async (prompt) => this.askPermission(prompt),
      (change) => {
        this.emitToolCard(fileChangeCard(change))
        this.emit({ type: 'file_change', data: { ...change, taskId: this.taskId } })
      },
      providerIsLocal,
      this.ide
    )

    this.emit({
      type: 'checkpoint',
      data: { taskId: this.taskId, workspacePath: options.workspacePath, startedAt: Date.now() }
    })

    const tools = toolsForMode(options.mode)
    const ignore = new IgnoreEngine(options.workspacePath)
    await ignore.load()

    this.emitAgent({
      kind: 'task_started',
      id: agentEventId('task'),
      label: options.mode === 'plan' ? 'Planning' : options.mode === 'ask' ? 'Answering' : 'Working',
      mode: options.mode
    })

    // Safe work summary (not chain-of-thought) — UI shows as "Thought briefly"
    this.emitAgent({
      kind: 'work_summary',
      id: agentEventId('sum'),
      text:
        /how to use|how do i run|ela use|ela run|setup|install/i.test(options.message)
          ? "I'm checking the repository's installation documentation so I don't guess the backend setup."
          : 'I need to inspect the repository before answering from evidence.'
    })

    const investigation = await investigateRepository({
      guard,
      ignore,
      message: options.message,
      history: options.history,
      settings,
      providerIsLocal,
      maxFiles: Math.min(12, Math.max(6, settings.context.maxInitialFiles + 4)),
      maxCharsPerFile: Math.min(6_000, Math.floor(settings.context.maxContextChars / 4))
    })

    const evidenceBundle = buildEvidenceBundle(investigation)

    if (investigation.searchHits.length) {
      this.emitAgent({
        kind: 'search',
        id: agentEventId('search'),
        label: 'Explored search',
        query: investigation.classified.searchHints.slice(0, 3).join(', ') || undefined,
        matches: investigation.searchHits.length,
        files: [...new Set(investigation.searchHits.map((h) => h.split(':')[0]))].slice(0, 8),
        status: 'done'
      })
    }

    this.emitAgent({
      kind: 'read_group',
      id: agentEventId('read'),
      label: `Explored ${investigation.filesRead.length} files`,
      files: investigation.filesRead,
      status: 'done'
    })

    // Second safe summary after exploration — mid-turn progress thought
    const postExplore =
      investigation.intent === 'HOW_TO_USE_PROJECT' || investigation.intent === 'HOW_TO_RUN'
        ? evidenceBundle.runCommands.length === 0 &&
          evidenceBundle.unknowns.some((u) => /startup|command/i.test(u))
          ? 'The browser-extension setup is documented. The backend startup command is not documented in the files I inspected.'
          : `Found ${evidenceBundle.setupInstructions.length} verified setup instruction(s) in the docs.`
        : buildWorkSummary(investigation)
    this.emitAgent({
      kind: 'work_summary',
      id: agentEventId('sum2'),
      text: postExplore
    })

    this.emit({
      type: 'investigation',
      data: {
        intent: investigation.intent,
        filesRead: investigation.filesRead,
        evidenceCount: investigation.evidence.length,
        stacks: investigation.map.stacks,
        verifiedRunCommands: investigation.verifiedRunCommands.map((c) => c.command),
        setupInstructions: evidenceBundle.setupInstructions.length,
        sourceFiles: evidenceBundle.sourceFiles,
        unknowns: evidenceBundle.unknowns
      }
    })

    // HOW_TO_USE / HOW_TO_RUN: evidence-grounded answer — do not let the model invent setup
    if (investigation.intent === 'HOW_TO_USE_PROJECT' || investigation.intent === 'HOW_TO_RUN') {
      const grounded = finalizeGroundedAnswer({
        bundle: evidenceBundle,
        preferDeterministic: true
      })
      this.emitAgent({
        kind: 'verification',
        id: agentEventId('ground'),
        label: `Answer grounded in ${grounded.sourceFiles.length} sources`,
        ok: true,
        detail: grounded.usedDeterministic ? 'deterministic evidence render' : 'validated model prose'
      })
      this.emit({
        type: 'message',
        data: {
          id: randomUUID(),
          role: 'assistant',
          content: grounded.answer,
          timestamp: Date.now()
        }
      })
      this.emitAgent({
        kind: 'task_finished',
        id: agentEventId('done'),
        label: 'Done',
        filesRead: investigation.filesRead.length,
        filesChanged: 0
      })
      this.emit({ type: 'done', data: { changes: [], taskId: this.taskId } })
      return
    }

    const summary = await context.buildSummary()
    const map = investigation.map

    this.activity('status', `Connecting to ${settings.model.provider} · ${settings.model.model}`)
    const provider = this.gateway.get(settings.model.provider)
    if (provider.testConnection) {
      const probe = await provider.testConnection(settings.model)
      if (!probe.ok) {
        let msg = `${statusLabel(probe.status)} — ${probe.message}`
        if (probe.status === 'model_not_found') {
          msg = `Selected model is not installed: ${settings.model.model}. ${probe.message}`
        }
        this.emitAgent({
          kind: 'error',
          id: agentEventId('err'),
          label: 'Local model disconnected',
          detail: msg,
          retryable: true
        })
        this.activity('error', msg)
        this.emit({ type: 'error', data: { message: msg, status: probe.status, models: probe.models } })
        this.emit({ type: 'done', data: { changes: [], error: msg, taskId: this.taskId } })
        return
      }
      this.activity('status', `Connected to ${settings.model.provider}`)
    }

    const stacksLabel = map.stacks.length ? map.stacks.join('+') : summary.type
    const system = buildSystemPrompt(options.mode, stacksLabel, summary.agentsMd)
    const messages: ChatCompletionMessage[] = [
      { role: 'system', content: system },
      {
        role: 'user',
        content: [
          investigation.modelContext,
          '',
          'EVIDENCE BUNDLE (authoritative — do not contradict):',
          `Verified setup instructions: ${evidenceBundle.setupInstructions.length}`,
          `Verified run commands: ${
            evidenceBundle.runCommands.map((c) => c.command).join('; ') || '(none — do NOT invent any)'
          }`,
          `Unknowns: ${evidenceBundle.unknowns.join('; ') || '(none)'}`,
          '',
          'CRITICAL: When repository evidence is incomplete, explicitly state missing information.',
          'Never fill repository-specific gaps using plausible general knowledge (no invented XAMPP/ports/php index.php).',
          'The investigation above already READ the listed files. Prefer answering from that evidence.',
          'Use additional tools only if something important is still missing.',
          'Do not narrate workspace absolute paths or missing AGENTS.md.',
          options.mode === 'plan'
            ? 'PLAN MODE: produce a numbered implementation plan with file paths. Do not edit.'
            : ''
        ]
          .filter(Boolean)
          .join('\n')
      }
    ]

    for (const turn of options.history ?? []) {
      if (!turn.content?.trim()) continue
      messages.push({
        role: turn.role,
        content: sanitizeAssistantText(turn.content, { finalize: true }).slice(0, 12_000)
      })
    }

    messages.push({ role: 'user', content: options.message })

    const maxIterations = settings.model.maxIterations
    let finalText = ''
    let emptyRetries = 0
    let toolNudgeCount = 0
    let verifyNudgeCount = 0
    const needsCodeChanges = /\b(add|implement|create|fix|edit|change|refactor|write|delete|feature|health)\b/i.test(
      options.message
    )
    const editedThisRun = () => this.getChanges().length > 0

    try {
      for (let i = 0; i < maxIterations; i++) {
        if (this.abortController.signal.aborted) {
          this.activity('status', 'Aborted by user')
          break
        }

        this.activity('status', `Planning · step ${i + 1}/${maxIterations}`)

        let completion
        const streamFilter = new StreamProtocolFilter()
        try {
          completion = await this.gateway.chat({
            settings: settings.model,
            messages,
            tools,
            signal: this.abortController.signal,
            onDelta: (delta) => {
              if (!delta.text) return
              const chunk = streamFilter.push(delta.text)
              if (chunk) {
                this.emit({ type: 'stream_delta', data: { text: chunk } })
              }
            }
          })
          const flushed = streamFilter.flush()
          if (flushed) this.emit({ type: 'stream_delta', data: { text: flushed } })
        } catch (err) {
          if (this.abortController?.signal.aborted) {
            this.activity('status', 'Stopped by user')
            this.emit({ type: 'done', data: { changes: this.getChanges(), error: 'Stopped by user' } })
            return
          }
          const msg =
            err instanceof ModelRequestError
              ? err.toUserMessage()
              : err instanceof Error
                ? err.message
                : String(err)
          this.emitAgent({
            kind: 'error',
            id: agentEventId('err'),
            label: 'Local model disconnected',
            detail: msg,
            retryable: true
          })
          this.activity('error', msg)
          this.emit({ type: 'error', data: { message: msg } })
          this.emit({ type: 'done', data: { changes: this.getChanges(), error: msg } })
          return
        }

        if (completion.toolCalls.length > 0) {
          // Tool turn — discard any streamed protocol/narration from the chat bubble
          this.emit({ type: 'stream_clear', data: {} })
        }

        if (completion.toolCalls.length === 0) {
          if (!completion.message.content?.trim() && emptyRetries < 1) {
            emptyRetries += 1
            messages.push({
              role: 'user',
              content:
                'Your previous response was empty. Continue the task using tools if needed, then provide a concise final summary.'
            })
            continue
          }

          // Models sometimes narrate edits without calling tools — force real tool use.
          if (
            options.mode !== 'ask' &&
            options.mode !== 'plan' &&
            needsCodeChanges &&
            this.getChanges().length === 0 &&
            toolNudgeCount < 2
          ) {
            toolNudgeCount += 1
            this.activity('status', 'Model described changes without tools — requiring tool calls')
            messages.push({
              role: 'assistant',
              content: completion.message.content || ''
            })
            messages.push({
              role: 'user',
              content: [
                'You described changes but did not call any tools. No files were modified.',
                'You MUST call tools now: read_file / edit_file or create_file / write_file, then run_terminal to verify, then git_diff.',
                'Do not only describe the code — execute the tools.'
              ].join('\n')
            })
            continue
          }

          // After edits: require verify (diagnostics / tests) before finishing agent tasks
          if (
            options.mode === 'agent' &&
            editedThisRun() &&
            verifyNudgeCount < 1 &&
            !hasVerificationToolUse(messages)
          ) {
            verifyNudgeCount += 1
            this.emitAgent({
              kind: 'phase',
              id: agentEventId('phase'),
              phase: 'verifying',
              label: 'Verifying',
              status: 'start'
            })
            messages.push({
              role: 'assistant',
              content: completion.message.content || ''
            })
            messages.push({
              role: 'user',
              content: [
                'You modified files. Before the final answer you MUST verify:',
                '1) get_diagnostics on changed paths (or workspace)',
                '2) run_terminal for a relevant check if available (e.g. npm test / typecheck) — only if safe/non-destructive',
                'Then summarize results. Fix issues if verification fails.'
              ].join('\n')
            })
            continue
          }

          finalText = sanitizeAssistantText(completion.message.content || 'Done.', { finalize: true })
          const grounded = finalizeGroundedAnswer({
            bundle: evidenceBundle,
            modelAnswer: finalText,
            preferDeterministic: false
          })
          if (grounded.usedDeterministic || grounded.issues.length) {
            this.emitAgent({
              kind: 'verification',
              id: agentEventId('ground'),
              label: grounded.usedDeterministic
                ? 'Replaced unsafe prose with verified evidence'
                : `Answer grounded · blocked ${grounded.issues.length} unsupported claim(s)`,
              ok: true
            })
          }
          finalText = grounded.answer
          this.activity('status', 'Task completed')
          break
        }

        const signature = completion.toolCalls
          .map((tc) => `${tc.name}:${stableStringify(tc.arguments)}`)
          .join('|')
        this.recentSignatures.push(signature)
        if (this.recentSignatures.length > 8) this.recentSignatures.shift()
        if (countRecent(this.recentSignatures, signature) >= 3) {
          this.activity('error', 'Loop detected — stopping repeated identical tool calls')
          finalText =
            completion.message.content ||
            'Stopped due to repeated identical tool calls. Please refine the request.'
          break
        }

        messages.push({
          role: 'assistant',
          content: completion.message.content || '',
          tool_calls: completion.message.tool_calls
        })

        if (completion.message.content?.trim()) {
          const plan = summarizePlan(completion.message.content.trim())
          if (plan) {
            this.activity('plan', plan)
            this.emitAgent({
              kind: 'work_summary',
              id: agentEventId('sum'),
              text: plan
            })
          }
        }

        for (const call of completion.toolCalls) {
          this.emit({
            type: 'tool_start',
            data: { name: call.name, arguments: call.arguments }
          })
          this.emitToolCard(toolStartCard(call.name, call.arguments))
          this.emitAgent(toolToAgentEvent(call.id, call.name, call.arguments, 'running'))
          this.activity('tool', formatToolActivity(call.name, call.arguments), call.name, {
            arguments: call.arguments
          })

          const result = await this.runtime!.execute(call)
          const truncated = truncate(
            result.output,
            call.name === 'run_terminal'
              ? settings.context.maxTerminalChars
              : settings.context.maxToolResultChars
          )

          this.emit({
            type: 'tool_end',
            data: { name: call.name, ok: result.ok, output: truncate(result.output, 2000) }
          })

          this.emitToolCard(toolResultCard(call.name, call.arguments, result.ok, truncated))
          this.emitAgent(
            toolToAgentEvent(call.id, call.name, call.arguments, result.ok ? 'done' : 'failed', truncated)
          )
          this.activity(
            result.ok ? 'result' : 'error',
            formatToolResult(call.name, result.ok, truncated),
            call.name
          )

          if (call.name === 'run_terminal') {
            this.emit({
              type: 'terminal',
              data: { command: String(call.arguments.command ?? ''), output: truncated }
            })
          }

          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            name: call.name,
            content: truncated
          })
        }

        // Soft cap conversation growth for local models
        const chars = estimateChars(messages)
        if (chars > settings.context.maxContextChars * 3) {
          this.activity('status', 'Trimming conversation history for local context limits')
          trimMessages(messages, settings.context.maxContextChars * 2)
        }
      }

      if (!finalText) {
        finalText = 'Reached maximum iterations. Review the activity log and continue if needed.'
        this.activity('status', finalText)
      }

      this.emit({
        type: 'message',
        data: {
          id: randomUUID(),
          role: 'assistant',
          content: finalText,
          timestamp: Date.now()
        }
      })
      this.emitAgent({
        kind: 'task_finished',
        id: agentEventId('done'),
        label: 'Done',
        filesRead: investigation.filesRead.length,
        filesChanged: this.getChanges().length
      })
      this.emit({ type: 'done', data: { changes: this.getChanges(), taskId: this.taskId } })
    } catch (err) {
      const message =
        err instanceof ModelRequestError
          ? err.toUserMessage()
          : err instanceof Error
            ? err.message
            : String(err)
      this.activity('error', message)
      this.emit({ type: 'error', data: { message } })
      this.emit({ type: 'done', data: { changes: this.getChanges(), error: message } })
    }
  }

  private askPermission(prompt: PendingPermission): Promise<boolean> {
    this.emitAgent({
      kind: 'permission',
      id: prompt.id,
      toolName: prompt.toolName,
      reason: prompt.reason,
      command: prompt.arguments.command ? String(prompt.arguments.command) : undefined
    })
    this.emit({ type: 'permission_request', data: prompt })
    this.activity('permission', prompt.reason, prompt.toolName)
    return new Promise((resolve) => {
      this.permissionWaiters.set(prompt.id, { resolve })
    })
  }

  private activity(
    type: AgentActivity['type'],
    message: string,
    toolName?: string,
    meta?: Record<string, unknown>
  ): void {
    const activity: AgentActivity = {
      id: randomUUID(),
      type,
      message,
      toolName,
      timestamp: Date.now(),
      meta
    }
    this.emit({ type: 'activity', data: activity })
  }

  private emitToolCard(card: ToolActivityCard): void {
    this.emit({ type: 'tool_card', data: card })
  }

  private emitAgent(event: AgentUiEvent): void {
    this.emit({ type: 'agent_event', data: event })
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'connected':
      return 'Connected'
    case 'ollama_not_running':
      return 'Ollama not running'
    case 'model_not_found':
      return 'Model not found'
    case 'connection_failed':
      return 'Connection failed'
    case 'disconnected':
      return 'Disconnected'
    default:
      return status
  }
}

function buildWorkSummary(investigation: {
  intent: string
  evidence: Array<{ claim: string; path: string }>
  filesRead: string[]
  map: { stacks: string[] }
}): string {
  const stacks = investigation.map.stacks.join(' + ') || 'this workspace'
  const top = investigation.evidence.slice(0, 2).map((e) => e.claim)
  if (!top.length) {
    return `Inspected ${investigation.filesRead.length} files across ${stacks} before answering.`
  }
  return `${top[0]}. ${top[1] ? top[1] + '.' : ''} Tracing ${stacks} before answering.`
}

function hasVerificationToolUse(messages: ChatCompletionMessage[]): boolean {
  return messages.some(
    (m) =>
      m.role === 'tool' &&
      (m.name === 'get_diagnostics' ||
        m.name === 'run_terminal' ||
        m.name === 'git_diff' ||
        m.name === 'git_status')
  )
}

function toolToAgentEvent(
  id: string,
  name: string,
  args: Record<string, unknown>,
  status: 'running' | 'done' | 'failed',
  output?: string
): AgentUiEvent {
  const path = args.path ? String(args.path) : undefined
  const command = args.command ? String(args.command) : undefined
  if (name === 'search_code' || name === 'search_files') {
    const matches = output ? output.split('\n').filter(Boolean).length : undefined
    return {
      kind: 'search',
      id,
      label: status === 'running' ? 'Searching codebase' : 'Searched codebase',
      query: String(args.query ?? args.pattern ?? ''),
      matches: status === 'done' ? matches : undefined,
      status: status === 'failed' ? 'done' : status
    }
  }
  if (name === 'read_file' || name === 'list_directory') {
    return {
      kind: 'read_group',
      id,
      label: status === 'running' ? 'Reading files' : 'Read files',
      files: path ? [path] : [],
      status: status === 'failed' ? 'done' : status
    }
  }
  if (name === 'edit_file' || name === 'write_file' || name === 'create_file') {
    return {
      kind: 'edit_group',
      id,
      label: status === 'running' ? 'Editing' : status === 'failed' ? 'Edit failed' : 'Updated files',
      files: path ? [{ path }] : [],
      status: status === 'failed' ? 'done' : status
    }
  }
  if (name === 'run_terminal') {
    return {
      kind: 'command',
      id,
      label: status === 'running' ? 'Running command' : status === 'failed' ? 'Command failed' : 'Command finished',
      command: command || '',
      status,
      summary: status !== 'running' ? formatToolResult(name, status !== 'failed', output || '') : undefined,
      output: status !== 'running' ? output?.slice(0, 2000) : undefined
    }
  }
  if (name === 'get_diagnostics') {
    return {
      kind: 'diagnostics',
      id,
      label: status === 'running' ? 'Checking diagnostics' : 'Diagnostics',
      count: output && !output.includes('No diagnostics') ? output.split('\n').filter(Boolean).length : 0,
      status: status === 'failed' ? 'done' : status
    }
  }
  return {
    kind: 'status',
    id,
    label: status === 'running' ? humanizeToolName(name) : formatToolResult(name, status !== 'failed', output || '')
  }
}

function buildSystemPrompt(mode: AgentMode, projectType: string, agentsMd?: string): string {
  const modeRules =
    mode === 'ask'
      ? 'ASK MODE: Explain and answer only. Do not modify files or run mutating commands.'
      : mode === 'plan'
        ? 'PLAN MODE: Inspect the repository and produce a concrete implementation plan. Do not modify files or run mutating commands.'
        : mode === 'edit'
          ? 'EDIT MODE: You may inspect and edit files. Do not run terminal commands or delete files.'
          : 'AGENT MODE: You may search, read, edit, create files, run commands, diagnose errors, and verify fixes.'

  const typeLine =
    projectType && projectType !== 'unknown'
      ? `Repository stacks: ${projectType}`
      : 'Use the investigation brief stacks; a repo may contain multiple stacks.'

  return [
    'You are Anvil, a repository-aware coding assistant inside an IDE.',
    'Workflow: SEARCH → READ → UNDERSTAND → ANSWER. Never invent repository behavior.',
    'An INTERNAL INVESTIGATION BRIEF is provided with files already read and verified evidence. Ground every important claim in those files (or tools you call next).',
    'Answer the user\'s actual intent (capabilities, flow, security, etc.). Do not narrate absolute paths, htdocs, or missing AGENTS.md.',
    'Never invent run commands or ports (e.g. php index.php on port 80) unless listed as VERIFIED in the brief or confirmed via README/scripts you read.',
    'If no startup command is verified, say you have not found a documented startup command — then STOP. Do not invent what it probably is.',
    'When repository evidence is incomplete, explicitly state missing information. Never fill repository-specific gaps with plausible general knowledge (XAMPP, Apache, Web Store, etc.).',
    'Accuracy beats completeness for codebase facts. Prefer Verified facts; label general tips clearly if used at all.',
    'Distinguish Verified facts from Likely inferences. Prefer citing workspace-relative paths.',
    'For architecture/capability answers, structure with clear headings and optional verified flows (Name\\n↓\\nName).',
    'Never dump file samples, tool JSON, internal briefs, or "Detected type" into the user-facing answer.',
    'Never expose secrets to cloud providers. Never reveal private chain-of-thought.',
    'Never print raw tool-call JSON in your visible reply.',
    typeLine,
    modeRules,
    agentsMd ? `Project instructions (AGENTS.md) — follow when relevant:\n${agentsMd.slice(0, 4_000)}` : '',
    'When finished, summarize what the software does based on inspected code.'
  ]
    .filter(Boolean)
    .join('\n\n')
}

function formatToolActivity(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'inspect_project':
      return 'Analyzing project'
    case 'list_directory':
      return `Listing:\n${String(args.path ?? '.')}`
    case 'search_files':
      return `Searching files...\n${String(args.pattern)}`
    case 'search_code':
      return `Searching code...\n${String(args.query)}`
    case 'read_file':
      return `Reading:\n${String(args.path)}`
    case 'create_file':
      return `Creating:\n${String(args.path)}`
    case 'write_file':
      return `Writing:\n${String(args.path)}`
    case 'edit_file':
      return `Editing:\n${String(args.path)}`
    case 'delete_file':
      return `Deleting:\n${String(args.path)}`
    case 'run_terminal':
      return `Running:\n${String(args.command)}`
    case 'git_status':
      return 'Checking git status'
    case 'git_diff':
      return 'Reading git diff'
    case 'get_diagnostics':
      return 'Reading diagnostics'
    default:
      return `Running ${name}`
  }
}

function formatToolResult(name: string, ok: boolean, output: string): string {
  if (name === 'run_terminal') {
    const exit = output.match(/exit:\s*(-?\d+|null)/i)
    const code = exit?.[1]
    if (!ok) return `Command failed${code ? ` (exit ${code})` : ''}`
    if (code && code !== '0' && code !== 'null') return `Command failed (exit ${code})`
    return 'Command succeeded'
  }
  if (!ok) return 'Tool failed'
  if (name === 'edit_file' || name === 'write_file' || name === 'create_file') return 'File updated'
  if (name === 'read_file') return 'File read'
  if (name === 'get_diagnostics') {
    if (output.includes('No diagnostics')) return 'No issues found'
    const n = output.split('\n').filter(Boolean).length
    return `${n} diagnostics found`
  }
  if (name === 'git_diff') return output.includes('(no diff)') ? 'No diff' : 'Diff ready'
  return 'Done'
}

function toolStartCard(name: string, args: Record<string, unknown>): ToolActivityCard {
  const path = args.path ? String(args.path) : undefined
  const command = args.command ? String(args.command) : undefined
  switch (name) {
    case 'inspect_project':
      return {
        id: randomUUID(),
        category: 'status',
        title: 'Inspecting project',
        detail: 'workspace',
        timestamp: Date.now()
      }
    case 'search_files':
    case 'search_code':
      return {
        id: randomUUID(),
        category: 'search',
        title: 'Searching files',
        detail: String(args.query ?? args.pattern ?? ''),
        expandable: undefined,
        timestamp: Date.now()
      }
    case 'read_file':
      return {
        id: randomUUID(),
        category: 'read',
        title: 'Reading',
        path: path ?? String(args.path ?? '.'),
        detail: path,
        timestamp: Date.now()
      }
    case 'list_directory':
      return {
        id: randomUUID(),
        category: 'read',
        title: 'Listing folder',
        path: path ?? '.',
        detail: path ?? '.',
        timestamp: Date.now()
      }
    case 'edit_file':
    case 'write_file':
    case 'create_file':
      return {
        id: randomUUID(),
        category: 'edit',
        title: 'Editing',
        path,
        detail: path,
        timestamp: Date.now()
      }
    case 'run_terminal':
      return {
        id: randomUUID(),
        category: 'terminal',
        title: 'Running',
        command,
        detail: command,
        timestamp: Date.now()
      }
    case 'git_status':
    case 'git_diff':
      return {
        id: randomUUID(),
        category: 'git',
        title: name === 'git_status' ? 'Checking git status' : 'Reading git diff',
        detail: name,
        path,
        timestamp: Date.now()
      }
    case 'get_diagnostics':
      return {
        id: randomUUID(),
        category: 'status',
        title: 'Checking problems',
        detail: path ?? 'workspace',
        timestamp: Date.now()
      }
    default:
      return {
        id: randomUUID(),
        category: 'status',
        title: humanizeToolName(name),
        detail: path ?? command,
        timestamp: Date.now()
      }
  }
}

function humanizeToolName(name: string): string {
  return name.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

function toolResultCard(
  name: string,
  args: Record<string, unknown>,
  ok: boolean,
  output: string
): ToolActivityCard {
  const summary = formatToolResult(name, ok, output)
  if (name === 'edit_file' || name === 'write_file' || name === 'create_file') {
    const { additions, deletions } = countDiffStats(output)
    return {
      id: randomUUID(),
      category: ok ? 'edit' : 'error',
      title: ok ? 'Edited' : 'Edit failed',
      path: args.path ? String(args.path) : undefined,
      detail: summary,
      additions,
      deletions,
      ok,
      expandable: output.slice(0, 4000),
      timestamp: Date.now()
    }
  }
  if (name === 'inspect_project') {
    return {
      id: randomUUID(),
      category: ok ? 'result' : 'error',
      title: ok ? 'Project analyzed' : 'Inspection failed',
      detail: summary,
      ok,
      // Never attach the internal brief — it must not appear under Show details
      expandable: undefined,
      timestamp: Date.now()
    }
  }
  if (name === 'run_terminal') {
    return {
      id: randomUUID(),
      category: ok ? 'terminal' : 'error',
      title: ok ? 'Completed' : 'Failed',
      detail: summary,
      command: args.command ? String(args.command) : undefined,
      ok,
      expandable: output.slice(0, 4000),
      timestamp: Date.now()
    }
  }
  return {
    id: randomUUID(),
    category: ok ? 'result' : 'error',
    title: ok ? 'Done' : 'Failed',
    detail: summary,
    command: args.command ? String(args.command) : undefined,
    path: args.path ? String(args.path) : undefined,
    ok,
    expandable: output.slice(0, 4000),
    timestamp: Date.now()
  }
}

function fileChangeCard(change: FileChange): ToolActivityCard {
  const before = change.before ?? ''
  const after = change.after ?? ''
  const { additions, deletions } = countLineDelta(before, after)
  return {
    id: randomUUID(),
    category: 'edit',
    title: 'EDIT',
    path: change.path,
    detail: `${change.kind} · +${additions} -${deletions}`,
    additions,
    deletions,
    ok: true,
    expandable: after.slice(0, 2000),
    timestamp: Date.now()
  }
}

function countDiffStats(patch: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1
    if (line.startsWith('-') && !line.startsWith('---')) deletions += 1
  }
  return { additions, deletions }
}

function countLineDelta(before: string, after: string): { additions: number; deletions: number } {
  const b = before ? before.split('\n').length : 0
  const a = after ? after.split('\n').length : 0
  if (a >= b) return { additions: a - b, deletions: 0 }
  return { additions: 0, deletions: b - a }
}

function summarizePlan(text: string): string | null {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(' ')
  if (!cleaned) return null
  if (cleaned.length < 8) return null
  return `Planning implementation...\n${truncate(cleaned, 160)}`
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}\n...[truncated]`
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value)
}

function countRecent(list: string[], item: string): number {
  return list.filter((x) => x === item).length
}

function trimMessages(messages: ChatCompletionMessage[], maxChars: number): void {
  // Keep system + first user + recent tail
  if (messages.length <= 4) return
  const system = messages[0]
  const firstUser = messages[1]
  const tail: ChatCompletionMessage[] = []
  let used = (system?.content.length ?? 0) + (firstUser?.content.length ?? 0)
  for (let i = messages.length - 1; i >= 2; i--) {
    const m = messages[i]
    const size = m.content?.length ?? 0
    if (used + size > maxChars) break
    tail.unshift(m)
    used += size
  }
  messages.splice(0, messages.length, system, firstUser, ...tail)
}
