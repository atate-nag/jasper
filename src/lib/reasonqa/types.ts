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
  sourceParagraphs?: string;    // e.g. "7-9" or "14" or "22-28, 31"
  sourceWordCount?: number;     // approximate word count devoted to this claim
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
  status: 'VERIFIED' | 'PARTIAL' | 'FAILED' | 'UNGROUNDED' | 'UNTRACEABLE' | 'SOURCE_DOCUMENT';
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

// ── Pass 4: Argument Reconstruction ──────────────────────────────

export interface SubConclusion {
  nodeId: string;
  description: string;
  pathType: 'single_point_of_failure' | 'limited_redundancy' | 'redundant';
  supportingChains: string[][];
  redundancy: 'none' | 'partial' | 'full';
}

export interface CriticalityAssessment {
  issueIndex: number;
  issueType: string;
  originalSeverity: string;
  criticality: 'CRITICAL' | 'SIGNIFICANT' | 'CONTEXTUAL';
  consequenceChain?: string;
  overFormalized?: boolean;
  suppressionReason?: string;
  adjustedSeverity: string;
}

export interface Pass4Output {
  argumentIntent: string;
  ultimateConclusions: string[];
  necessarySubConclusions: SubConclusion[];
  criticalityAssessments: CriticalityAssessment[];
  qualityAdjustment: {
    originalRating: string;
    adjustedRating: string;
    reason: string;
  };
  suppressedIssueIndices: number[];
  suppressionCount: number;
}

// ── Pass 5-9: Dialectical Synthesis ──────────────────────────────

export type ArgumentationScheme =
  | 'argument_from_authority' | 'argument_from_analogy' | 'argument_from_rules'
  | 'argument_from_evidence' | 'argument_from_sign' | 'practical_reasoning'
  | 'argument_from_classification' | 'argument_from_precedent' | 'causal_argument'
  | 'argument_from_negative_consequences' | 'argument_from_position_to_know'
  | 'argument_from_correlation' | 'argument_from_best_explanation' | 'other';

export interface CriticalQuestion {
  id: string;
  text: string;
  attackType: 'undermining' | 'rebutting' | 'undercutting';
}

export interface NodeScheme {
  nodeId: string;
  scheme: ArgumentationScheme;
}

export interface Pass5Output {
  nodeSchemes: NodeScheme[];
}

export interface CounterPosition {
  nodeId: string;
  counterText: string;
  criticalQuestionsAnswered: Array<{ cqId: string; answer: string; strength: 'strong' | 'moderate' | 'weak' }>;
  overallStrength: 'strong' | 'moderate' | 'weak';
}

export interface Pass6Output {
  counterPositions: CounterPosition[];
}

export interface Pass7Output {
  synthesis: string;
  acceptedFromA: string[];
  rejectedFromA: string[];
  acceptedFromB: string[];
  contested: string[];
  loadBearingNodes: Array<{
    nodeId: string;
    reason: string;
    resolution: string;
    confidence: number;
  }>;
}

export interface PerturbationResult {
  proposition: string;
  alternativeSynthesis: string;
  changesRequired: string[];
  coherenceImpact: 'minimal' | 'moderate' | 'fundamental';
  isFascinationThreshold: boolean;
}

export interface Pass8Output {
  perturbations: PerturbationResult[];
}

export interface FinalNodeScore {
  nodeId: string;
  statusInC: 'accepted' | 'rejected' | 'contested';
  loadBearingInC: boolean;
  fascinationThreshold: boolean;
  counterStrength: 'strong' | 'moderate' | 'weak' | 'none';
  criticality: number;
  interpretation: string;
}

export interface Pass9Output {
  scores: FinalNodeScore[];
  summary: string;
}

// ── Analysis Record ──────────────────────────────────────────────

export type AnalysisStatus =
  | 'pending' | 'pass1' | 'pass2' | 'metrics' | 'pass3'
  | 'pass5' | 'pass6' | 'pass7' | 'pass8' | 'pass9'
  | 'complete' | 'error';

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
  pass4_output: Pass4Output | null;
  dialectical: boolean;
  pass5_output: Pass5Output | null;
  pass6_output: Pass6Output | null;
  pass7_output: Pass7Output | null;
  pass8_output: Pass8Output | null;
  pass9_output: Pass9Output | null;
  sources: SourceReference[] | null;
  pass_stats: PassStats | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}
