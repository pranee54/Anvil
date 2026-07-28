/**
 * Headless integration against @anvil/agent-core (canonical).
 * ANVIL_WORKSPACE, ANVIL_MODEL, ANVIL_PROMPT, OLLAMA_HOST env vars supported.
 */
import path from 'path'
import { AgentOrchestrator, DEFAULT_SETTINGS, type AgentRunEvent, type AppSettings } from '../packages/agent-core/src/index'

async function main(): Promise<void> {
  const workspace = path.resolve(process.env.ANVIL_WORKSPACE || path.join(__dirname, '../demo-project'))
  const settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    model: {
      ...DEFAULT_SETTINGS.model,
      provider: 'ollama',
      model: process.env.ANVIL_MODEL || 'qwen2.5-coder:3b',
      baseUrl: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
      maxIterations: 16
    }
  }

  let finalMessage = ''
  let error: string | undefined

  const orchestrator = new AgentOrchestrator(
    () => settings,
    (event: AgentRunEvent) => {
      if (event.type === 'tool_card') {
        const c = event.data as { title: string; detail?: string; path?: string }
        console.log(`[card] ${[c.title, c.path || c.detail].filter(Boolean).join(' ')}`)
      }
      if (event.type === 'stream_delta') {
        process.stdout.write((event.data as { text: string }).text)
      }
      if (event.type === 'activity') {
        console.log(`[activity] ${(event.data as { message: string }).message}`)
      }
      if (event.type === 'permission_request') {
        const perm = event.data as { id: string }
        orchestrator.resolvePermission(perm.id, true)
      }
      if (event.type === 'message') {
        finalMessage = (event.data as { content: string }).content
      }
      if (event.type === 'error') {
        error = String((event.data as { message?: string }).message ?? event.data)
      }
      if (event.type === 'done') console.log('\n[done]')
    }
  )

  console.log(`workspace: ${workspace}`)
  await orchestrator.run({
    message:
      process.env.ANVIL_PROMPT ||
      'Inspect this project briefly and explain what src/index.js does. Use tools.',
    mode: 'ask',
    workspacePath: workspace
  })

  console.log('\n=== FINAL ===\n', finalMessage || '(none)')
  if (error) {
    console.error('ERROR:', error)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
