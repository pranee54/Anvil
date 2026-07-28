import { describe, expect, it } from 'vitest'
import {
  collectGroundingIssues,
  finalizeGroundedAnswer,
  validateGroundedAnswer
} from '../packages/agent-core/src/agent/answer-grounding'
import { buildEvidenceBundle, renderGroundedMarkdown } from '../packages/agent-core/src/agent/evidence-bundle'
import { extractDocInstructions } from '../packages/agent-core/src/agent/doc-extractor'
import { classifyQuery } from '../packages/agent-core/src/context/query-intent'
import { PathGuard } from '../packages/agent-core/src/repository/path-guard'
import { IgnoreEngine } from '../packages/agent-core/src/repository/ignore-engine'
import { investigateRepository } from '../packages/agent-core/src/agent/investigate'
import { invalidateRepositoryMap } from '../packages/agent-core/src/repository/repo-map'
import { DEFAULT_SETTINGS } from '../packages/agent-core/src/types'
import type { EvidenceBundle } from '../packages/agent-core/src/agent/evidence-types'

function emptyBundle(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    intent: 'HOW_TO_USE_PROJECT',
    projectSummary: [],
    capabilities: [],
    setupInstructions: [],
    runCommands: [],
    architecture: [],
    relevantFiles: [],
    unknowns: ['No documented backend/app startup command was found in the files inspected.'],
    inspectedFiles: ['extension/chrome/README.md'],
    sourceFiles: ['extension/chrome/README.md'],
    ...overrides
  }
}

describe('HOW_TO_USE intent', () => {
  it('classifies how to use this project', () => {
    expect(classifyQuery('how to use this project').intent).toBe('HOW_TO_USE_PROJECT')
    expect(classifyQuery('project ela use cheyyali?').intent).toBe('HOW_TO_USE_PROJECT')
  })
})

describe('hallucination traps', () => {
  it('Case A: rejects php index.php when no startup command', () => {
    const bundle = emptyBundle()
    const candidate =
      'I haven\'t found a documented startup command yet. Run php index.php to start the server.'
    const result = validateGroundedAnswer(candidate, bundle)
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.kind === 'unsupported_command' || i.kind === 'contradiction')).toBe(
      true
    )
  })

  it('Case B: rejects localhost:80 when no port evidence', () => {
    const bundle = emptyBundle()
    const candidate = 'Open http://localhost:80 in your browser.'
    const issues = collectGroundingIssues(candidate, bundle)
    expect(issues.some((i) => i.kind === 'unsupported_port')).toBe(true)
  })

  it('Case C: rejects Chrome Web Store deployment as setup fact', () => {
    const bundle = emptyBundle({
      setupInstructions: [
        {
          action: 'Load unpacked from extension/chrome',
          evidence: [{ path: 'extension/chrome/README.md' }]
        }
      ]
    })
    const candidate = 'Publish it to the Chrome Web Store after testing.'
    const issues = collectGroundingIssues(candidate, bundle)
    expect(issues.some((i) => i.kind === 'unsupported_deploy')).toBe(true)
  })

  it('Case D: accepts verified load unpacked instruction', () => {
    const bundle = emptyBundle({
      setupInstructions: [
        {
          action: 'Load unpacked from extension/chrome',
          evidence: [{ path: 'extension/chrome/README.md' }]
        }
      ],
      unknowns: []
    })
    const candidate =
      'Load extension/chrome as an unpacked extension.\n\nSource: `extension/chrome/README.md`'
    const result = validateGroundedAnswer(candidate, bundle)
    expect(result.ok).toBe(true)
  })

  it('finalize prefers deterministic HOW_TO_USE answer', () => {
    const bundle = emptyBundle({
      setupInstructions: [
        {
          action: 'Open chrome://extensions',
          section: 'Chrome extension',
          evidence: [{ path: 'extension/chrome/README.md', startLine: 5 }]
        },
        {
          action: 'Enable Developer mode',
          section: 'Chrome extension',
          evidence: [{ path: 'extension/chrome/README.md', startLine: 6 }]
        },
        {
          action: 'Click Load unpacked',
          section: 'Chrome extension',
          evidence: [{ path: 'extension/chrome/README.md', startLine: 7 }]
        }
      ]
    })
    const badModel =
      'Install XAMPP, start Apache and MySQL, then run php index.php on port 80. Also search SampleApp in Firefox Add-ons.'
    const out = finalizeGroundedAnswer({ bundle, modelAnswer: badModel, preferDeterministic: true })
    expect(out.usedDeterministic).toBe(true)
    expect(out.answer).not.toMatch(/php index\.php/i)
    expect(out.answer).not.toMatch(/localhost:80/i)
    expect(out.answer).not.toMatch(/\bXAMPP\b/i)
    expect(out.answer).not.toMatch(/Firefox Add-ons/i)
    expect(out.answer).toMatch(/Load unpacked|chrome:\/\/extensions|Developer mode/i)
    expect(out.answer).toMatch(/No documented backend startup command/i)
  })
})

describe('doc extractor', () => {
  it('extracts numbered chrome install steps', () => {
    const md = `# Chrome\n\n1. Open \`chrome://extensions\`\n2. Enable **Developer mode**\n3. Click **Load unpacked**\n4. Select this \`chrome\` folder\n`
    const extracted = extractDocInstructions('extension/chrome/README.md', md)
    expect(extracted.instructions.length).toBeGreaterThanOrEqual(3)
    expect(extracted.instructions.some((i) => /Load unpacked/i.test(i.action))).toBe(true)
  })
})

describe('fixture workspace how to use', () => {
  it('builds verified setup without invented backend startup', async () => {
    const PROXY = process.env.ANVIL_FIXTURE_WORKSPACE || ''
    if (!PROXY) return
    try {
      await import('fs/promises').then((fs) => fs.access(PROXY))
    } catch {
      return
    }
    invalidateRepositoryMap(PROXY)
    const guard = new PathGuard(PROXY)
    const ignore = new IgnoreEngine(PROXY)
    await ignore.load()
    const brief = await investigateRepository({
      guard,
      ignore,
      message: 'how to use this project',
      settings: DEFAULT_SETTINGS,
      providerIsLocal: true,
      maxFiles: 10
    })
    expect(brief.intent).toBe('HOW_TO_USE_PROJECT')
    const bundle = buildEvidenceBundle(brief)
    expect(bundle.setupInstructions.length).toBeGreaterThan(0)
    expect(bundle.runCommands.every((c) => !/php index\.php/i.test(c.command))).toBe(true)
    const answer = renderGroundedMarkdown(bundle)
    expect(answer).not.toMatch(/php index\.php/i)
    expect(answer).not.toMatch(/localhost:80/i)
    expect(answer).not.toMatch(/Install XAMPP|start Apache|start MySQL/i)
    expect(answer).not.toMatch(/Chrome Web Store|Firefox Add-ons|malicious/i)
    expect(answer).toMatch(/Load unpacked|chrome:\/\/extensions|Developer mode/i)
    expect(answer).toMatch(/No documented backend startup command/i)
    expect(bundle.sourceFiles.length).toBeGreaterThan(0)
    expect(bundle.sourceFiles.length).toBeLessThanOrEqual(brief.filesRead.length)
  })
})
