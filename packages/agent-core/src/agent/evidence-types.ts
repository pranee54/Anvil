export type SourceReference = {
  path: string
  startLine?: number
  endLine?: number
  excerpt?: string
}

export type VerifiedClaim = {
  statement: string
  evidence: SourceReference[]
}

export type VerifiedInstruction = {
  action: string
  evidence: SourceReference[]
  section?: string
}

export type VerifiedCommand = {
  command: string
  source: SourceReference
}

export type EvidenceFile = {
  path: string
  role: 'docs' | 'config' | 'code' | 'schema' | 'other'
  supportsClaims: boolean
}

export type EvidenceBundle = {
  intent: string
  projectSummary: VerifiedClaim[]
  capabilities: VerifiedClaim[]
  setupInstructions: VerifiedInstruction[]
  runCommands: VerifiedCommand[]
  architecture: VerifiedClaim[]
  relevantFiles: EvidenceFile[]
  unknowns: string[]
  inspectedFiles: string[]
  sourceFiles: string[]
}

export type StructuredGroundedAnswer = {
  summary: string
  sections: Array<{ title: string; content: string; sources: string[] }>
  unknowns: string[]
  suggestions?: Array<{ text: string; labeledGeneric: true }>
}
