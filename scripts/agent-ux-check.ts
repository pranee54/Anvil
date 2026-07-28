import { AgentOrchestrator, DEFAULT_SETTINGS, looksLikeToolProtocol, sanitizeAssistantText, type AgentRunEvent } from '../packages/agent-core/src/index'

async function main(): Promise<void> {
  const workspace = process.env.ANVIL_WORKSPACE || process.cwd()
  let final = ''
  let streamed = ''
  const cards: string[] = []
  const orch = new AgentOrchestrator(
    () => ({
      ...DEFAULT_SETTINGS,
      model: { ...DEFAULT_SETTINGS.model, model: process.env.ANVIL_MODEL || 'qwen2.5-coder:3b', maxIterations: 12 }
    }),
    (e: AgentRunEvent) => {
      if (e.type === 'tool_card') {
        const c = e.data as { title: string; detail?: string; path?: string }
        const line = [c.title, c.path || c.detail].filter(Boolean).join(' ')
        cards.push(line)
        console.log('[card]', line)
      }
      if (e.type === 'stream_delta') {
        streamed += (e.data as { text: string }).text
      }
      if (e.type === 'stream_clear') console.log('[stream_clear]')
      if (e.type === 'message') final = sanitizeAssistantText((e.data as { content: string }).content)
      if (e.type === 'error') console.error('ERR', e.data)
      if (e.type === 'permission_request') orch.resolvePermission((e.data as { id: string }).id, true)
    }
  )

  console.log('workspace', workspace)
  await orch.run({
    message: process.env.ANVIL_PROMPT || 'ye project ela work avutadhi chudhu',
    mode: 'ask',
    workspacePath: workspace
  })

  console.log('\n=== FINAL ===\n', final.slice(0, 2000))
  const protocolInFinal = /"name"\s*:\s*"inspect_project"/.test(final)
  const protocolInStream = looksLikeToolProtocol(streamed) && /"name"\s*:/.test(streamed)
  console.log('\nchecks:', {
    protocolInFinal,
    protocolLeakedUnfiltered: protocolInStream && !streamed.includes('[cleared]'),
    hasUnknownInFinal: /\bunknown\b/i.test(final),
    hasUnknownInCards: cards.some((c) => /\bunknown\b/i.test(c)),
    agentsMdAsLead: /^[\s\S]{0,120}no AGENTS\.md/i.test(final),
    cardTitles: cards.slice(0, 10)
  })

  let follow = ''
  const orch2 = new AgentOrchestrator(
    () => ({
      ...DEFAULT_SETTINGS,
      model: { ...DEFAULT_SETTINGS.model, model: process.env.ANVIL_MODEL || 'qwen2.5-coder:3b', maxIterations: 10 }
    }),
    (e: AgentRunEvent) => {
      if (e.type === 'tool_card') {
        const c = e.data as { title: string; path?: string; detail?: string }
        console.log('[card2]', c.title, c.path || c.detail || '')
      }
      if (e.type === 'message') follow = sanitizeAssistantText((e.data as { content: string }).content)
      if (e.type === 'permission_request') orch2.resolvePermission((e.data as { id: string }).id, true)
    }
  )
  await orch2.run({
    message: 'backend ekkada start avutundi?',
    mode: 'ask',
    workspacePath: workspace,
    history: [
      { role: 'user', content: 'ye project ela work avutadhi chudhu' },
      { role: 'assistant', content: final.slice(0, 2500) }
    ]
  })
  console.log('\n=== FOLLOW-UP ===\n', follow.slice(0, 1500))
  console.log('follow mentions backend:', /backend/i.test(follow))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
