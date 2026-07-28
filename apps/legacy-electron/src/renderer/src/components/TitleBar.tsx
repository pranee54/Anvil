import { FolderOpen, Settings, Hammer } from 'lucide-react'
import { useAppStore } from '../stores/app-store'

export function TitleBar(): JSX.Element {
  const workspacePath = useAppStore((s) => s.workspacePath)
  const setWorkspace = useAppStore((s) => s.setWorkspace)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const mode = useAppStore((s) => s.mode)
  const setMode = useAppStore((s) => s.setMode)

  async function openFolder(): Promise<void> {
    const result = await window.anvil.openFolder()
    if (!result) return
    setWorkspace(result.path, result.tree)
  }

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '0 12px',
        background: 'linear-gradient(90deg, #0d1520, #132033 40%, #0d1520)',
        borderBottom: '1px solid var(--border)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 140 }}>
        <Hammer size={18} color="var(--accent)" />
        <strong style={{ letterSpacing: '0.08em', fontSize: 14 }}>ANVIL</strong>
      </div>

      <button className="btn" onClick={() => void openFolder()}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <FolderOpen size={14} /> Open Project
        </span>
      </button>

      <div
        className="mono"
        style={{
          flex: 1,
          fontSize: 12,
          color: 'var(--text-dim)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
        title={workspacePath ?? undefined}
      >
        {workspacePath ?? 'No project open'}
      </div>

      <div style={{ display: 'flex', gap: 4 }}>
        {(['ask', 'edit', 'agent'] as const).map((m) => (
          <button
            key={m}
            className={`btn ${mode === m ? 'primary' : 'ghost'}`}
            onClick={() => setMode(m)}
            style={{ textTransform: 'uppercase', fontSize: 11 }}
          >
            {m}
          </button>
        ))}
      </div>

      <button className="btn ghost" onClick={() => setSettingsOpen(true)} title="Settings">
        <Settings size={16} />
      </button>
    </header>
  )
}
