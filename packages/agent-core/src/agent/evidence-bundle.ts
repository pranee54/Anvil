import type { InvestigationBrief } from './investigate'
import { extractDocInstructions } from './doc-extractor'
import type {
  EvidenceBundle,
  EvidenceFile,
  StructuredGroundedAnswer,
  VerifiedClaim,
  VerifiedCommand,
  VerifiedInstruction
} from './evidence-types'

const DOC_PATH =
  /(readme|install|getting.?started|client-install|changelog|contributing|docs\/)/i

/**
 * Build an EvidenceBundle from investigation results (deterministic).
 */
export function buildEvidenceBundle(brief: InvestigationBrief): EvidenceBundle {
  const setupInstructions: VerifiedInstruction[] = []
  const runCommands: VerifiedCommand[] = []
  const capabilities: VerifiedClaim[] = []
  const projectSummary: VerifiedClaim[] = []
  const architecture: VerifiedClaim[] = []
  const relevantFiles: EvidenceFile[] = []
  const unknowns: string[] = []
  const sourceFiles = new Set<string>()

  for (const c of brief.map.verifiedRunCommands) {
    runCommands.push({
      command: c.command,
      source: { path: c.source }
    })
    sourceFiles.add(c.source)
  }

  for (const ex of brief.excerpts) {
    const isDoc = DOC_PATH.test(ex.path) || ex.path.endsWith('.txt')
    relevantFiles.push({
      path: ex.path,
      role: isDoc ? 'docs' : ex.path.includes('manifest') || ex.path.includes('config') ? 'config' : 'code',
      supportsClaims: false
    })

    if (isDoc || /\.md$/i.test(ex.path) || /CLIENT-INSTALL/i.test(ex.path)) {
      const extracted = extractDocInstructions(ex.path, ex.content)
      for (const instr of extracted.instructions) {
        setupInstructions.push(instr)
        sourceFiles.add(ex.path)
        markSupports(relevantFiles, ex.path)
      }
      for (const cmd of extracted.commands) {
        // Doc-mentioned sync scripts are verified from that doc
        if (/sync-to-firefox|build-client|package-firefox/i.test(cmd.command)) {
          runCommands.push({
            command: cmd.command,
            source: { path: ex.path, startLine: cmd.line }
          })
          sourceFiles.add(ex.path)
          markSupports(relevantFiles, ex.path)
        }
      }
    }
  }

  for (const e of brief.evidence) {
    const claim: VerifiedClaim = {
      statement: e.claim,
      evidence: [{ path: e.path }]
    }
    if (/extension|manifest|proxy|auth|admin|usage|fingerprint|session/i.test(e.claim)) {
      capabilities.push(claim)
    } else {
      architecture.push(claim)
    }
    sourceFiles.add(e.path)
    markSupports(relevantFiles, e.path)
  }

  if (brief.map.stacks.length) {
    projectSummary.push({
      statement: `Repository stacks detected: ${brief.map.stacks.join(', ')}.`,
      evidence: brief.map.entryPoints.slice(0, 3).map((ep) => ({ path: ep.path }))
    })
  }

  const hasAppStartup = runCommands.some(
    (c) =>
      /^(npm (run )?(start|dev|serve)|php |flutter run|docker|composer |yarn (dev|start)|pnpm (dev|start))/i.test(
        c.command
      ) && !/sync-to-firefox|package-firefox|build-client/i.test(c.command)
  )
  if (!hasAppStartup) {
    unknowns.push('No documented backend/app startup command was found in the files inspected.')
  }
  if (!setupInstructions.some((i) => /backend|api|apache|mysql|xampp|php/i.test(i.action))) {
    unknowns.push('No documented backend local startup steps were found.')
  }
  if (!brief.excerpts.some((e) => /docker-compose|Dockerfile/i.test(e.path))) {
    if (brief.map.stacks.includes('php') || brief.map.topFolders.some((t) => t.startsWith('backend'))) {
      unknowns.push('No verified local URL/port for the backend was found in documentation.')
    }
  }

  return {
    intent: brief.intent,
    projectSummary,
    capabilities,
    setupInstructions,
    runCommands,
    architecture,
    relevantFiles,
    unknowns: [...new Set(unknowns)],
    inspectedFiles: [...brief.filesRead],
    sourceFiles: [...sourceFiles]
  }
}

function markSupports(files: EvidenceFile[], path: string): void {
  const f = files.find((x) => x.path === path)
  if (f) f.supportsClaims = true
  else files.push({ path, role: 'other', supportsClaims: true })
}

/**
 * Deterministic Markdown answer from evidence — preferred for HOW_TO_USE / HOW_TO_RUN.
 */
