// ReasonQA — TypeScript interfaces for the three-pass analysis pipeline.

// ── Pass 1: Node Extraction ──────────────────────────────────────

export interface ClaimNode {
  id: string;              // P001, P002, ...
  text: string;            // The atomic proposition
  type: 'F' | 'M' | 'V' | 'P';  // Factual, Mechanism, Value/Evaluative, Prescriptive
  citationStatus: 'Ext' | 'Int' | 'None';
  citationSource?: string;
  qualifier: 'Q0' | 'Q1' | 'Q2';  // None, hedged, strongly hedged
  edgeDrafts: string[];    // e.g. ["S→P003", "←W from P001"]
  sourceSection?: string;
  codingNotes?: string;
}

export interface Pass1Output {
  nodes: ClaimNode[];
  documentTitle: string;
  documentType: string;
}

// ── Pass 2: Edge Construction ────────────────────────────────────

export interface Edge {
  id: string;
  fromId: string;
  toId: string;
  type: 'S' | 'W' | 'J' | 'E';  // Support, Warrant, Justification, Elaboration
  explicitness: 'EX' | 'IM';
  notes?: string;
}

export interface StructuralIssue {
  nodeIds: string[];
  issueType: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
  suggestedFix?: string;
}

export interface Pass2Output {
  edges: Edge[];
  structuralIssues: StructuralIssue[];
}

// ── Deterministic Metrics (computed by code, not LLM) ────────────

export interface DAGMetrics {
  totalNodes: number;
  nodesByType: { F: number; M: number; V: number; P: number };
  totalEdges: number;
  edgesByType: { S: number; W: number; J: number; E: number };
  reasoningPercent: number;
  elaborationPercent: number;
  maxChainDepth: number;
  convergencePoints: string[];
  orphanNodes: string[];
  prescriptionReachabilityPercent: number;
}

// ── Pass 3: Verification ─────────────────────────────────────────

export interface CitationVerification {
  nodeId: string;
  status: 'VERIFIED' | 'PARTIAL' | 'FAILED' | 'UNGROUNDED' | 'UNTRACEABLE';
  failureMode?: 'INTERPRETIVE' | 'MISATTRIBUTION' | 'FABRICATION' | 'CITATION_AS_SIGNAL' | 'COMPOUND_BUNDLING';
  match?: number;     // 1-5
  depth?: number;     // 1-5
  warrant?: number;   // 1-5
  notes: string;
}

export interface ReasoningChainAssessment {
  terminalNodeId: string;
  chainDepth: number;
  groundingQuality: number;
  weakestLink: { fromId: string; toId: string; reason: string };
  counterArguments: string[];
}

export interface OverallAssessment {
  quality: 'STRONG' | 'ADEQUATE' | 'MARGINAL' | 'WEAK';
  totalVerified: number;
  totalPartial: number;
  totalFailed: number;
  totalUngrounded: number;
  correctionsNeeded: string[];
  summary: string;
}

export interface InterpretiveIssue {
  nodeIds: string[];
  issueType: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
  suggestedFix?: string;
}

export interface Pass3Output {
  verifications: CitationVerification[];
  interpretiveIssues?: InterpretiveIssue[];
  chainAssessments: ReasoningChainAssessment[];
  assessment: OverallAssessment;
}

// ── Analysis Record ──────────────────────────────────────────────

export type AnalysisStatus =
  | 'pending' | 'pass1' | 'pass2' | 'metrics' | 'pass3' | 'complete' | 'error';

export type AnalysisMode = 'full' | 'quick';

export interface PassStat {
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface PassStats {
  pass1?: PassStat;
  pass2?: PassStat;
  corpus?: { durationMs: number; fetched: number; found: number };
  pass3?: PassStat;
}

export interface SourceReference {
  refId: string;          // S1, S2, ...
  citationRaw: string;    // Original citation text
  citationType: 'case' | 'statute' | 'unknown';
  found: boolean;
  url: string;
  nodeIds: string[];      // Which nodes cite this source
  textPreview?: string;   // First 500 chars of retrieved text
}

export interface Analysis {
  id: string;
  user_id: string;
  status: AnalysisStatus;
  mode: AnalysisMode;
  title: string | null;
  doc_type: string;
  doc_text: string;
  doc_size_bytes: number | null;
  pass1_output: Pass1Output | null;
  pass2_output: Pass2Output | null;
  metrics_output: DAGMetrics | null;
  pass3_output: Pass3Output | null;
  sources: SourceReference[] | null;
  pass_stats: PassStats | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}
