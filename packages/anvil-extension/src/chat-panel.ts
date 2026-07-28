import * as vscode from 'vscode'
import type { AgentMode } from '@anvil/agent-core'
import type { ChatController } from './chat-controller'
import { pickContextAttachment } from './context'
import { buildChatHtml } from './chat-html'
import { openWorkspaceFile } from './agent-side-view'

const VIEW_TYPE = 'anvil.chatPanel'

/** Secondary: full-width Anvil Chat in the editor area. */
export class AnvilChatPanel {
  public static current: AnvilChatPanel | undefined
  private readonly panel: vscode.WebviewPanel
  private disposables: vscode.Disposable[] = []

  static async show(context: vscode.ExtensionContext, controller: ChatController): Promise<AnvilChatPanel> {
    if (AnvilChatPanel.current) {
      AnvilChatPanel.current.panel.reveal(vscode.ViewColumn.Beside, false)
      AnvilChatPanel.current.focusComposer()
      return AnvilChatPanel.current
    }
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'Anvil',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
      }
    )
    AnvilChatPanel.current = new AnvilChatPanel(panel, context, controller)
    return AnvilChatPanel.current
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly controller: ChatController
  ) {
    this.panel = panel
    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'anvil.svg')
    this.panel.webview.html = buildChatHtml(this.panel.webview, context.extensionUri, 'main')

    const surface = this.controller.registerSurface({
      id: 'main',
      post: (msg) => void this.panel.webview.postMessage(msg),
      focusComposer: () => this.focusComposer()
    })
    this.disposables.push(surface)

    this.disposables.push(
      this.panel.webview.onDidReceiveMessage(async (msg: Record<string, string>) => {
        await this.onMessage(msg)
      })
    )

    this.panel.onDidDispose(() => {
      AnvilChatPanel.current = undefined
      while (this.disposables.length) this.disposables.pop()?.dispose()
    })

    void this.controller.refreshModels()
  }

  focusComposer(): void {
    void this.panel.webview.postMessage({ type: 'focusComposer' })
  }

  private async onMessage(msg: Record<string, string>): Promise<void> {
    const actions = await this.controller.handleFileChangeActions()
    if (msg.type === 'ready') {
      this.controller.pushComposer()
      this.controller.replayActiveSession()
    }
    if (msg.type === 'submit' && msg.text?.trim()) {
      await this.controller.startRun(msg.text.trim(), (msg.mode as AgentMode) || this.controller.getMode())
    }
    if (msg.type === 'abort') this.controller.abort()
    if (msg.type === 'setMode' && msg.mode) this.controller.setMode(msg.mode as AgentMode)
    if (msg.type === 'pickContext' || msg.type === 'atTrigger') {
      const item = await pickContextAttachment()
      if (item) this.controller.addAttachment(item)
    }
    if (msg.type === 'removeAttachment' && msg.id) this.controller.removeAttachment(msg.id)
    if (msg.type === 'newChat') await this.controller.newChat()
    if (msg.type === 'history') await this.controller.showHistory()
    if (msg.type === 'openSettings') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'anvil')
    }
    if (msg.type === 'selectModel' && msg.model) await this.controller.selectModel(msg.model)
    if (msg.type === 'implementPlan' && msg.plan) {
      this.controller.setMode('agent')
      await this.controller.startRun(
        `Implement this plan carefully. Verify with diagnostics/tests after edits.\n\n${msg.plan}`,
        'agent'
      )
    }
    if (msg.type === 'resolvePermission' && msg.id) {
      this.controller.resolvePermission(msg.id, msg.allowed === 'true')
    }
    if (msg.type === 'retryLast') await this.controller.retryLast()
    if (msg.type === 'acceptAll') await actions.acceptAll()
    if (msg.type === 'rejectAll') await actions.rejectAll()
    if (msg.type === 'revertTask') await actions.revertTask()
    if (msg.type === 'viewChanges') await actions.viewChanges()
    if (msg.type === 'viewDiff' && msg.path) await actions.viewDiff(msg.path)
    if (msg.type === 'openFile' && msg.path) await openWorkspaceFile(msg.path, msg.line)
    if (msg.type === 'showTerminal') {
      const existing = vscode.window.terminals.find((t) => t.name === 'Anvil Agent')
      ;(existing ?? vscode.window.createTerminal({ name: 'Anvil Agent' })).show(true)
    }
  }
}
