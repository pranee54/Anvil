import { create } from 'zustand'
import type {
  AgentActivity,
  AgentMode,
  AppSettings,
  ChatMessage,
  FileChange,
  FileNode,
  PendingPermission,
  TerminalCommandResult
} from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'

interface AppState {
  workspacePath: string | null
  tree: FileNode[]
  openFile: string | null
  openContent: string
  dirty: boolean
  settings: AppSettings
  mode: AgentMode
  messages: ChatMessage[]
  activities: AgentActivity[]
  changes: FileChange[]
  selectedChange: string | null
  permission: PendingPermission | null
  running: boolean
  bottomTab: 'terminal' | 'problems' | 'output' | 'diff'
  terminalLines: string[]
  settingsOpen: boolean
  setWorkspace: (path: string, tree: FileNode[]) => void
  setTree: (tree: FileNode[]) => void
  setOpenFile: (path: string | null, content?: string) => void
  setOpenContent: (content: string) => void
  setDirty: (dirty: boolean) => void
  setSettings: (settings: AppSettings) => void
  setMode: (mode: AgentMode) => void
  addMessage: (message: ChatMessage) => void
  addActivity: (activity: AgentActivity) => void
  clearActivities: () => void
  upsertChange: (change: FileChange) => void
  setChanges: (changes: FileChange[]) => void
  setSelectedChange: (path: string | null) => void
  setPermission: (permission: PendingPermission | null) => void
  setRunning: (running: boolean) => void
  setBottomTab: (tab: AppState['bottomTab']) => void
  appendTerminal: (line: string) => void
  setTerminalResult: (result: TerminalCommandResult) => void
  setSettingsOpen: (open: boolean) => void
}

export const useAppStore = create<AppState>((set) => ({
  workspacePath: null,
  tree: [],
  openFile: null,
  openContent: '',
  dirty: false,
  settings: DEFAULT_SETTINGS,
  mode: 'agent',
  messages: [],
  activities: [],
  changes: [],
  selectedChange: null,
  permission: null,
  running: false,
  bottomTab: 'terminal',
  terminalLines: ['Anvil terminal ready.'],
  settingsOpen: false,

  setWorkspace: (path, tree) => set({ workspacePath: path, tree }),
  setTree: (tree) => set({ tree }),
  setOpenFile: (path, content = '') => set({ openFile: path, openContent: content, dirty: false }),
  setOpenContent: (content) => set({ openContent: content, dirty: true }),
  setDirty: (dirty) => set({ dirty }),
  setSettings: (settings) => set({ settings, mode: settings.agentMode }),
  setMode: (mode) => set({ mode }),
  addMessage: (message) => set((s) => ({ messages: [...s.messages, message] })),
  addActivity: (activity) => set((s) => ({ activities: [...s.activities, activity] })),
  clearActivities: () => set({ activities: [] }),
  upsertChange: (change) =>
    set((s) => {
      const rest = s.changes.filter((c) => c.path !== change.path)
      return {
        changes: [...rest, change],
        selectedChange: s.selectedChange ?? change.path,
        bottomTab: 'diff'
      }
    }),
  setChanges: (changes) => set({ changes }),
  setSelectedChange: (path) =>
    set(path ? { selectedChange: path, bottomTab: 'diff' } : { selectedChange: null }),
  setPermission: (permission) => set({ permission }),
  setRunning: (running) => set({ running }),
  setBottomTab: (bottomTab) => set({ bottomTab }),
  appendTerminal: (line) => set((s) => ({ terminalLines: [...s.terminalLines, line] })),
  setTerminalResult: (result) =>
    set((s) => ({
      terminalLines: [
        ...s.terminalLines,
        `$ ${result.command}`,
        result.stdout,
        result.stderr,
        `exit ${result.exitCode}${result.timedOut ? ' (timeout)' : ''}`
      ].filter(Boolean),
      bottomTab: 'terminal'
    })),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen })
}))
