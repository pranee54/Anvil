import * as vscode from 'vscode'
import {
  AgentOrchestrator,
  ModelGateway,
  type AgentMode,
  type FileChange,
  type ToolActivityCard
} from '@anvil/agent-core'
import { sanitizeUserFacingAnswer } from './answer-sanitize'
import { CheckpointStore } from './checkpoint'
import {
  buildIdeBridgeDiagnostics,
  enrichPrompt,
  type ContextAttachment
} from './context'
import {
  acceptChange,
  rejectChangeToOriginal,
  showNativeDiff
} from './diff-review'
import { settingsFromConfig } from './settings'
import { SessionStore, titleFromPrompt, type ChatSession } from './sessions'
import { friendlyConnectionMessage } from './status'
import { TurnMachine, type AgentUiEventLike } from './chat-turn'
import { normalizeMarkdown, stripProtocolNoise } from './markdown-normalize'

export type ChatHostMessage = Record<string, unknown>

type Surface = {
  id: string
  post: (msg: ChatHostMessage) => void
  focusComposer?: () => void
}

/**
 * Single source of truth for Anvil conversations (sidebar + editor).
 * UI renders from TurnMachine snapshots only.
 */
export class ChatController {
  readonly sessions: SessionStore
  readonly checkpoints = new CheckpointStore()
  private orchestrator: AgentOrchestrator | null = null
  private surfaces = new Map<string, Surface>()
  private activeSession: ChatSession | null = null
  private attachments: ContextAttachment[] = []
  private mode: AgentMode = 'agent'
  private lastMode: AgentMode = 'agent'
  private lastAssistantContent: string | null = null
  private lastUserPrompt: string | null = null
  private lastUserMode: AgentMode | null = null
  private models: string[] = []
  private modelStatus = ''
  private turns = new TurnMachine()
  private running = false
  private streamBuffer = ''
  private streamFlushTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly context: vscode.ExtensionContext) {
    this.sessions = new SessionStore(context.workspaceState)
  }

  registerSurface(surface: Surface): vscode.Disposable {
    this.surfaces.set(surface.id, surface)
    this.pushComposer()
    this.syncAttachments()
    this.pushSync()
    return new vscode.Disposable(() => this.surfaces.delete(surface.id))
  }

  broadcast(msg: ChatHostMessage): void {
    for (const s of this.surfaces.values()) s.post(msg)
  }

  private pushSync(opts?: { scrollToTurnId?: string }): void {
    this.broadcast({
      type: 'sync',
      turns: this.turns.snapshot(),
      running: this.running,
      scrollToTurnId: opts?.scrollToTurnId
    })
  }

  private pushActiveTurn(): void {
    const active = this.turns.getActive()
    if (!active) {
      this.pushSync()
      return
    }
    this.broadcast({ type: 'turn_upsert', turn: active, running: this.running })
  }

  getMode(): AgentMode {
    return this.mode
  }

  setMode(mode: AgentMode): void {
    this.mode = mode
    this.lastMode = mode
    if (this.activeSession) {
      this.activeSession.mode = mode
      void this.sessions.saveSession(this.activeSession)
    }
    this.pushComposer()
    this.broadcast({ type: 'rail', sessions: this.railSessions(), activeId: this.activeSession?.id })
  }

  getAttachments(): ContextAttachment[] {
    return this.attachments
  }

  addAttachment(item: ContextAttachment): void {
    this.attachments.push(item)
    this.syncAttachments()
  }

  removeAttachment(id: string): void {
    this.attachments = this.attachments.filter((a) => a.id !== id)
    this.syncAttachments()
  }

  clearAttachments(): void {
    this.attachments = []
    this.syncAttachments()
  }

  abort(): void {
    this.getOrchestrator().abort()
    this.flushStream(true)
    this.turns.stop()
    this.running = false
    this.persistTurns()
    this.pushSync()
    this.pushComposer()
    this.broadcast({ type: 'status', message: 'Stopped' })
  }

  resolvePermission(id: string, allowed: boolean): void {
    this.getOrchestrator().resolvePermission(id, allowed)
  }

  async retryLast(): Promise<void> {
    if (!this.lastUserPrompt) return
    await this.startRun(this.lastUserPrompt, this.lastUserMode || this.mode)
  }

  async openOrFocusChat(options?: { newChat?: boolean; attachSelection?: boolean }): Promise<void> {
    if (options?.attachSelection) await this.attachActiveSelection()
    if (options?.newChat) await this.newChat()
    await vscode.commands.executeCommand('anvil.openChatPanel')
  }

  async attachActiveSelection(): Promise<void> {
    const editor = vscode.window.activeTextEditor
    if (!editor || editor.selection.isEmpty) return
    const file = vscode.workspace.asRelativePath(editor.document.uri)
    const start = editor.selection.start.line + 1
    const end = editor.selection.end.line + 1
    const text = editor.document.getText(editor.selection).slice(0, 8000)
    this.addAttachment({
      id: `sel_${Date.now()}`,
      kind: 'selection',
      label: `Selection · ${file}:${start}-${end}`,
      content: `@selection ${file}:${start}-${end}\n\`\`\`\n${text}\n\`\`\``
    })
  }

  async newChat(): Promise<void> {
    const settings = settingsFromConfig()
    this.activeSession = await this.sessions.create({
      workspace: workspaceKey(),
      mode: this.mode,
      model: settings.model.model
    })
    this.lastAssistantContent = null
    this.turns.clear()
    this.running = false
    this.broadcast({ type: 'reset' })
    this.pushSync()
    this.pushComposer()
    this.clearAttachments()
    this.broadcast({ type: 'rail', sessions: this.railSessions(), activeId: this.activeSession.id })
  }

  async showHistory(): Promise<void> {
    const list = this.sessions.listForWorkspace(workspaceKey())
    if (!list.length) {
      void vscode.window.showInformationMessage('No previous chats in this workspace.')
      return
    }
    const picked = await vscode.window.showQuickPick(
      [
        ...list.map((s) => ({
          label: s.title,
          description: new Date(s.updatedAt).toLocaleString(),
          session: s,
          action: 'open' as const
        })),
        { label: '$(trash) Delete a chat…', description: '', session: undefined, action: 'delete' as const },
        { label: '$(edit) Rename current chat…', description: '', session: undefined, action: 'rename' as const }
      ],
      { placeHolder: 'Chat history' }
    )
    if (!picked) return
    if (picked.action === 'delete') {
      await this.deleteChatInteractive()
      return
    }
    if (picked.action === 'rename') {
      await this.renameActiveChat()
      return
    }
    if (picked.session) await this.openSession(picked.session)
  }

  async openSession(session: ChatSession): Promise<void> {
    this.activeSession = session
    await this.sessions.setActiveId(session.id)
    this.mode = session.mode
    this.turns.loadPersisted(session.turns || [])
    this.running = false
    this.broadcast({ type: 'reset' })
    this.pushSync()
    this.pushComposer()
    this.broadcast({ type: 'rail', sessions: this.railSessions(), activeId: session.id })
  }

  replayActiveSession(): void {
    if (!this.activeSession) {
      void this.ensureSession().then(() => {
        if (this.activeSession?.turns?.length) {
          this.turns.loadPersisted(this.activeSession.turns)
        }
        this.pushSync()
      })
      return
    }
    this.turns.loadPersisted(this.activeSession.turns || [])
    this.pushSync()
  }

  async renameActiveChat(): Promise<void> {
    if (!this.activeSession) return
    const title = await vscode.window.showInputBox({
      prompt: 'Rename chat',
      value: this.activeSession.title
    })
    if (!title?.trim()) return
    this.activeSession.title = title.trim()
    await this.sessions.saveSession(this.activeSession)
    this.broadcast({ type: 'rail', sessions: this.railSessions(), activeId: this.activeSession.id })
  }

  async deleteChatInteractive(): Promise<void> {
    const list = this.sessions.listForWorkspace(workspaceKey())
    const picked = await vscode.window.showQuickPick(
      list.map((s) => ({ label: s.title, session: s })),
      { placeHolder: 'Delete chat' }
    )
    if (!picked) return
    await this.sessions.delete(picked.session.id)
    if (this.activeSession?.id === picked.session.id) await this.newChat()
    else this.broadcast({ type: 'rail', sessions: this.railSessions(), activeId: this.activeSession?.id })
  }

  async selectModel(model: string): Promise<void> {
    if (model === '__auto__') {
      this.pushComposer()
      return
    }
    await vscode.workspace.getConfiguration('anvil').update('model', model, true)
    if (this.activeSession) {
      this.activeSession.model = model
      await this.sessions.saveSession(this.activeSession)
    }
    await this.refreshModels()
  }

  async refreshModels(pick = false): Promise<void> {
    const settings = settingsFromConfig()
    const gateway = new ModelGateway()
    const provider = gateway.get(settings.model.provider)
    if (!provider.listModels) {
      this.models = []
      this.modelStatus = 'Model list unavailable'
      this.pushComposer()
      return
    }
    try {
      const models = await provider.listModels(settings.model.baseUrl)
      this.models = models.map((m) => m.name)
      this.modelStatus = this.models.length
        ? `Connected · ${this.models.length} model(s)`
        : 'Connected · no models installed'
      this.pushComposer()
      if (pick) {
        if (!this.models.length) {
          void vscode.window.showWarningMessage('No models installed.')
          return
        }
        const chosen = await vscode.window.showQuickPick(this.models, { placeHolder: 'Select model' })
        if (chosen) await this.selectModel(chosen)
      }
    } catch (err) {
      this.models = []
      this.modelStatus = friendlyConnectionMessage(err instanceof Error ? err.message : String(err))
      this.pushComposer()
    }
  }

  pushComposer(): void {
    const s = settingsFromConfig()
    this.broadcast({
      type: 'composer',
      mode: this.mode,
      model: s.model.model,
      models: this.models,
      modelStatus: this.modelStatus,
      running: this.running
    })
    void this.refreshAgentsMdFlag()
  }

  private async refreshAgentsMdFlag(): Promise<void> {
    const folder = root()
    if (!folder) return
    try {
      await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder, 'AGENTS.md'))
      this.broadcast({ type: 'meta', agentsMd: true })
    } catch {
      this.broadcast({ type: 'meta', agentsMd: false })
    }
  }

  syncAttachments(): void {
    this.broadcast({
      type: 'attachments',
      items: this.attachments.map((a) => ({ id: a.id, label: a.label }))
    })
  }

  railSessions(): Array<{ id: string; title: string; updatedAt: number }> {
    return this.sessions.listForWorkspace(workspaceKey()).map((s) => ({
      id: s.id,
      title: s.title,
      updatedAt: s.updatedAt
    }))
  }

  async startRun(message: string, mode?: AgentMode): Promise<void> {
    const folder = root()
    if (!folder) {
      void vscode.window.showWarningMessage('Open a folder first.')
      return
    }
    if (mode) this.setMode(mode)
    this.lastMode = this.mode
    this.lastUserPrompt = message
    this.lastUserMode = this.mode
    this.lastAssistantContent = null
    this.streamBuffer = ''

    const session = await this.ensureSession(message)
    if (session.messages.length === 0 && message.trim()) {
      session.title = titleFromPrompt(message)
    }

    const history = this.sessions.historyForModel(session)

    // Turn: user message FIRST — never push activities before this
    const turn = this.turns.beginTurn(message)
    this.running = true
    this.persistTurns()
    this.pushSync({ scrollToTurnId: turn.id })
    this.pushComposer()
    this.broadcast({ type: 'rail', sessions: this.railSessions(), activeId: session.id, status: 'Working…' })

    session.mode = this.mode
    session.model = settingsFromConfig().model.model
    await this.sessions.saveSession(session)

    const enriched = await enrichPrompt(message, this.attachments)
    this.clearAttachments()
    await this.getOrchestrator().run({
      message: enriched,
      mode: this.mode,
      workspacePath: folder.fsPath,
      history
    })
  }

  async handleFileChangeActions(): Promise<{
    acceptAll: () => Promise<void>
    rejectAll: () => Promise<void>
    revertTask: () => Promise<void>
    viewChanges: () => Promise<void>
    viewDiff: (path: string) => Promise<void>
  }> {
    return {
      acceptAll: async () => {
        const folder = root()
        if (!folder) return
        for (const c of this.checkpoints.listChanges()) {
          await acceptChange(folder, c)
          await this.getOrchestrator().applyChange(c.path)
        }
        this.broadcast({ type: 'taskSummary', filesChanged: 0, files: [] })
      },
      rejectAll: async () => {
        const folder = root()
        if (!folder) return
        for (const c of [...this.checkpoints.listChanges()].reverse()) {
          await rejectChangeToOriginal(folder, c)
          await this.getOrchestrator().rejectChange(c.path)
        }
        void vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer')
        this.broadcast({ type: 'taskSummary', filesChanged: 0, files: [] })
      },
      revertTask: async () => {
        const folder = root()
        if (!folder) return
        const n = await this.checkpoints.revertTask(folder)
        await this.getOrchestrator().revertAllTaskChanges()
        void vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer')
        void vscode.window.showInformationMessage(`Reverted ${n} file(s).`)
        this.broadcast({ type: 'taskSummary', filesChanged: 0, files: [] })
      },
      viewChanges: async () => {
        const folder = root()
        if (!folder) return
        const changes = this.checkpoints.listChanges()
        if (!changes.length) return
        const picked = await vscode.window.showQuickPick(
          changes.map((c) => ({ label: c.path, change: c })),
          { placeHolder: 'Review change' }
        )
        if (picked) await showNativeDiff(folder, picked.change)
      },
      viewDiff: async (path) => {
        const folder = root()
        if (!folder) return
        const change = this.checkpoints.listChanges().find((c) => c.path === path)
        if (change) await showNativeDiff(folder, change)
      }
    }
  }

  private async ensureSession(firstPrompt?: string): Promise<ChatSession> {
    const ws = workspaceKey()
    if (this.activeSession && this.activeSession.workspace === ws) return this.activeSession
    const activeId = this.sessions.getActiveId()
    if (activeId) {
      const existing = this.sessions.get(activeId)
      if (existing && existing.workspace === ws) {
        this.activeSession = existing
        if (existing.turns?.length) this.turns.loadPersisted(existing.turns)
        return existing
      }
    }
    this.activeSession = await this.sessions.create({
      workspace: ws,
      mode: this.mode,
      model: settingsFromConfig().model.model,
      firstPrompt
    })
    this.turns.clear()
    return this.activeSession
  }

  getOrchestrator(): AgentOrchestrator {
    if (!this.orchestrator) {
      this.orchestrator = new AgentOrchestrator(
        () => settingsFromConfig(),
        (event) => this.onAgentEvent(event)
      )
      this.orchestrator.setIdeBridge({
        getDiagnostics: () => buildIdeBridgeDiagnostics(),
        onTerminalCommand: (command) => {
          if (!vscode.workspace.isTrusted) return
          const existing = vscode.window.terminals.find((t) => t.name === 'Anvil Agent')
          const term = existing ?? vscode.window.createTerminal({ name: 'Anvil Agent' })
          term.show(true)
          term.sendText(`# Anvil ran: ${command}`, false)
          this.broadcast({ type: 'bgTerminal', count: 1 })
        }
      })
    }
    return this.orchestrator
  }

  private onAgentEvent(event: { type: string; data: unknown }): void {
    if (event.type === 'checkpoint') {
      this.checkpoints.begin((event.data as { taskId: string }).taskId)
    }
    if (event.type === 'stream_clear') {
      this.streamBuffer = ''
      this.turns.setAnswer('')
      this.pushActiveTurn()
    }
    if (event.type === 'stream_delta') {
      const text = (event.data as { text: string }).text
      if (text) {
        this.streamBuffer += text
        this.scheduleStreamFlush()
      }
    }
    if (event.type === 'agent_event') {
      this.turns.applyEvent(event.data as AgentUiEventLike)
      this.pushActiveTurn()
    }
    if (event.type === 'tool_card') {
      // Prefer agent_event mapping; keep card only for edit stats enrichment
      const card = event.data as ToolActivityCard
      if (card.path && (card.additions != null || card.deletions != null)) {
        this.turns.applyEvent({
          kind: 'edit_group',
          id: `edit_${card.path}`,
          files: [{ path: card.path, additions: card.additions, deletions: card.deletions }],
          status: 'done'
        })
        this.pushActiveTurn()
      }
    }
    if (event.type === 'investigation') {
      const data = event.data as { filesRead?: string[]; sourceFiles?: string[] }
      const sources = data.sourceFiles?.length ? data.sourceFiles : data.filesRead || []
      this.turns.setSources(sources)
      this.turns.setStatus('investigating')
      this.pushActiveTurn()
    }
    if (event.type === 'message') {
      this.flushStream(true)
      let content = sanitizeUserFacingAnswer((event.data as { content: string }).content || '')
      content = normalizeMarkdown(stripProtocolNoise(content))
      if (content && content === this.lastAssistantContent) return
      this.lastAssistantContent = content
      this.turns.setAnswer(content)
      this.turns.setStatus('answering')
      this.pushActiveTurn()
    }
    if (event.type === 'file_change') {
      const change = event.data as FileChange & { taskId?: string }
      this.checkpoints.recordChange(change)
      this.turns.applyEvent({
        kind: 'edit_group',
        id: `edit_${change.path}`,
        files: [{ path: change.path }],
        status: 'done'
      })
      this.pushActiveTurn()
      if (this.lastMode === 'edit') {
        const folder = root()
        if (folder) void showNativeDiff(folder, change)
      }
      void vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer')
    }
    if (event.type === 'permission_request') {
      const perm = event.data as {
        id: string
        reason: string
        toolName: string
        arguments?: Record<string, unknown>
      }
      this.broadcast({
        type: 'permission',
        id: perm.id,
        reason: perm.reason,
        toolName: perm.toolName,
        command: perm.arguments?.command ? String(perm.arguments.command) : undefined
      })
      if (!vscode.workspace.isTrusted && isRisky(perm.toolName)) {
        void vscode.window.showWarningMessage('Workspace untrusted — blocked risky Anvil tool.')
        this.getOrchestrator().resolvePermission(perm.id, false)
        return
      }
      void vscode.window
        .showWarningMessage(`Anvil: ${perm.reason} (${perm.toolName})`, 'Allow', 'Deny')
        .then((c) => this.getOrchestrator().resolvePermission(perm.id, c === 'Allow'))
    }
    if (event.type === 'error') {
      this.flushStream(true)
      const detail = friendlyConnectionMessage((event.data as { message: string }).message)
      this.turns.complete({ error: detail })
      this.running = false
      this.persistTurns()
      this.pushSync()
      this.pushComposer()
      this.broadcast({ type: 'error', message: detail })
    }
    if (event.type === 'done') {
      this.flushStream(true)
      const active = this.turns.getActive()
      if (active && active.status !== 'failed' && active.status !== 'stopped') {
        this.turns.complete()
      }
      this.running = false
      this.persistTurns()
      this.pushSync()
      this.pushComposer()
      const changes = this.checkpoints.listChanges()
      this.broadcast({ type: 'rail', sessions: this.railSessions(), activeId: this.activeSession?.id, status: 'Idle' })
      this.broadcast({
        type: 'taskSummary',
        filesChanged: changes.length,
        files: changes.map((c) => c.path)
      })
      void vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer')
    }
  }

  private scheduleStreamFlush(): void {
    if (this.streamFlushTimer) return
    this.streamFlushTimer = setTimeout(() => {
      this.streamFlushTimer = null
      this.flushStream(false)
    }, 48)
  }

  private flushStream(force: boolean): void {
    if (this.streamFlushTimer) {
      clearTimeout(this.streamFlushTimer)
      this.streamFlushTimer = null
    }
    if (!this.streamBuffer && !force) return
    if (this.streamBuffer) {
      const chunk = this.streamBuffer
      this.streamBuffer = ''
      // Append raw — never trim; normalize only at final message
      this.turns.appendAnswerDelta(chunk)
      this.pushActiveTurn()
    }
  }

  private persistTurns(): void {
    if (!this.activeSession) return
    this.activeSession.turns = this.turns.toPersisted()
    void this.sessions.saveSession(this.activeSession)
  }
}

function isRisky(toolName: string): boolean {
  return ['run_terminal', 'delete_file', 'write_file', 'edit_file'].includes(toolName)
}

function root(): vscode.Uri | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri
}

function workspaceKey(): string {
  return root()?.fsPath || 'no-workspace'
}
