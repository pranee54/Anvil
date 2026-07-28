export type {
  AgentMode,
  AgentRunEvent,
  AppSettings,
  FileChange,
  PendingPermission,
  ModelProviderId,
  IdeBridge,
  ToolActivityCard,
  OllamaModel,
  ConnectionStatus,
  ConversationTurn
} from './types'
export { DEFAULT_SETTINGS } from './types'
export { toolsForMode, TOOL_DEFINITIONS } from './tool-defs'
export { AgentOrchestrator } from './agent/orchestrator'
export { ModelGateway, ModelRequestError } from './models/gateway'
export { OllamaProvider } from './models/ollama'
export { ContextEngine } from './context/context-engine'
export { classifyQuery } from './context/query-intent'
export type { QueryIntent, ClassifiedQuery } from './context/query-intent'
export { getRepositoryMap, invalidateRepositoryMap } from './repository/repo-map'
export type { RepositoryMap, StackSignal, EntryPoint } from './repository/repo-map'
export { buildEvidenceBundle, renderGroundedMarkdown } from './agent/evidence-bundle'
export { finalizeGroundedAnswer, validateGroundedAnswer, collectGroundingIssues } from './agent/answer-grounding'
export type { EvidenceBundle, VerifiedClaim, VerifiedInstruction, VerifiedCommand } from './agent/evidence-types'
export { extractDocInstructions } from './agent/doc-extractor'
export { investigateRepository } from './agent/investigate'
export type { InvestigationBrief, EvidenceItem } from './agent/investigate'
export { ToolRuntime } from './tools/runtime'
export { PathGuard } from './repository/path-guard'
export { IgnoreEngine } from './repository/ignore-engine'
export { runTerminalCommand } from './terminal/runner'
export { gitStatus, gitDiff } from './git/git'
export {
  classifyShellCommand,
  classifyFileMutation,
  isSecretPath,
  canExposeToModel
} from './permissions/policy'
export { looksLikeToolProtocol, sanitizeAssistantText, StreamProtocolFilter } from './chat/protocol-filter'
export type { AgentUiEvent, AgentPhase } from './agent/events'
export { agentEventId } from './agent/events'
