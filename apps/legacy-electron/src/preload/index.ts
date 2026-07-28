import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  AgentRunEvent,
  AgentRunRequest,
  AppSettings,
  FileChange,
  FileNode,
  OllamaModel,
  TerminalCommandResult
} from '../shared/types'

const api = {
  openFolder: (): Promise<{ path: string; tree: FileNode[] } | null> =>
    ipcRenderer.invoke(IPC.OPEN_FOLDER),

  getTree: (root?: string): Promise<FileNode[]> => ipcRenderer.invoke(IPC.GET_TREE, root),

  readFile: (path: string): Promise<string> => ipcRenderer.invoke(IPC.READ_FILE, path),

  writeFile: (path: string, content: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.WRITE_FILE, path, content),

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.GET_SETTINGS),

  setSettings: (partial: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.SET_SETTINGS, partial),

  listOllamaModels: (baseUrl?: string): Promise<OllamaModel[]> =>
    ipcRenderer.invoke(IPC.LIST_OLLAMA_MODELS, baseUrl),

  testProvider: (): Promise<import('../shared/types').ProviderTestResult> =>
    ipcRenderer.invoke(IPC.TEST_PROVIDER),

  runAgent: (request: AgentRunRequest): Promise<{ started: boolean }> =>
    ipcRenderer.invoke(IPC.AGENT_RUN, request),

  abortAgent: (): Promise<boolean> => ipcRenderer.invoke(IPC.AGENT_ABORT),

  resolvePermission: (id: string, allowed: boolean): Promise<boolean> =>
    ipcRenderer.invoke(IPC.AGENT_RESOLVE_PERMISSION, id, allowed),

  applyChange: (path: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.AGENT_APPLY_CHANGE, path),

  rejectChange: (path: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.AGENT_REJECT_CHANGE, path),

  revertChange: (path: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.AGENT_REVERT_CHANGE, path),

  getChanges: (): Promise<FileChange[]> => ipcRenderer.invoke(IPC.AGENT_GET_CHANGES),

  runTerminal: (command: string, cwd?: string): Promise<TerminalCommandResult> =>
    ipcRenderer.invoke(IPC.TERMINAL_RUN, command, cwd),

  gitStatus: (): Promise<string> => ipcRenderer.invoke(IPC.GIT_STATUS),

  gitDiff: (path?: string, staged?: boolean): Promise<string> =>
    ipcRenderer.invoke(IPC.GIT_DIFF, path, staged),

  onAgentEvent: (callback: (event: AgentRunEvent) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, event: AgentRunEvent): void => callback(event)
    ipcRenderer.on(IPC.AGENT_EVENT, listener)
    return () => ipcRenderer.removeListener(IPC.AGENT_EVENT, listener)
  },

  onTerminalOutput: (callback: (result: TerminalCommandResult) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, result: TerminalCommandResult): void =>
      callback(result)
    ipcRenderer.on(IPC.TERMINAL_OUTPUT, listener)
    return () => ipcRenderer.removeListener(IPC.TERMINAL_OUTPUT, listener)
  }
}

contextBridge.exposeInMainWorld('anvil', api)

export type AnvilApi = typeof api
