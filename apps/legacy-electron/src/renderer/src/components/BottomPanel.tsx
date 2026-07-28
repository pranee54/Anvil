import { createTwoFilesPatch } from 'diff'
import { useAppStore } from '../stores/app-store'

export function BottomPanel(): JSX.Element {
  const bottomTab = useAppStore((s) => s.bottomTab)
  const setBottomTab = useAppStore((s) => s.setBottomTab)
  const terminalLines = useAppStore((s) => s.terminalLines)
  const changes = useAppStore((s) => s.changes)
  const selectedChange = useAppStore((s) => s.selectedChange)
  const setSelectedChange = useAppStore((s) => s.setSelectedChange)
  const upsertChange = useAppStore((s) => s.upsertChange)
  const workspacePath = useAppStore((s) => s.workspacePath)
  const appendTerminal = useAppStore((s) => s.appendTerminal)
  const setTerminalResult = useAppStore((s) => s.setTerminalResult)

  async function runCommand(command: string): Promise<void> {
    if (!workspacePath) return
    appendTerminal(`$ ${command}`)
    const result = await window.anvil.runTerminal(command, workspacePath)
    setTerminalResult(result)
  }

  const active = changes.find((c) => c.path === selectedChange) ?? changes[0]
  const patch =
    active && active.kind !== 'deleted'
      ? createTwoFilesPatch(
          active.path,
          active.path,
          active.before ?? '',
          active.after ?? '',
          '',
          ''
        )
      : active?.kind === 'deleted'
        ? `--- ${active.path}\n+++ /dev/null\n${(active.before ?? '')
            .split('\n')
            .map((l) => `- ${l}`)
            .join('\n')}`
        : ''

  return (
    <footer className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header" style={{ gap: 12 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['terminal', 'diff', 'output', 'problems'] as const).map((tab) => (
            <button
              key={tab}
              className={`btn ghost ${bottomTab === tab ? 'primary' : ''}`}
              style={{ textTransform: 'uppercase', fontSize: 11 }}
              onClick={() => setBottomTab(tab)}
            >
              {tab}
              {tab === 'diff' && changes.length ? ` (${changes.length})` : ''}
            </button>
          ))}
        </div>
        {bottomTab === 'terminal' && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn" onClick={() => void runCommand('git status --short --branch')}>
              git status
            </button>
            <button className="btn" onClick={() => void runCommand('git diff')}>
              git diff
            </button>
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 10 }}>
        {bottomTab === 'terminal' && (
          <pre className="mono" style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>
            {terminalLines.join('\n')}
          </pre>
        )}

        {bottomTab === 'diff' && (
          <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 10, height: '100%' }}>
            <div style={{ borderRight: '1px solid var(--border)', paddingRight: 8, overflow: 'auto' }}>
              {changes.length === 0 ? (
                <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>No pending changes</div>
              ) : (
                changes.map((c) => (
                  <button
                    key={c.path}
                    className="btn ghost"
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      marginBottom: 4,
                      background: active?.path === c.path ? 'var(--bg-3)' : 'transparent'
                    }}
                    onClick={() => setSelectedChange(c.path)}
                  >
                    <span className={`badge ${c.kind === 'deleted' ? 'err' : c.kind === 'added' ? 'ok' : 'warn'}`}>
                      {c.kind}
                    </span>{' '}
                    <span className="mono" style={{ fontSize: 11 }}>
                      {c.path}
                    </span>
                  </button>
                ))
              )}
            </div>
            <div style={{ overflow: 'auto' }}>
              {active ? (
                <>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <button
                      className="btn primary"
                      onClick={async () => {
                        await window.anvil.applyChange(active.path)
                        upsertChange({ ...active, accepted: true, rejected: false })
                      }}
                    >
                      Accept
                    </button>
                    <button
                      className="btn danger"
                      onClick={async () => {
                        await window.anvil.rejectChange(active.path)
                        upsertChange({ ...active, accepted: false, rejected: true })
                      }}
                    >
                      Reject / Revert
                    </button>
                  </div>
                  <pre className="mono" style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>
                    {patch}
                  </pre>
                </>
              ) : (
                <div style={{ color: 'var(--text-dim)' }}>Select a change</div>
              )}
            </div>
          </div>
        )}

        {bottomTab === 'output' && (
          <pre className="mono" style={{ margin: 0, fontSize: 12, color: 'var(--text-dim)' }}>
            Agent tool output also streams into Activity and Terminal when commands run.
          </pre>
        )}

        {bottomTab === 'problems' && (
          <pre className="mono" style={{ margin: 0, fontSize: 12, color: 'var(--text-dim)' }}>
            Problems from analyzer/test runs will appear here as the agent executes lint/test commands.
          </pre>
        )}
      </div>
    </footer>
  )
}
