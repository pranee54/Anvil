/** @deprecated Canonical: packages/agent-core — do not extend. */
import { spawn } from 'child_process'
import type { TerminalCommandResult } from '@shared/types'

export async function runTerminalCommand(options: {
  command: string
  cwd: string
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
}): Promise<TerminalCommandResult> {
  const timeoutMs = options.timeoutMs ?? 120_000
  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/zsh'
  const args = process.platform === 'win32' ? ['/c', options.command] : ['-lc', options.command]

  return new Promise((resolve) => {
    const child = spawn(shell, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    const max = 300_000

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 2000)
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
      if (stdout.length > max) stdout = stdout.slice(-max)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
      if (stderr.length > max) stderr = stderr.slice(-max)
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        command: options.command,
        cwd: options.cwd,
        exitCode: code,
        stdout,
        stderr,
        timedOut
      })
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({
        command: options.command,
        cwd: options.cwd,
        exitCode: 1,
        stdout,
        stderr: `${stderr}\n${err.message}`.trim(),
        timedOut
      })
    })
  })
}
