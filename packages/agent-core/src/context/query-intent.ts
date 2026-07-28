export type QueryIntent =
  | 'GENERAL_PROJECT'
  | 'CAPABILITIES'
  | 'EXPLAIN_CODE'
  | 'LOCATE_FEATURE'
  | 'DEBUG'
  | 'IMPLEMENT'
  | 'REFACTOR'
  | 'RUN_TESTS'
  | 'FIX_DIAGNOSTICS'
  | 'HOW_TO_RUN'
  | 'HOW_TO_USE_PROJECT'
  | 'SECURITY'
  | 'FOLLOW_UP'

export type ClassifiedQuery = {
  intent: QueryIntent
  needsInvestigation: boolean
  searchHints: string[]
  reason: string
}

/**
 * Lightweight intent classifier for tool/investigation routing.
 * Includes common Telugu / Hinglish coding-chat patterns.
 */
export function classifyQuery(message: string, historyHint?: string): ClassifiedQuery {
  const raw = message.trim()
  const lower = raw.toLowerCase()
  const hist = (historyHint || '').toLowerCase()

  if (/\b(@problems|fix (current )?errors|diagnostics)\b/.test(lower)) {
    return {
      intent: 'FIX_DIAGNOSTICS',
      needsInvestigation: true,
      searchHints: [],
      reason: 'diagnostics/fix request'
    }
  }

  if (
    /\b(security|vulnerab|xss|csrf|injection|auth bypass|secure|security issue|undha)\b/.test(lower) ||
    /security issue|secure ga|risk/.test(lower)
  ) {
    return {
      intent: 'SECURITY',
      needsInvestigation: true,
      searchHints: mergeHints(extractTopicHints(lower, hist), ['password', 'token', 'auth', 'jwt', 'session']),
      reason: 'security review'
    }
  }

  if (
    /\b(how to (use|run|install|setup|set up)|how do i (use|run|install|get)|getting started|install guide)\b/.test(
      lower
    ) ||
    /ela (use|run|install) cheyyali|project ela (use|run)|use cheyyali|run cheyyali/.test(lower) ||
    /^how to use this project\b/.test(lower)
  ) {
    return {
      intent: 'HOW_TO_USE_PROJECT',
      needsInvestigation: true,
      searchHints: ['readme', 'install', 'load unpacked', 'manifest', 'client-install'],
      reason: 'how to use / setup project'
    }
  }

  if (
    /\b(how to run|start( the)? (server|app|project)|startup|npm start|flutter run)\b/.test(lower) ||
    /ela run|ela start|run ela/.test(lower)
  ) {
    return {
      intent: 'HOW_TO_RUN',
      needsInvestigation: true,
      searchHints: ['readme', 'script', 'docker'],
      reason: 'startup/run question'
    }
  }

  if (/\b(test|tests|jest|phpunit|pytest)\b/.test(lower) && /\b(run|fix|fail|pass)\b/.test(lower)) {
    return {
      intent: 'RUN_TESTS',
      needsInvestigation: true,
      searchHints: ['test', 'spec'],
      reason: 'tests'
    }
  }

  if (
    /\b(add|implement|create|build|write|feature)\b/.test(lower) &&
    !/\b(explain|what|how does)\b/.test(lower)
  ) {
    return {
      intent: 'IMPLEMENT',
      needsInvestigation: true,
      searchHints: extractTopicHints(lower, hist),
      reason: 'implementation'
    }
  }

  if (/\b(refactor|cleanup|rename|extract)\b/.test(lower)) {
    return {
      intent: 'REFACTOR',
      needsInvestigation: true,
      searchHints: extractTopicHints(lower, hist),
      reason: 'refactor'
    }
  }

  if (/\b(bug|error|broken|fail|crash|debug|not working|fix)\b/.test(lower)) {
    return {
      intent: 'DEBUG',
      needsInvestigation: true,
      searchHints: extractTopicHints(lower, hist),
      reason: 'debug'
    }
  }

  // Telugu / casual: "em cheyavachu" / "em chestundi" ≈ what does this / what can I do
  if (
    /em\s*cheyavachu|em\s*chestundi|cheyavachu\s*dinitho|emi\s*cheyali|what can (i|we) do|capabilities|features|use cases/.test(
      lower
    ) ||
    /project (lo|tho) em|dinitho|ee project em/.test(lower)
  ) {
    return {
      intent: 'CAPABILITIES',
      needsInvestigation: true,
      searchHints: [],
      reason: 'capability / what-can-I-do question'
    }
  }

  if (
    /\b(where|find|locate|which file|ela tesukuntundi|ela work|flow)\b/.test(lower) ||
    /proxy|login|auth|session|api/.test(lower)
  ) {
    const hints = extractTopicHints(lower, hist)
    if (hints.length || /proxy|login|auth|session/.test(lower)) {
      return {
        intent: 'LOCATE_FEATURE',
        needsInvestigation: true,
        searchHints: hints.length ? hints : extractTopicHints(lower + ' ' + hist, ''),
        reason: 'locate / explain feature flow'
      }
    }
  }

  if (
    /\b(explain|overview|architecture|how (does|do)|what (is|does)|works?|understand)\b/.test(lower) ||
    /ela|avutadhi|cheyyi|explain cheyyi/.test(lower)
  ) {
    if (/login|auth|proxy|session|api/.test(lower) || /login|auth|proxy|session/.test(hist)) {
      return {
        intent: 'LOCATE_FEATURE',
        needsInvestigation: true,
        searchHints: extractTopicHints(lower, hist),
        reason: 'explain specific flow'
      }
    }
    return {
      intent: 'GENERAL_PROJECT',
      needsInvestigation: true,
      searchHints: [],
      reason: 'general project understanding'
    }
  }

  if (
    /\b(this|that|it|indhulo|akkada|daanilo)\b/.test(lower) &&
    hist &&
    hist.length > 20
  ) {
    return {
      intent: 'FOLLOW_UP',
      needsInvestigation: true,
      searchHints: extractTopicHints(lower, hist),
      reason: 'follow-up referring to prior topic'
    }
  }

  return {
    intent: 'EXPLAIN_CODE',
    needsInvestigation: true,
    searchHints: extractTopicHints(lower, hist),
    reason: 'default explain/inspect'
  }
}

