/** @deprecated Canonical: packages/agent-core — do not extend. */
import path from 'path'
import type { AppSettings } from '@shared/types'

const SECRET_BASENAMES = new Set([
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  'credentials.json',
  'service-account.json',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa'
])

const SECRET_PATTERNS = [
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /\.env(\.|$)/i,
  /secret/i,
  /credentials/i,
  /token\.json$/i
]

const DANGEROUS_SHELL = [
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\//,
  /\brm\s+-rf\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\b:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/,
  /\bcurl\b.+\|\s*(ba)?sh\b/,
  /\bwget\b.+\|\s*(ba)?sh\b/,
  /\bchmod\s+-R\s+777\b/,
  /\bsudo\b/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bdiskutil\b/,
  /\bformat\b/,
  />\s*\/dev\//,
  /\bgit\s+push\s+.*--force\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-fdx?\b/
]

const INSTALL_SHELL = [
  /\bnpm\s+i(nstall)?\b/,
  /\bpnpm\s+i(nstall)?\b/,
  /\byarn\s+add\b/,
  /\bbun\s+add\b/,
  /\bpip\s+install\b/,
  /\bpip3\s+install\b/,
  /\bcomposer\s+require\b/,
  /\bcomposer\s+install\b/,
  /\bflutter\s+pub\s+get\b/,
  /\bbrew\s+install\b/,
  /\bapt(-get)?\s+install\b/
]

export function isSecretPath(relativePath: string): boolean {
  const base = path.basename(relativePath)
  if (SECRET_BASENAMES.has(base)) return true
  return SECRET_PATTERNS.some((re) => re.test(relativePath))
}

export function canExposeToModel(
  relativePath: string,
  settings: AppSettings,
  providerIsLocal: boolean
): boolean {
  if (!isSecretPath(relativePath)) return true
  if (providerIsLocal) return true
  return settings.permissions.shareSecretsWithCloud
}

export function classifyShellCommand(
  command: string,
  settings: AppSettings
): { level: 'safe' | 'ask' | 'deny'; reason?: string } {
  const trimmed = command.trim()
  if (!trimmed) return { level: 'deny', reason: 'Empty command' }

  if (DANGEROUS_SHELL.some((re) => re.test(trimmed))) {
    if (!settings.permissions.allowDestructiveShell) {
      return { level: 'deny', reason: 'Destructive shell command blocked by policy' }
    }
    return { level: 'ask', reason: 'Potentially destructive shell command' }
  }

  if (INSTALL_SHELL.some((re) => re.test(trimmed))) {
    if (!settings.permissions.allowInstalls) {
      return { level: 'ask', reason: 'Dependency installation requires approval' }
    }
    return { level: 'ask', reason: 'Install command requires confirmation' }
  }

  // Read-only / analysis / common verification commands are safe
  if (
    /^(ls|pwd|cat|head|tail|wc|echo|which|type|git\s+(status|diff|log|show|branch)|flutter\s+(analyze|test|doctor)|dart\s+(analyze|format|test)|npm\s+(test|start|run\s+\S+|ls)|npx\s+\S+|bun(\s+test|\s+run\s+\S+)?|composer\s+test|php\s+artisan\s+test|pytest|python3?\s+(\S+\.py|.+-m\s+pytest)|node(\s+\S+)?|tsc\b)/i.test(
      trimmed
    )
  ) {
    return { level: 'safe' }
  }

  return { level: 'ask', reason: 'Shell command requires approval' }
}

export function classifyFileMutation(
  toolName: string,
  relativePath: string,
  _settings: AppSettings
): { level: 'safe' | 'ask' | 'deny'; reason?: string } {
  if (isSecretPath(relativePath)) {
    return { level: 'deny', reason: 'Refusing to modify secret/credential files' }
  }

  if (toolName === 'delete_file') {
    return { level: 'ask', reason: 'File deletion requires approval' }
  }

  const important =
    /(^|\/)(package\.json|composer\.json|pubspec\.yaml|Cargo\.toml|go\.mod|pyproject\.toml|tsconfig.*\.json|electron\.vite\.config\.|vite\.config\.|webpack\.config\.|Dockerfile|docker-compose\.ya?ml|AGENTS\.md|\.aiignore)$/i.test(
      relativePath
    )

  if (important) {
    return { level: 'ask', reason: 'Important configuration file change requires approval' }
  }

  // Routine source edits apply automatically; user can still Reject/Revert in the diff panel.
  return { level: 'safe' }
}
