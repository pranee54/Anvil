import { useEffect, useState, type ReactNode } from 'react'
import type {
  AppSettings,
  ConnectionStatus,
  ModelProviderId,
  OllamaModel
} from '@shared/types'
import { useAppStore } from '../stores/app-store'

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  disconnected: 'Disconnected',
  ollama_not_running: 'Ollama not running',
  model_not_found: 'Model not found',
  connection_failed: 'Connection failed'
}

export function SettingsModal(): JSX.Element | null {
  const open = useAppStore((s) => s.settingsOpen)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)
  const [draft, setDraft] = useState<AppSettings>(settings)
  const [models, setModels] = useState<OllamaModel[]>([])
  const [status, setStatus] = useState<{ kind: ConnectionStatus | 'info'; text: string } | null>(
    null
  )
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (!open) return
    void window.anvil.getSettings().then((s) => {
      setSettings(s)
      setDraft(s)
      setApiKeyDraft('')
    })
  }, [open, setSettings])

  useEffect(() => {
    if (!open || draft.model.provider !== 'ollama') return
    void refreshModels(draft.model.baseUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft.model.provider, draft.model.baseUrl])

  async function refreshModels(baseUrl: string): Promise<void> {
    setRefreshing(true)
    try {
      const list = await window.anvil.listOllamaModels(baseUrl)
      setModels(list)
      if (!list.length) {
        setStatus({
          kind: 'connected',
          text: 'Connected to Ollama, but no models installed. Run: ollama pull <model>'
        })
      } else {
        setStatus({
          kind: 'connected',
          text: `Found ${list.length} local model(s)`
        })
      }
    } catch (err) {
      setModels([])
      const message = err instanceof Error ? err.message : String(err)
      const kind: ConnectionStatus = /ECONNREFUSED|not running|connection refused/i.test(message)
        ? 'ollama_not_running'
        : 'connection_failed'
      setStatus({ kind, text: message })
    } finally {
      setRefreshing(false)
    }
  }

  if (!open) return null

  async function save(): Promise<void> {
    const partial: Partial<AppSettings> = {
      ...draft,
      model: {
        ...draft.model,
        ...(apiKeyDraft ? { apiKey: apiKeyDraft } : {})
      }
    }
    const saved = await window.anvil.setSettings(partial)
    setSettings(saved)
    setStatus({ kind: 'info', text: 'Saved' })
    setSettingsOpen(false)
  }

  async function test(): Promise<void> {
    await window.anvil.setSettings({
      model: {
        ...draft.model,
        ...(apiKeyDraft ? { apiKey: apiKeyDraft } : {})
      }
    })
    const result = await window.anvil.testProvider()
    setStatus({
      kind: result.status,
      text: `${STATUS_LABEL[result.status] ?? result.status}: ${result.message}`
    })
    if (result.models?.length) {
      setModels(result.models.map((name) => ({ name, size: 0 })))
    }
  }

  const statusColor =
    status?.kind === 'connected' || status?.kind === 'info'
      ? 'var(--ok)'
      : status
        ? 'var(--danger)'
        : 'var(--text-dim)'

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 50
      }}
      onClick={() => setSettingsOpen(false)}
    >
      <div
        className="panel"
        style={{
          width: 640,
          maxHeight: '85vh',
          overflow: 'auto',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 16
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Settings</h2>
          <button className="btn ghost" onClick={() => setSettingsOpen(false)}>
            Close
          </button>
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          <Field label="Provider">
            <select
              className="select"
              value={draft.model.provider}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  model: {
                    ...draft.model,
                    provider: e.target.value as ModelProviderId,
                    baseUrl:
                      e.target.value === 'ollama'
                        ? 'http://127.0.0.1:11434'
                        : draft.model.baseUrl
                  }
                })
              }
            >
              <option value="ollama">Ollama (local)</option>
              <option value="openai-compatible">OpenAI-compatible (no streaming)</option>
              <option value="anthropic">Anthropic (not enabled)</option>
              <option value="gemini">Gemini (not enabled)</option>
            </select>
          </Field>

          <Field label="Base URL">
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input mono"
                value={draft.model.baseUrl}
                onChange={(e) =>
                  setDraft({ ...draft, model: { ...draft.model, baseUrl: e.target.value } })
                }
              />
              {draft.model.provider === 'ollama' && (
                <button className="btn" disabled={refreshing} onClick={() => void refreshModels(draft.model.baseUrl)}>
                  {refreshing ? '…' : 'Refresh'}
                </button>
              )}
            </div>
          </Field>

          <Field label="Model">
            {draft.model.provider === 'ollama' && models.length > 0 ? (
              <select
                className="select"
                value={draft.model.model}
                onChange={(e) =>
                  setDraft({ ...draft, model: { ...draft.model, model: e.target.value } })
                }
              >
                {!models.some((m) => m.name === draft.model.model) && (
                  <option value={draft.model.model}>{draft.model.model} (not installed)</option>
                )}
                {models.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="input mono"
                value={draft.model.model}
                onChange={(e) =>
                  setDraft({ ...draft, model: { ...draft.model, model: e.target.value } })
                }
              />
            )}
          </Field>

          {draft.model.provider !== 'ollama' && (
            <Field label="API Key">
              <input
                className="input mono"
                type="password"
                placeholder={draft.model.apiKey ? '•••••••• (unchanged)' : 'Enter API key'}
                value={apiKeyDraft}
                onChange={(e) => setApiKeyDraft(e.target.value)}
              />
            </Field>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Temperature">
              <input
                className="input"
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={draft.model.temperature}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    model: { ...draft.model, temperature: Number(e.target.value) }
                  })
                }
              />
            </Field>
            <Field label="Max agent iterations">
              <input
                className="input"
                type="number"
                min={1}
                max={100}
                value={draft.model.maxIterations}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    model: { ...draft.model, maxIterations: Number(e.target.value) }
                  })
                }
              />
            </Field>
            <Field label="Initial context files">
              <input
                className="input"
                type="number"
                min={1}
                max={20}
                value={draft.context.maxInitialFiles}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    context: { ...draft.context, maxInitialFiles: Number(e.target.value) }
                  })
                }
              />
            </Field>
            <Field label="Max context chars">
              <input
                className="input"
                type="number"
                min={4000}
                max={200000}
                step={1000}
                value={draft.context.maxContextChars}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    context: { ...draft.context, maxContextChars: Number(e.target.value) }
                  })
                }
              />
            </Field>
          </div>

          <fieldset style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
            <legend>Permissions</legend>
            <label style={{ display: 'block', marginBottom: 6 }}>
              <input
                type="checkbox"
                checked={draft.permissions.allowDeletes}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    permissions: { ...draft.permissions, allowDeletes: e.target.checked }
                  })
                }
              />{' '}
              Allow deletes (still asks)
            </label>
            <label style={{ display: 'block', marginBottom: 6 }}>
              <input
                type="checkbox"
                checked={draft.permissions.allowInstalls}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    permissions: { ...draft.permissions, allowInstalls: e.target.checked }
                  })
                }
              />{' '}
              Allow dependency installs (still asks)
            </label>
            <label style={{ display: 'block', marginBottom: 6 }}>
              <input
                type="checkbox"
                checked={draft.permissions.allowDestructiveShell}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    permissions: { ...draft.permissions, allowDestructiveShell: e.target.checked }
                  })
                }
              />{' '}
              Allow destructive shell (still asks / may deny)
            </label>
            <label style={{ display: 'block' }}>
              <input
                type="checkbox"
                checked={draft.permissions.shareSecretsWithCloud}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    permissions: { ...draft.permissions, shareSecretsWithCloud: e.target.checked }
                  })
                }
              />{' '}
              Allow sharing secrets with cloud models
            </label>
          </fieldset>

          {status && (
            <div className="mono" style={{ fontSize: 12, color: statusColor }}>
              {status.kind !== 'info' ? `${STATUS_LABEL[status.kind as ConnectionStatus] ?? ''} — ` : ''}
              {status.text}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => void test()}>
              Test connection
            </button>
            <button className="btn primary" onClick={() => void save()}>
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field(props: { label: string; children: ReactNode }): JSX.Element {
  return (
    <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
      <span style={{ color: 'var(--text-dim)' }}>{props.label}</span>
      {props.children}
    </label>
  )
}
