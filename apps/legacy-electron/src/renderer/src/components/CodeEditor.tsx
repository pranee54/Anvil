import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { useAppStore } from '../stores/app-store'

loader.config({ monaco })

function languageFor(path: string | null): string {
  if (!path) return 'plaintext'
  if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'typescript'
  if (path.endsWith('.js') || path.endsWith('.jsx')) return 'javascript'
  if (path.endsWith('.json')) return 'json'
  if (path.endsWith('.md')) return 'markdown'
  if (path.endsWith('.py')) return 'python'
  if (path.endsWith('.php')) return 'php'
  if (path.endsWith('.dart')) return 'dart'
  if (path.endsWith('.css')) return 'css'
  if (path.endsWith('.html')) return 'html'
  if (path.endsWith('.yml') || path.endsWith('.yaml')) return 'yaml'
  return 'plaintext'
}

export function CodeEditor(): JSX.Element {
  const openFile = useAppStore((s) => s.openFile)
  const openContent = useAppStore((s) => s.openContent)
  const dirty = useAppStore((s) => s.dirty)
  const setOpenContent = useAppStore((s) => s.setOpenContent)
  const setDirty = useAppStore((s) => s.setDirty)

  async function save(): Promise<void> {
    if (!openFile) return
    await window.anvil.writeFile(openFile, openContent)
    setDirty(false)
  }

  return (
    <section className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <span className="mono" style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--text)' }}>
          {openFile ? `${openFile}${dirty ? ' •' : ''}` : 'Editor'}
        </span>
        <button className="btn" disabled={!openFile || !dirty} onClick={() => void save()}>
          Save
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {!openFile ? (
          <div className="empty-state">
            Select a file from the explorer, or ask the agent to inspect the project.
          </div>
        ) : (
          <Editor
            height="100%"
            theme="vs-dark"
            language={languageFor(openFile)}
            value={openContent}
            onChange={(value) => setOpenContent(value ?? '')}
            options={{
              fontFamily: "IBM Plex Mono, ui-monospace, monospace",
              fontSize: 13,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2
            }}
          />
        )}
      </div>
    </section>
  )
}
