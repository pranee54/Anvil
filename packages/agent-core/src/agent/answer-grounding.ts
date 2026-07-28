import type { EvidenceBundle } from './evidence-types'
import { renderGroundedMarkdown } from './evidence-bundle'

export type GroundingIssue = {
  kind:
    | 'unsupported_command'
    | 'unsupported_port'
    | 'unsupported_url'
    | 'unsupported_install'
    | 'contradiction'
    | 'unsupported_deploy'
  claim: string
  detail: string
}

const HALLUCINATED_COMMANDS =
  /\b(php\s+index\.php|php\s+-S|npm\s+start|yarn\s+start|flutter\s+run|docker(?:-compose|\s+compose)\s+up|mysql\s+-u)\b/i

const HALLUCINATED_INSTALL =
  /\b(download\s+xampp|install\s+xampp|start\s+apache|start\s+mysql|xampp\s+control)\b/i

const HALLUCINATED_DEPLOY =
  /\b(chrome\s+web\s+store|firefox\s+add-?ons|addons\.mozilla|malicious[- ]content)\b/i

const CONTRADICTION_NO_STARTUP =
  /(?:haven'?t|have not|could(?:\s+not|n't)|no)\s+(?:found\s+)?(?:a\s+)?documented\s+(?:startup|run|start)\s+command/i

export function collectGroundingIssues(answer: string, bundle: EvidenceBundle): GroundingIssue[] {
  const issues: GroundingIssue[] = []
  const verifiedCommands = new Set(bundle.runCommands.map((c) => c.command.toLowerCase()))
  const docText = [
    ...bundle.setupInstructions.map((i) => i.action),
    ...bundle.runCommands.map((c) => c.command),
    ...bundle.capabilities.map((c) => c.statement)
  ]
    .join('\n')
    .toLowerCase()

  const cmdMatches = answer.match(
    /\b(?:php\s+index\.php|php\s+-S|npm\s+start|yarn\s+start|flutter\s+run|docker(?:-compose|\s+compose)\s+up|mysql\s+-u)\b/gi
  )
  if (cmdMatches) {
    for (const m of cmdMatches) {
      const ok = [...verifiedCommands].some((c) => c.includes(m.toLowerCase()) || m.toLowerCase().includes(c))
      if (!ok) {
        issues.push({
          kind: 'unsupported_command',
          claim: m,
          detail: 'Command not present in verified documentation/scripts'
        })
      }
    }
  }

  const portRe = /\b(?:localhost|127\.0\.0\.1):(\d+)\b|\bport\s+(\d+)\b/gi
  let portMatch: RegExpExecArray | null
  while ((portMatch = portRe.exec(answer))) {
    const port = portMatch[1] || portMatch[2]
    if (!docText.includes(`:${port}`) && !docText.includes(`port ${port}`)) {
      issues.push({
        kind: 'unsupported_port',
        claim: portMatch[0],
        detail: 'Port/URL not verified in repository documentation'
      })
    }
  }

  if (HALLUCINATED_INSTALL.test(answer) && !/xampp|apache|mysql/i.test(docText)) {
    issues.push({
      kind: 'unsupported_install',
      claim: answer.match(HALLUCINATED_INSTALL)?.[0] || 'XAMPP/Apache/MySQL install',
      detail: 'Installation steps not documented in inspected files'
    })
  }

  if (HALLUCINATED_DEPLOY.test(answer)) {
    issues.push({
      kind: 'unsupported_deploy',
      claim: answer.match(HALLUCINATED_DEPLOY)?.[0] || 'store deployment',
      detail: 'Store/deployment claim not supported as project setup documentation'
    })
  }

  const saysNoStartup = CONTRADICTION_NO_STARTUP.test(answer) || bundle.runCommands.length === 0
  if (saysNoStartup) {
    if (
      /\b(this will start|start(?:s|ing)?\s+(?:a\s+)?(?:local\s+)?(?:web\s+)?server|make your backend|accessible at\s+http)/i.test(
        answer
      )
    ) {
      issues.push({
        kind: 'contradiction',
        claim: 'invented server start after missing startup docs',
        detail: 'Answer invents how to start a server despite missing documented startup command'
      })
    }
    if (HALLUCINATED_COMMANDS.test(answer) || /localhost:\d+/i.test(answer)) {
      issues.push({
        kind: 'contradiction',
        claim: 'no command vs invented command/port',
        detail: 'Contradiction between missing startup evidence and invented run instructions'
      })
    }
  }

  return issues
}

export function validateGroundedAnswer(
  answer: string,
  bundle: EvidenceBundle
): { ok: boolean; issues: GroundingIssue[]; cleaned?: string } {
  const issues = collectGroundingIssues(answer, bundle)
  if (!issues.length) return { ok: true, issues: [] }

  // Contradictions are never "cleaned" into success — reject outright
  if (issues.some((i) => i.kind === 'contradiction')) {
    return { ok: false, issues, cleaned: undefined }
  }

  let cleaned = answer
  for (const issue of issues) {
    cleaned = stripSentencesContaining(cleaned, issue.claim)
  }
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim()

  const remaining = collectGroundingIssues(cleaned, bundle)
  if (!remaining.length && cleaned.length > 40) {
    return { ok: true, issues, cleaned }
  }
  return { ok: false, issues, cleaned: undefined }
}

function stripSentencesContaining(text: string, needle: string): string {
  if (!needle) return text
  const parts = text.split(/(?<=[.!?])\s+|\n+/)
  return parts
    .filter((s) => !s.toLowerCase().includes(needle.toLowerCase()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function finalizeGroundedAnswer(options: {
  bundle: EvidenceBundle
  modelAnswer?: string
  preferDeterministic?: boolean
}): { answer: string; usedDeterministic: boolean; issues: GroundingIssue[]; sourceFiles: string[] } {
  const { bundle, modelAnswer, preferDeterministic } = options
  const forceDeterministic =
    preferDeterministic ||
    bundle.intent === 'HOW_TO_USE_PROJECT' ||
    bundle.intent === 'HOW_TO_RUN'

  if (forceDeterministic) {
    return {
      answer: renderGroundedMarkdown(bundle),
      usedDeterministic: true,
      issues: [],
      sourceFiles: bundle.sourceFiles
    }
  }

  if (modelAnswer?.trim()) {
    const result = validateGroundedAnswer(modelAnswer, bundle)
    if (result.ok && !result.cleaned) {
      return {
        answer: modelAnswer.trim(),
        usedDeterministic: false,
        issues: [],
        sourceFiles: bundle.sourceFiles
      }
    }
    if (result.ok && result.cleaned) {
      return {
        answer: result.cleaned,
        usedDeterministic: false,
        issues: result.issues,
        sourceFiles: bundle.sourceFiles
      }
    }
    return {
      answer: renderGroundedMarkdown(bundle),
      usedDeterministic: true,
      issues: result.issues,
      sourceFiles: bundle.sourceFiles
    }
  }

  return {
    answer: renderGroundedMarkdown(bundle),
    usedDeterministic: true,
    issues: [],
    sourceFiles: bundle.sourceFiles
  }
}

export const GroundingPatterns = {
  HALLUCINATED_COMMANDS,
  HALLUCINATED_INSTALL,
  HALLUCINATED_DEPLOY
}
