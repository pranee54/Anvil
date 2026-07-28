import type { PermissionLevel, ToolDefinition } from '@shared/types'

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'list_directory',
    description: 'List files and directories at a path relative to the workspace root.',
    permission: 'safe',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative directory path. Use "." for root.' }
      },
      required: ['path']
    }
  },
  {
    name: 'search_files',
    description: 'Find files by glob pattern within the workspace.',
    permission: 'safe',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern, e.g. "**/*.ts"' },
        maxResults: { type: 'number', description: 'Max results (default 50)' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'search_code',
    description: 'Search file contents for a text or regex pattern.',
    permission: 'safe',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text or regex to search for' },
        glob: { type: 'string', description: 'Optional file glob filter' },
        maxResults: { type: 'number', description: 'Max matches (default 30)' },
        caseSensitive: { type: 'boolean' }
      },
      required: ['query']
    }
  },
  {
    name: 'read_file',
    description: 'Read a text file. Optionally read a line range.',
    permission: 'safe',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path' },
        startLine: { type: 'number', description: '1-based start line' },
        endLine: { type: 'number', description: '1-based end line' }
      },
      required: ['path']
    }
  },
  {
    name: 'create_file',
    description: 'Create a new file with content. Fails if the file already exists.',
    permission: 'safe',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'write_file',
    description: 'Write full content to a file (create or overwrite). Prefer edit_file for small changes.',
    permission: 'safe',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'edit_file',
    description:
      'Apply a precise edit by replacing an exact old_string with new_string. Prefer this over rewriting entire files.',
    permission: 'safe',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
        replace_all: { type: 'boolean' }
      },
      required: ['path', 'old_string', 'new_string']
    }
  },
  {
    name: 'delete_file',
    description: 'Delete a file. Only use when necessary.',
    permission: 'ask',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' }
      },
      required: ['path']
    }
  },
  {
    name: 'run_terminal',
    description:
      'Run a shell command in the workspace. Prefer project lint/test/build commands. Destructive commands may be blocked.',
    permission: 'ask',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        cwd: { type: 'string', description: 'Optional relative working directory' },
        timeoutMs: { type: 'number' }
      },
      required: ['command']
    }
  },
  {
    name: 'git_status',
    description: 'Show git status for the workspace.',
    permission: 'safe',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'git_diff',
    description: 'Show git diff. Optionally for a specific path.',
    permission: 'safe',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        staged: { type: 'boolean' }
      }
    }
  },
  {
    name: 'inspect_project',
    description:
      'Summarize the project: type, important files, structure overview, and AGENTS.md instructions if present.',
    permission: 'safe',
    parameters: {
      type: 'object',
      properties: {}
    }
  }
]

export function getToolPermission(name: string): PermissionLevel {
  return TOOL_DEFINITIONS.find((t) => t.name === name)?.permission ?? 'deny'
}

export function toolsForMode(mode: 'ask' | 'edit' | 'agent'): ToolDefinition[] {
  if (mode === 'ask') {
    return TOOL_DEFINITIONS.filter((t) =>
      ['list_directory', 'search_files', 'search_code', 'read_file', 'git_status', 'git_diff', 'inspect_project'].includes(
        t.name
      )
    )
  }
  if (mode === 'edit') {
    return TOOL_DEFINITIONS.filter((t) => t.name !== 'run_terminal' && t.name !== 'delete_file')
  }
  return TOOL_DEFINITIONS
}
