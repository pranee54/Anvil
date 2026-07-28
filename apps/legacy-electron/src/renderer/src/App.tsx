import { useEffect } from 'react'
import { TitleBar } from './components/TitleBar'
import { FileExplorer } from './components/FileExplorer'
import { CodeEditor } from './components/CodeEditor'
import { AgentPanel } from './components/AgentPanel'
import { BottomPanel } from './components/BottomPanel'
import { SettingsModal } from './components/SettingsModal'
import { useAppStore } from './stores/app-store'

export default function App(): JSX.Element {
  const setSettings = useAppStore((s) => s.setSettings)
  const setTerminalResult = useAppStore((s) => s.setTerminalResult)

  useEffect(() => {
    void window.anvil.getSettings().then(setSettings)
    return window.anvil.onTerminalOutput(setTerminalResult)
  }, [setSettings, setTerminalResult])

  return (
    <div className="app-shell">
      <TitleBar />
      <div className="main-row">
        <FileExplorer />
        <CodeEditor />
        <AgentPanel />
      </div>
      <BottomPanel />
      <SettingsModal />
    </div>
  )
}
