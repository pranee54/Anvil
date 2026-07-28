import { describe, expect, it } from 'vitest'
import path from 'path'
import { PathGuard } from '../packages/agent-core/src/repository/path-guard'
import { IgnoreEngine } from '../packages/agent-core/src/repository/ignore-engine'
import { getRepositoryMap, invalidateRepositoryMap } from '../packages/agent-core/src/repository/repo-map'
import { classifyQuery } from '../packages/agent-core/src/context/query-intent'
import { investigateRepository } from '../packages/agent-core/src/agent/investigate'
import { DEFAULT_SETTINGS } from '../packages/agent-core/src/types'
import { sanitizeUserFacingAnswer } from '../packages/anvil-extension/src/answer-sanitize'

/** Optional real multi-stack fixture. Set ANVIL_FIXTURE_WORKSPACE to enable these cases. */
const FIXTURE = process.env.ANVIL_FIXTURE_WORKSPACE || ''

async function fixtureWorkspaceAvailable(): Promise<boolean> {
  if (!FIXTURE) return false
  try {
    const fs = await import('fs/promises')
    await fs.access(FIXTURE)
    return true
  } catch {
    return false
  }
}

describe('query intent', () => {
  it('classifies Telugu capability question', () => {
    const q = classifyQuery('em cheyavachu dinitho?')
    expect(q.intent).toBe('CAPABILITIES')
    expect(q.needsInvestigation).toBe(true)
  })

  it('classifies proxy locate question', () => {
    const q = classifyQuery('Chrome extension proxy ela tesukuntundi?')
    expect(q.intent).toBe('LOCATE_FEATURE')
    expect(q.searchHints.join(' ')).toMatch(/proxy/i)
  })

  it('classifies login explain', () => {
    const q = classifyQuery('login flow explain cheyyi')
    expect(q.intent).toBe('LOCATE_FEATURE')
    expect(q.searchHints.join(' ')).toMatch(/login|auth/i)
  })

  it('classifies security follow-up with history', () => {
    const q = classifyQuery('indhulo security issue emaina undha?', 'login flow JWT token backend/api/auth/login.php')
    expect(q.intent).toBe('SECURITY')
  })
})

describe('repository map + investigation', () => {
  it('maps multi-stack fixture and does not invent run commands', async () => {
    if (!(await fixtureWorkspaceAvailable())) return
    invalidateRepositoryMap(FIXTURE)
    const guard = new PathGuard(FIXTURE)
    const ignore = new IgnoreEngine(FIXTURE)
    await ignore.load()
    const map = await getRepositoryMap(guard, ignore)
    expect(map.stacks).toEqual(expect.arrayContaining(['php', 'browser_extension']))
    expect(map.entryPoints.some((e) => e.path.includes('manifest.json'))).toBe(true)
    expect(map.apiRoutes.some((r) => r.includes('login.php'))).toBe(true)
    expect(map.verifiedRunCommands.every((c) => !/php index\.php.*port 80/i.test(c.command))).toBe(true)
  })

  it('investigates capability question by reading real files', async () => {
    if (!(await fixtureWorkspaceAvailable())) return
    invalidateRepositoryMap(FIXTURE)
    const guard = new PathGuard(FIXTURE)
    const ignore = new IgnoreEngine(FIXTURE)
    await ignore.load()
    const brief = await investigateRepository({
      guard,
      ignore,
      message: 'em cheyavachu dinitho?',
      settings: DEFAULT_SETTINGS,
      providerIsLocal: true,
      maxFiles: 10
    })
    expect(brief.intent).toBe('CAPABILITIES')
    expect(brief.filesRead.length).toBeGreaterThanOrEqual(4)
    expect(brief.filesRead.some((f) => f.includes('manifest') || f.includes('login') || f.includes('proxy'))).toBe(
      true
    )
    expect(brief.modelContext).toMatch(/VERIFIED|No documented startup/i)
    expect(brief.modelContext).not.toMatch(/php index\.php will start/i)
    expect(brief.evidence.length).toBeGreaterThan(0)
  })

  it('investigates proxy flow with chrome extension + API evidence', async () => {
    if (!(await fixtureWorkspaceAvailable())) return
    const guard = new PathGuard(FIXTURE)
    const ignore = new IgnoreEngine(FIXTURE)
    await ignore.load()
    const brief = await investigateRepository({
      guard,
      ignore,
      message: 'Chrome extension proxy ela tesukuntundi?',
      settings: DEFAULT_SETTINGS,
      providerIsLocal: true,
      maxFiles: 10
    })
    expect(brief.filesRead.some((f) => f.includes('background') || f.includes('manifest'))).toBe(true)
    expect(
      brief.filesRead.some((f) => f.includes('proxy/config') || f.includes('proxy/session')) ||
        brief.searchHits.some((h) => /proxy/i.test(h))
    ).toBe(true)
  })

  it('seeds demo-project progressively', async () => {
    const root = path.resolve(__dirname, '../demo-project')
    const guard = new PathGuard(root)
    const ignore = new IgnoreEngine(root)
    await ignore.load()
    const brief = await investigateRepository({
      guard,
      ignore,
      message: 'how does this project work?',
      settings: DEFAULT_SETTINGS,
      providerIsLocal: true,
      maxFiles: 6
    })
    expect(brief.filesRead.length).toBeGreaterThan(0)
    expect(brief.filesRead.length).toBeLessThanOrEqual(6)
  })
})

describe('no unverified run command in sanitized answers', () => {
  it('rewrites invented php index.php port claims', () => {
    const clean = sanitizeUserFacingAnswer(
      'You can run php index.php which will start a local server on port 80.'
    )
    expect(clean.toLowerCase()).not.toMatch(/port 80/)
    expect(clean).toMatch(/haven't found a documented startup command/i)
  })
})
