import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { IPC } from '@shared/ipc'
import type { AppSettings, AgentRunRequest } from '@shared/types'
import { getSettings, getSettingsWithSecrets, setSettings } from './config/settings'
/** @deprecated Prefer packages/anvil-extension; agent logic from @anvil/agent-core */
import { AgentOrchestrator, ModelGateway } from './agent-core-bridge'
import {
  buildFileTree,
  openFolderDialog,
  readWorkspaceFile,
  writeWorkspaceFile
} from './workspace/fs'
import { runTerminalCommand } from './terminal/runner'
import { gitDiff, gitStatus } from './git/git'

const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null
let workspacePath: string | null = null

const orchestrator = new AgentOrchestrator(
  () => getSettingsWithSecrets(),
  (event) => {
    mainWindow?.webContents.send(IPC.AGENT_EVENT, event)
  }
)

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: 'Anvil',
    backgroundColor: '#0f1419',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.OPEN_FOLDER, async () => {
    const selected = await openFolderDialog(mainWindow)
    if (selected) {
      workspacePath = selected
      const tree = await buildFileTree(selected)
      return { path: selected, tree }
    }
    return null
  })

  ipcMain.handle(IPC.GET_TREE, async (_e, root?: string) => {
    const path = root || workspacePath
    if (!path) return []
    workspacePath = path
    return buildFileTree(path)
  })

  ipcMain.handle(IPC.READ_FILE, async (_e, relativePath: string) => {
    if (!workspacePath) throw new Error('No workspace open')
    return readWorkspaceFile(workspacePath, relativePath)
  })

  ipcMain.handle(IPC.WRITE_FILE, async (_e, relativePath: string, content: string) => {
    if (!workspacePath) throw new Error('No workspace open')
    await writeWorkspaceFile(workspacePath, relativePath, content)
    return true
  })

  ipcMain.handle(IPC.GET_SETTINGS, async () => {
    const settings = getSettings()
    const withSecrets = getSettingsWithSecrets()
    return {
      ...settings,
      model: {
        ...settings.model,
        apiKey: withSecrets.model.apiKey ? '••••••••' : ''
      }
    }
  })

  ipcMain.handle(IPC.SET_SETTINGS, async (_e, partial: Partial<AppSettings>) => {
    if (partial.model?.apiKey === '••••••••') {
      const { apiKey: _apiKey, ...modelRest } = partial.model
      partial = { ...partial, model: modelRest as AppSettings['model'] }
    }
    return setSettings(partial)
  })

  ipcMain.handle(IPC.TEST_PROVIDER, async () => {
    const settings = getSettingsWithSecrets()
    const gateway = new ModelGateway()
    const provider = gateway.get(settings.model.provider)
    if (!provider.testConnection) {
      return { ok: false, status: 'disconnected', message: 'Provider cannot be tested' }
    }
    return provider.testConnection(settings.model)
  })

  ipcMain.handle(IPC.LIST_OLLAMA_MODELS, async (_e, baseUrl?: string) => {
    const settings = getSettings()
    const gateway = new ModelGateway()
    const provider = gateway.get('ollama')
    if (!provider.listModels) return []
    try {
      return await provider.listModels(baseUrl || settings.model.baseUrl)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(message)
    }
  })

  ipcMain.handle(IPC.AGENT_RUN, async (_e, request: AgentRunRequest) => {
    if (!request.workspacePath && !workspacePath) throw new Error('Open a project folder first')
    const root = request.workspacePath || workspacePath!
    workspacePath = root
    void orchestrator.run({
      message: request.message,
      mode: request.mode,
      workspacePath: root
    })
    return { started: true }
  })

  ipcMain.handle(IPC.AGENT_ABORT, async () => {
    orchestrator.abort()
    return true
  })

  ipcMain.handle(IPC.AGENT_RESOLVE_PERMISSION, async (_e, id: string, allowed: boolean) => {
    orchestrator.resolvePermission(id, allowed)
    return true
  })

  ipcMain.handle(IPC.AGENT_APPLY_CHANGE, async (_e, filePath: string) => {
    await orchestrator.applyChange(filePath)
    return true
  })

  ipcMain.handle(IPC.AGENT_REJECT_CHANGE, async (_e, filePath: string) => {
    await orchestrator.rejectChange(filePath)
    return true
  })

  ipcMain.handle(IPC.AGENT_REVERT_CHANGE, async (_e, filePath: string) => {
    await orchestrator.revertChange(filePath)
    return true
  })

  ipcMain.handle(IPC.AGENT_GET_CHANGES, async () => orchestrator.getChanges())

  ipcMain.handle(IPC.TERMINAL_RUN, async (_e, command: string, cwd?: string) => {
    const root = cwd || workspacePath || process.cwd()
    const result = await runTerminalCommand({ command, cwd: root })
    mainWindow?.webContents.send(IPC.TERMINAL_OUTPUT, result)
    return result
  })

  ipcMain.handle(IPC.GIT_STATUS, async () => {
    if (!workspacePath) return ''
    return gitStatus(workspacePath)
  })

  ipcMain.handle(IPC.GIT_DIFF, async (_e, filePath?: string, staged?: boolean) => {
    if (!workspacePath) return ''
    return gitDiff(workspacePath, filePath, staged)
  })
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
