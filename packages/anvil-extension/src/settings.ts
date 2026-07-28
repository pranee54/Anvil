import * as vscode from 'vscode'
import { DEFAULT_SETTINGS, type AppSettings, type ModelProviderId } from '@anvil/agent-core'

export function settingsFromConfig(): AppSettings {
  const cfg = vscode.workspace.getConfiguration('anvil')
  const base = DEFAULT_SETTINGS
  const permissionMode = cfg.get<string>('permissionMode') || 'ask'

  return {
    ...base,
    agentMode: (cfg.get('defaultMode') as AppSettings['agentMode']) || base.agentMode,
    model: {
      ...base.model,
      provider: (cfg.get<string>('provider') as ModelProviderId) || 'ollama',
      model: cfg.get<string>('model') || base.model.model,
      baseUrl: cfg.get<string>('baseUrl') || base.model.baseUrl,
      apiKey: cfg.get<string>('apiKey') || undefined,
      temperature: cfg.get<number>('temperature') ?? base.model.temperature,
      maxIterations: cfg.get<number>('maxIterations') ?? base.model.maxIterations
    },
    permissions: {
      ...base.permissions,
      allowDeletes: permissionMode === 'permissive',
      allowInstalls: permissionMode === 'permissive',
      allowDestructiveShell: permissionMode === 'permissive',
      shareSecretsWithCloud: false
    },
    context: {
      ...base.context,
      maxInitialFiles: cfg.get<number>('maxInitialFiles') ?? base.context.maxInitialFiles,
      maxContextChars: cfg.get<number>('maxContextChars') ?? base.context.maxContextChars,
      maxTerminalChars: cfg.get<number>('maxTerminalChars') ?? base.context.maxTerminalChars
    }
  }
}