function extractTopicHints(lower: string, hist: string): string[] {
  const blob = `${lower} ${hist}`
  const hints: string[] = []
  const topics: Array<[RegExp, string[]]> = [
    [/proxy|session|oxylabs|nodemaven/, ['proxy', 'session', 'chrome.proxy', 'proxy/session', 'proxy/config']],
    [/login|auth|jwt|token|password/, ['login', 'auth', 'jwt', 'Bearer', 'password']],
    [/fingerprint|user.?agent|ua\b/, ['fingerprint', 'useragent', 'profile']],
    [/admin|dashboard/, ['admin', 'allocate', 'providers']],
    [/extension|chrome|firefox|manifest/, ['manifest', 'background', 'chrome.runtime']],
    [/usage|telemetry/, ['usage', 'telemetry', 'report']]
  ]
  for (const [re, words] of topics) {
    if (re.test(blob)) hints.push(...words)
  }
  // English path-like tokens
  for (const t of lower.split(/[^a-z0-9_./-]+/)) {
    if (t.length > 3 && !STOP.has(t)) hints.push(t)
  }
  return [...new Set(hints)].slice(0, 12)
}

function mergeHints(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])].slice(0, 12)
}

const STOP = new Set([
  'this',
  'that',
  'with',
  'from',
  'have',
  'what',
  'when',
  'where',
  'which',
  'does',
  'project',
  'code',
  'file',
  'please',
  'cheyyi',
  'explain',
  'undha',
  'emaina'
])
