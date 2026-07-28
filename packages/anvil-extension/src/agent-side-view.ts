import * as vscode from 'vscode'
import type { AgentMode } from '@anvil/agent-core'
import type { ChatController } from './chat-controller'
import { pickContextAttachment } from './context'
import { buildChatHtml } from './chat-html'

/** Primary Anvil Agent surface — Secondary Side Bar (right). */
export class AnvilAgentSideView implements vscode.WebviewViewProvider {
  public static readonly viewType = 'anvil.agentChatView'
  private view?: vscode.WebviewView

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly controller: ChatController
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
    }
    webviewView.webview.html = buildChatHtml(webviewView.webview, this.context.extensionUri, 'side')

    const surface = this.controller.registerSurface({
      id: 'side',
      post: (msg) => void webviewView.webview.postMessage(msg),
      focusComposer: () => this.focusComposer()
    })

    webviewView.webview.onDidReceiveMessage(async (msg: Record<string, string>) => {
      await this.onMessage(msg)
    })

    webviewView.onDidDispose(() => surface.dispose())
    void this.controller.refreshModels()
  }

  focusComposer(): void {
    void this.view?.webview.postMessage({ type: 'focusComposer' })
  }

  async reveal(): Promise<void> {
    await vscode.commands.executeCommand('workbench.view.extension.anvil-agent')
    // Ensure secondary sidebar visible
    await vscode.commands.executeCommand('workbench.action.focusAuxiliaryBar').then(undefined, () => undefined)
    this.focusComposer()
  }

  private async onMessage(msg: Record<string, string>): Promise<void> {
    const actions = await this.controller.handleFileChangeActions()
    if (msg.type === 'ready') {
      this.controller.pushComposer()
      this.controller.replayActiveSession()
      this.controller.broadcast({
        type: 'rail',
        sessions: this.controller.railSessions(),
        status: 'Ready'
      })
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
    if (msg.type === 'openFile' && msg.path) {
      await openWorkspaceFile(msg.path, msg.line)
    }
    if (msg.type === 'showTerminal') {
      const existing = vscode.window.terminals.find((t) => t.name === 'Anvil Agent')
      ;(existing ?? vscode.window.createTerminal({ name: 'Anvil Agent' })).show(true)
    }
  }
}

export async function openWorkspaceFile(relPath: string, line?: string): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (!folder) return
  const uri = vscode.Uri.joinPath(folder.uri, relPath)
  try {
    const doc = await vscode.workspace.openTextDocument(uri)
    const editor = await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.One,
      preview: true,
      preserveFocus: false
    })
    const n = Number(line || 0)
    if (n > 0) {
      const pos = new vscode.Position(n - 1, 0)
      editor.selection = new vscode.Selection(pos, pos)
      editor.revealRange(new vscode.Range(pos, pos))
    }
  } catch {
    void vscode.window.showWarningMessage(`Could not open ${relPath}`)
  }
}