export function renderGroundedMarkdown(bundle: EvidenceBundle): string {
  const lines: string[] = []
  lines.push('From the repository documentation, here is what I could **verify**.')
  lines.push('')

  const bySection = groupInstructions(bundle.setupInstructions)

  if (Object.keys(bySection).length === 0 && bundle.setupInstructions.length === 0) {
    lines.push('I did not find explicit setup documentation with step-by-step install instructions in the files inspected.')
    lines.push('')
  } else {
    for (const [title, steps] of Object.entries(bySection)) {
      lines.push(`### ${title}`)
      lines.push('')
      steps.forEach((s, idx) => {
        lines.push(`${idx + 1}. ${s.action}`)
      })
      const sources = [...new Set(steps.flatMap((s) => s.evidence.map((e) => e.path)))]
      if (sources.length) {
        lines.push('')
        lines.push(`Source: ${sources.map((p) => `\`${p}\``).join(', ')}`)
      }
      lines.push('')
    }
  }

  const startupCommands = bundle.runCommands.filter(
    (c) => !/sync-to-firefox|package-firefox|build-client/i.test(c.command)
  )
  const helperScripts = bundle.runCommands.filter((c) =>
    /sync-to-firefox|package-firefox|build-client/i.test(c.command)
  )

  if (startupCommands.length) {
    lines.push('### Documented startup / run commands')
    lines.push('')
    for (const c of startupCommands) {
      lines.push(`- \`${c.command}\` — from \`${c.source.path}\``)
    }
    lines.push('')
  } else {
    lines.push('### Backend / app startup')
    lines.push('')
    lines.push(
      'No documented backend startup command was found in the files I inspected. I am not inventing startup commands or ports.'
    )
    lines.push('')
  }

  if (helperScripts.length) {
    lines.push('### Other documented scripts')
    lines.push('')
    for (const c of helperScripts) {
      lines.push(`- \`${c.command}\` — from \`${c.source.path}\``)
    }
    lines.push('')
  }

  if (bundle.capabilities.length && bundle.intent !== 'HOW_TO_USE_PROJECT' && bundle.intent !== 'HOW_TO_RUN') {
    lines.push('### Verified capabilities (from code)')
    lines.push('')
    for (const c of bundle.capabilities.slice(0, 8)) {
      const src = c.evidence[0]?.path
      lines.push(`- ${c.statement}${src ? ` (\`${src}\`)` : ''}`)
    }
    lines.push('')
  }

  if (bundle.unknowns.length) {
    lines.push('### What is missing / unverified')
    lines.push('')
    for (const u of bundle.unknowns) {
      lines.push(`- ${u}`)
    }
    lines.push('')
  }

  const sources = bundle.sourceFiles.slice(0, 12)
  if (sources.length) {
    lines.push(`Sources · ${sources.length} files`)
    for (const s of sources) lines.push(`- \`${s}\``)
  }
  if (bundle.inspectedFiles.length > sources.length) {
    lines.push('')
    lines.push(`Inspected · ${bundle.inspectedFiles.length} files`)
  }

  return lines.join('\n').trim()
}

function groupInstructions(items: VerifiedInstruction[]): Record<string, VerifiedInstruction[]> {
  const groups: Record<string, VerifiedInstruction[]> = {}
  for (const item of items) {
    const title =
      item.section ||
      (item.evidence[0]?.path.includes('firefox')
        ? 'Firefox extension'
        : item.evidence[0]?.path.includes('chrome') || item.evidence[0]?.path.includes('CLIENT-INSTALL')
          ? 'Chrome extension'
          : item.evidence[0]?.path.includes('extension')
            ? 'Browser extension'
            : 'Setup')
    if (!groups[title]) groups[title] = []
    groups[title].push(item)
  }
  return groups
}

export function structuredFromBundle(bundle: EvidenceBundle): StructuredGroundedAnswer {
  const md = renderGroundedMarkdown(bundle)
  // Parse into coarse sections for validators
  const sections: StructuredGroundedAnswer['sections'] = []
  const parts = md.split(/^### /m).filter(Boolean)
  for (const part of parts) {
    const [titleLine, ...rest] = part.split('\n')
    if (!titleLine || titleLine.startsWith('From the')) continue
    sections.push({
      title: titleLine.trim(),
      content: rest.join('\n').trim(),
      sources: bundle.sourceFiles.filter((s) => rest.join('\n').includes(s))
    })
  }
  return {
    summary: 'Verified setup/use instructions from repository documentation.',
    sections,
    unknowns: bundle.unknowns
  }
}
