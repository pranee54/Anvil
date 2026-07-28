import * as vscode from 'vscode'
import { AnvilChatPanel } from './chat-panel'
import { ChatController } from './chat-controller'
import { registerOriginalContentProvider } from './diff-review'
import { AnvilRailProvider } from './sidebar-rail'
import { AnvilAgentSideView } from './agent-side-view'
import { AnvilStatusBar, friendlyConnectionMessage, maybeShowFirstRunSetup, showStatusBarMenu } from './status'
import { ModelGateway } from '@anvil/agent-core'
import { settingsFromConfig } from './settings'

let controller: ChatController | null = null
let statusBar: AnvilStatusBar | null = null
let sideView: AnvilAgentSideView | null = null

export function activate(context: vscode.ExtensionContext): void {
  registerOriginalContentProvider(context)
  controller = new ChatController(context)

  statusBar = new AnvilStatusBar(context)
  statusBar.startPolling()

  const rail = new AnvilRailProvider(context, controller)
  sideView = new AnvilAgentSideView(context, controller)

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(AnvilRailProvider.viewType, rail, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.window.registerWebviewViewProvider(AnvilAgentSideView.viewType, sideView, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  )

  const openSideChat = async (opts?: { newChat?: boolean; attachSelection?: boolean }) => {
    const editor = vscode.window.activeTextEditor
    const hasSelection = Boolean(editor && !editor.selection.isEmpty)
    const shouldAttach = opts?.attachSelection === true || (opts?.attachSelection !== false && hasSelection)
    if (shouldAttach) await controller!.attachActiveSelection()
    if (opts?.newChat) await controller!.newChat()
    await sideView!.reveal()
  }

  const cmds: Array<[string, (...args: never[]) => unknown]> = [
    ['anvil.openChat', async () => openSideChat()],
    ['anvil.openAgent', async () => openSideChat()],
    ['anvil.openChatPanel', async () => sideView!.reveal()],
    ['anvil.openChatInEditor', async () => AnvilChatPanel.show(context, controller!)],
    ['anvil.newChat', async () => openSideChat({ newChat: true, attachSelection: false })],
    [
      'anvil.runAgent',
      async () => {
        await openSideChat()
        const prompt = await vscode.window.showInputBox({ prompt: 'Anvil Agent task' })
        if (prompt) await controller!.startRun(prompt, 'agent')
      }
    ],
    [
      'anvil.askSelection',
      async () => {
        await openSideChat({ attachSelection: true })
        const q = await vscode.window.showInputBox({ value: 'Explain this' })
        if (q) await controller!.startRun(q, 'ask')
      }
    ],
    [
      'anvil.editSelection',
      async () => {
        await openSideChat({ attachSelection: true })
        const instruction = await vscode.window.showInputBox({
          prompt: 'How should Anvil edit the selection?'
        })
        if (instruction) await controller!.startRun(instruction, 'edit')
      }
    ],
    [
      'anvil.fixProblems',
      async () => {
        await openSideChat()
        await controller!.startRun(
          'Inspect @problems. Explain the errors. Fix them safely if Agent mode is appropriate.',
          'agent'
        )
      }
    ],
    [
      'anvil.explainFile',
      async () => {
        const editor = vscode.window.activeTextEditor
        if (!editor) return
        const file = vscode.workspace.asRelativePath(editor.document.uri)
        await openSideChat()
        await controller!.startRun(`Explain @file ${file}. Summarize purpose and key exports.`, 'ask')
      }
    ],
    [
      'anvil.selectModel',
      async () => {
        await controller!.refreshModels(true)
        await statusBar?.refresh()
      }
    ],
    [
      'anvil.testOllama',
      async () => {
        const settings = settingsFromConfig()
        const gateway = new ModelGateway()
        const result = await gateway.get(settings.model.provider).testConnection?.(settings.model)
        if (!result) return
        const friendly = friendlyConnectionMessage(result.message)
        if (result.ok) void vscode.window.showInformationMessage(`Connected · ${settings.model.model}`)
        else void vscode.window.showWarningMessage(friendly)
        await controller!.refreshModels()
        await statusBar?.refresh()
      }
    ],
    ['anvil.abortAgent', () => controller!.abort()],
    ['anvil.statusBarAction', async () => showStatusBarMenu()]
  ]

  for (const [id, fn] of cmds) {
    context.subscriptions.push(vscode.commands.registerCommand(id, fn))
  }

  void (async () => {
    await controller!.refreshModels()
    const state = await statusBar!.refresh()
    await maybeShowFirstRunSetup(context, state)
  })()
}

export function deactivate(): void {
  controller?.abort()
  controller = null
  sideView = null
}
