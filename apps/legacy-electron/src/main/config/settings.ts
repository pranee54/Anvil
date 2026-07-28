import { app, safeStorage } from 'electron'
import Store from 'electron-store'
import { DEFAULT_SETTINGS, type AppSettings, type ModelSettings } from '@shared/types'

interface PersistedSettings {
  settings: AppSettings
  encryptedApiKeys?: Record<string, string>
}

let store: Store<PersistedSettings> | null = null

function getStore(): Store<PersistedSettings> {
  if (!store) {
    store = new Store<PersistedSettings>({
      name: 'anvil-settings',
      defaults: {
        settings: DEFAULT_SETTINGS
      }
    })
  }
  return store
}

export function getSettings(): AppSettings {
  const settings = getStore().get('settings', DEFAULT_SETTINGS)
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    model: { ...DEFAULT_SETTINGS.model, ...settings.model },
    permissions: { ...DEFAULT_SETTINGS.permissions, ...settings.permissions },
    context: { ...DEFAULT_SETTINGS.context, ...settings.context }
  }
}

export function setSettings(partial: Partial<AppSettings>): AppSettings {
  const current = getSettings()
  const next: AppSettings = {
    ...current,
    ...partial,
    model: { ...current.model, ...(partial.model ?? {}) },
    permissions: { ...current.permissions, ...(partial.permissions ?? {}) },
    context: { ...current.context, ...(partial.context ?? {}) }
  }

  if (partial.model?.apiKey !== undefined) {
    saveApiKey(next.model.provider, partial.model.apiKey)
    next.model = { ...next.model, apiKey: undefined }
  }

  getStore().set('settings', next)
  return getSettingsWithSecrets()
}

export function getSettingsWithSecrets(): AppSettings {
  const settings = getSettings()
  const apiKey = loadApiKey(settings.model.provider)
  return {
    ...settings,
    model: {
      ...settings.model,
      apiKey: apiKey || undefined
    }
  }
}

export function saveApiKey(provider: ModelSettings['provider'], apiKey: string): void {
  const keys = getStore().get('encryptedApiKeys', {})
  if (!apiKey) {
    delete keys[provider]
    getStore().set('encryptedApiKeys', keys)
    return
  }
  if (app.isReady() && safeStorage.isEncryptionAvailable()) {
    keys[provider] = safeStorage.encryptString(apiKey).toString('base64')
  } else {
    keys[provider] = Buffer.from(apiKey, 'utf8').toString('base64')
  }
  getStore().set('encryptedApiKeys', keys)
}

export function loadApiKey(provider: ModelSettings['provider']): string {
  const keys = getStore().get('encryptedApiKeys', {})
  const encoded = keys[provider]
  if (!encoded) return ''
  try {
    const buf = Buffer.from(encoded, 'base64')
    if (app.isReady() && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(buf)
    }
    return buf.toString('utf8')
  } catch {
    try {
      return Buffer.from(encoded, 'base64').toString('utf8')
    } catch {
      return ''
    }
  }
}

export function getUserDataPath(): string {
  return app.getPath('userData')
}
