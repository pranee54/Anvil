import * as vscode from 'vscode'
import { ModelGateway } from '@anvil/agent-core'
import { settingsFromConfig } from './settings'

export type ConnectionUiState =
  | { kind: 'local'; model: string }
  | { kind: 'cloud'; model: string }
  | { kind: 'offline'; detail?: string }
  | { kind: 'checking' }

export class AnvilStatusBar {
  private item: vscode.StatusBarItem
  private timer?: NodeJS.Timeout

  constructor(private readonly context: vscode.ExtensionContext) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
    this.item.command = 'anvil.statusBarAction'
    this.item.tooltip = 'Anvil AI'
    this.context.subscriptions.push(this.item)
    this.item.show()
    this.setState({ kind: 'checking' })
  }

  setState(state: ConnectionUiState): void {
    if (state.kind === 'checking') {
      this.item.text = '$(sync~spin) Anvil: Checking…'
      return
    }
    if (state.kind === 'offline') {
      this.item.text = '$(warning) Anvil: Local AI Offline'
      return
    }
    if (state.kind === 'cloud') {
      this.item.text = `$(cloud) Anvil: CLOUD · ${state.model}`
      return
    }
    this.item.text = `$(home) Anvil: LOCAL · ${state.model}`
  }

  startPolling(intervalMs = 30_000): void {
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), intervalMs)
    this.context.subscriptions.push({ dispose: () => clearInterval(this.timer) })
  }

  async refresh(): Promise<ConnectionUiState> {
    const settings = settingsFromConfig()
    const provider = settings.model.provider
    const model = settings.model.model

    if (provider !== 'ollama') {
      const state: ConnectionUiState = { kind: 'cloud', model }
      this.setState(state)
      return state
    }

    this.setState({ kind: 'checking' })
    try {
      const gateway = new ModelGateway()
      const result = await gateway.get('ollama').testConnection?.(settings.model)
      if (!result?.ok || result.status === 'model_not_found') {
        const state: ConnectionUiState = { kind: 'offline', detail: result?.message }
        this.setState(state)
        return state
      }
      const state: ConnectionUiState = { kind: 'local', model }
      this.setState(state)
      return state
    } catch {
      const state: ConnectionUiState = { kind: 'offline' }
      this.setState(state)
      return state
    }
  }
}

export async function showStatusBarMenu(): Promise<void> {
  const pick = await vscode.window.showQuickPick(
    [
      { label: 'Select Model', id: 'select' },
      { label: 'Test Connection', id: 'test' },
      { label: 'Open Anvil Settings', id: 'settings' },
      { label: 'Open Anvil Agent', id: 'agent' }
    ],
    { placeHolder: 'Anvil' }
  )
  if (!pick) return
  if (pick.id === 'select') await vscode.commands.executeCommand('anvil.selectModel')
  if (pick.id === 'test') await vscode.commands.executeCommand('anvil.testOllama')
  if (pick.id === 'settings') await vscode.commands.executeCommand('workbench.action.openSettings', 'anvil')
  if (pick.id === 'agent') await vscode.commands.executeCommand('anvil.openAgent')
}

export async function maybeShowFirstRunSetup(
  context: vscode.ExtensionContext,
  state: ConnectionUiState
): Promise<void> {
  if (state.kind !== 'offline') return
  const settings = settingsFromConfig()
  if (settings.model.provider !== 'ollama') return

  const key = 'anvil.dismissedOfflineBanner'
  if (context.globalState.get(key)) return

  const choice = await vscode.window.showWarningMessage(
    'Local AI is not running. Start Ollama to use Anvil Agent locally.',
    'Retry',
    'Open AI Settings',
    'Dismiss'
  )
  if (choice === 'Retry') {
    await vscode.commands.executeCommand('anvil.testOllama')
  } else if (choice === 'Open AI Settings') {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'anvil')
  } else if (choice === 'Dismiss') {
    await context.globalState.update(key, true)
  }
}

export function friendlyConnectionMessage(raw: string): string {
  const lower = raw.toLowerCase()
  if (lower.includes('econnrefused') || lower.includes('fetch failed') || lower.includes('not running')) {
    return 'Local AI is not running. Start Ollama, then click Retry.'
  }
  if (lower.includes('not installed') || lower.includes('not found') || lower.includes('404')) {
    return 'Selected model is not installed. Choose another model in Anvil settings.'
  }
  return raw
}
