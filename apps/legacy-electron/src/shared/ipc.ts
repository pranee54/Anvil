export const IPC = {
  // Workspace
  OPEN_FOLDER: 'workspace:open-folder',
  GET_TREE: 'workspace:get-tree',
  READ_FILE: 'workspace:read-file',
  WRITE_FILE: 'workspace:write-file',
  LIST_DIR: 'workspace:list-dir',

  // Settings
  GET_SETTINGS: 'settings:get',
  SET_SETTINGS: 'settings:set',
  LIST_OLLAMA_MODELS: 'settings:list-ollama-models',
  TEST_PROVIDER: 'settings:test-provider',

  // Agent
  AGENT_RUN: 'agent:run',
  AGENT_ABORT: 'agent:abort',
  AGENT_EVENT: 'agent:event',
  AGENT_RESOLVE_PERMISSION: 'agent:resolve-permission',
  AGENT_APPLY_CHANGE: 'agent:apply-change',
  AGENT_REJECT_CHANGE: 'agent:reject-change',
  AGENT_REVERT_CHANGE: 'agent:revert-change',
  AGENT_GET_CHANGES: 'agent:get-changes',

  // Terminal
  TERMINAL_RUN: 'terminal:run',
  TERMINAL_OUTPUT: 'terminal:output',

  // Git
  GIT_STATUS: 'git:status',
  GIT_DIFF: 'git:diff'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
