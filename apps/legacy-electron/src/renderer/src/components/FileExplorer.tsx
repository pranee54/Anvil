import { useState } from 'react'
import { ChevronDown, ChevronRight, FileCode2, Folder } from 'lucide-react'
import type { FileNode } from '@shared/types'
import { useAppStore } from '../stores/app-store'

export function FileExplorer(): JSX.Element {
  const tree = useAppStore((s) => s.tree)
  const workspacePath = useAppStore((s) => s.workspacePath)
  const openFile = useAppStore((s) => s.openFile)
  const setOpenFile = useAppStore((s) => s.setOpenFile)

  async function open(path: string): Promise<void> {
    const content = await window.anvil.readFile(path)
    setOpenFile(path, content)
  }

  return (
    <aside className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <span>Explorer</span>
      </div>
      <div style={{ overflow: 'auto', padding: 8, flex: 1 }}>
        {!workspacePath ? (
          <div className="empty-state">Open a project folder to browse files.</div>
        ) : (
          tree.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              active={openFile}
              onOpen={(p) => void open(p)}
            />
          ))
        )}
      </div>
    </aside>
  )
}

function TreeNode(props: {
  node: FileNode
  depth: number
  active: string | null
  onOpen: (path: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(props.depth < 2)
  const isDir = props.node.type === 'directory'

  return (
    <div>
      <button
        className="btn ghost"
        style={{
          width: '100%',
          justifyContent: 'flex-start',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 6px',
          paddingLeft: 6 + props.depth * 12,
          border: 'none',
          background: props.active === props.node.path ? 'var(--bg-3)' : 'transparent',
          borderRadius: 4,
          fontSize: 13
        }}
        onClick={() => {
          if (isDir) setOpen((v) => !v)
          else props.onOpen(props.node.path)
        }}
      >
        {isDir ? (
          open ? <ChevronDown size={14} /> : <ChevronRight size={14} />
        ) : (
          <span style={{ width: 14 }} />
        )}
        {isDir ? <Folder size={14} color="#8eb4ff" /> : <FileCode2 size={14} color="#9ad7c8" />}
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {props.node.name}
        </span>
      </button>
      {isDir && open &&
        props.node.children?.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            depth={props.depth + 1}
            active={props.active}
            onOpen={props.onOpen}
          />
        ))}
    </div>
  )
}
