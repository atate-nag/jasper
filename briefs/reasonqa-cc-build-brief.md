# CC Brief — Reasoning Quality Assurance Product

## What We're Building

A web application where a user uploads a professional document (legal brief, strategy memo, audit opinion, research report) and receives a structured reasoning quality analysis. The analysis decomposes the document into its argumentative architecture, verifies citations against authoritative sources, and identifies where reasoning is weak, unsupported, or structurally vulnerable.

The user never sees Toulmin, DAGs, or argumentation theory. They see: "Your document has 47 claims. 3 are unsupported. 2 citations don't match the source. 1 conclusion doesn't follow from the evidence cited. Here are the specific problems and how to fix them."

## Architecture

```
┌─────────────────────────────────────────────┐
│           PRODUCT SHELL: ReasonQA           │
│  - Document ingestion                       │
│  - Three-pass pipeline orchestrator         │
│  - Report generation                        │
│  - Legal corpus connector                   │
│  - Simple upload → report UI                │
│  - Landing page + Stripe                    │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────┴──────────────────────────┐
│           INTERMEDIARY (shared from Jasper)  │
│  - Model calling (multi-provider API)       │
│  - Prompt assembler                         │
│  - Session management                       │
│  - Analytics and logging                    │
│  - Auth (Supabase)                          │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────┴──────────────────────────┐
│           BACKBONE (shared)                 │
│  - Supabase (DB, auth, storage)             │
│  - Model providers (Anthropic, OpenAI)      │
└─────────────────────────────────────────────┘
```

## Shared Components to Use

From the completed Jasper intermediary refactor:

| Component | Use in ReasonQA | Notes |
|-----------|----------------|-------|
| `lib/intermediary/models.ts` | Yes — all three passes need LLM calls | Multi-provider, failover, streaming not needed (non-streaming fine for batch analysis) |
| `lib/intermediary/prompt-assembler.ts` | Yes — assemble pass prompts with document content | Priority-ordered component system works well here |
| `lib/intermediary/session.ts` | Simplified — track analysis jobs, not conversations | No turn-by-turn state needed |
| `lib/intermediary/analytics.ts` | Yes — log every analysis run | Track: document type, node count, edge count, issues found, processing time |
| Supabase auth | Yes — user accounts, usage tracking | |
| Supabase storage | Yes — uploaded documents | |
| Supabase DB | Yes — analysis results, user data | |

**Not needed from Jasper:**
- Classifier (no intent/valence/arousal)
- Policy engine (no adaptive policies)
- Recall system (no conversation history)
- Guardrails (no relationship mode)
- Background tasks (no depth scoring)

## The Three-Pass Pipeline

This is the core of the product. Three sequential LLM calls, each building on the previous output.

### Pass 1: Node Extraction + Edge Drafts

**Input:** The uploaded document text
**Prompt:** From `/mnt/user-data/outputs/three-pass-verification-prompts.md` — Pass 1 prompt
**Model:** Sonnet (balance of quality and cost for decomposition work)
**Output:** Structured JSON — array of nodes, each with:

```typescript
interface Node {
  id: string;           // P001, P002, ...
  claimText: string;    // The atomic proposition
  type: 'F' | 'M' | 'V' | 'P';
  citation: 'Ext' | 'Int' | 'None';
  citationSource?: string;
  citationFlag?: 'expected' | 'adequate';
  qualifier: 'Q0' | 'Q1' | 'Q2';
  edgeDrafts: string[]; // e.g. ["S→P003", "←W from P001"]
  sourceSection?: string;
  repetitionOf?: string;
  codingNotes?: string;
}
```

**Prompt engineering note:** The Pass 1 prompt must instruct the model to output valid JSON. Wrap the Toulmin extraction instructions with a JSON schema constraint. The model should extract nodes paragraph by paragraph, following the coding methodology's four-type classification with legal domain adaptation notes.

### Pass 2: Edge Construction + DAG Validation

**Input:** Pass 1 JSON output (nodes array)
**Prompt:** From the prompts doc — Pass 2 prompt
**Model:** Sonnet
**Output:** Structured JSON — edges array + structural metrics + issues:

```typescript
interface Edge {
  fromId: string;
  toId: string;
  type: 'S' | 'W' | 'J' | 'E';
  explicitness: 'EX' | 'IM';
  notes?: string;
}

interface StructuralMetrics {
  totalNodes: number;
  nodesByType: { F: number; M: number; V: number; P: number };
  totalEdges: number;
  edgesByType: { S: number; W: number; J: number; E: number };
  reasoningPercent: number;    // (S+W+J) / total
  elaborationPercent: number;  // E / total
  maxChainDepth: number;
  convergencePoints: string[]; // node IDs
  orphanNodes: string[];       // P/V nodes with no incoming reasoning edges
}

interface StructuralIssue {
  nodeIds: string[];
  issueType: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
  suggestedFix?: string;
}
```

**Important:** Some structural metrics (reasoning %, elaboration %, convergence points, orphan detection) should be computed by code from the edges array, not by the LLM. The LLM constructs edges and identifies issues; code computes the graph metrics deterministically. This avoids the arithmetic error problem we found in the single-pass tests.

### Pass 3: Verification

**Input:** Pass 1 nodes + Pass 2 edges + source materials (if available)
**Prompt:** From the prompts doc — Pass 3 prompt
**Model:** Opus (highest quality for verification judgments — this is where accuracy matters most)
**Additional input:** Retrieved source material from legal corpus (if legal document) or user-provided reference documents
**Output:** Structured JSON:

```typescript
interface VerificationResult {
  nodeId: string;
  status: 'VERIFIED' | 'PARTIAL' | 'FAILED' | 'UNGROUNDED' | 'UNTRACEABLE';
  failureMode?: 'INTERPRETIVE' | 'MISATTRIBUTION' | 'FABRICATION' | 'CITATION_AS_SIGNAL' | 'COMPOUND_BUNDLING';
  match?: number;    // 1-5
  depth?: number;    // 1-5
  warrant?: number;  // 1-5
  notes: string;
}

interface ReasoningChainAssessment {
  terminalNodeId: string;
  chainDepth: number;
  groundingQuality: number;   // % of chain resting on verified Ext citations
  weakestLink: { edgeFromId: string; edgeToId: string; reason: string };
  counterArguments: string[];
}

interface OverallAssessment {
  quality: 'STRONG' | 'ADEQUATE' | 'MARGINAL' | 'WEAK';
  totalVerified: number;
  totalPartial: number;
  totalFailed: number;
  totalUngrounded: number;
  correctionsNeeded: string[];
  summary: string;  // Plain English summary for the user
}
```

### Post-Pass: Metric Computation (Code, Not LLM)

After all three passes, compute from the structured data:

```typescript
function computeMetrics(nodes: Node[], edges: Edge[]): StructuralMetrics {
  // Count node types
  // Count edge types
  // Compute reasoning % and elaboration %
  // Find max chain depth via BFS/DFS on reasoning edges (S/W/J only)
  // Find convergence points (nodes with 2+ independent S/W/J inputs)
  // Find orphan P/V nodes (no incoming S/W/J edges)
  // Compute Claim Grounding Scores per terminal node
}
```

This is deterministic code — no LLM involved. Eliminates arithmetic errors.

## Legal Corpus Connector

For Pass 3 citation verification in legal documents:

### National Archives Find Case Law API

```
Base URL: https://caselaw.nationalarchives.gov.uk
Licence: Open Justice Licence (commercial use permitted, no charge)
Format: LegalDocML XML

Endpoints:
- Search: /judgments?query={search_term}
- Retrieve by NCN: /{court}/{year}/{number} (e.g., /ewhc/ch/2025/2755)
- Atom feed: /atom.xml for change detection

Rate limiting: "reasonable number of requests" — email caselaw@nationalarchives.gov.uk for computational analysis approval
```

### legislation.gov.uk API

```
Base URL: https://www.legislation.gov.uk
Format: XML, HTML, PDF
Free access, no authentication required

Example: /ukpga/2006/46/section/901G for Companies Act 2006 s.901G
```

### Implementation

```typescript
interface CorpusConnector {
  searchCaseLaw(query: string): Promise<CaseResult[]>;
  getCaseByNCN(ncn: string): Promise<CaseDocument>;
  getStatute(act: string, section: string): Promise<StatuteText>;
}
```

For MVP, the connector does simple search + retrieval. The Pass 3 prompt tells the model which citations to verify; the connector fetches the source text; the model compares claim against source.

**For non-legal documents:** The user can optionally upload reference documents that the analysis claims to cite. These serve as the verification corpus. If no corpus is provided, Pass 3 runs in "structural-only" mode — checking internal consistency, warrant validity, and qualifier appropriateness, but not citation accuracy.

## Database Schema

```sql
-- Users (Supabase auth handles the basics)
CREATE TABLE profiles (
  id UUID REFERENCES auth.users PRIMARY KEY,
  email TEXT,
  plan TEXT DEFAULT 'free',  -- free, pro, enterprise
  analyses_used INTEGER DEFAULT 0,
  analyses_limit INTEGER DEFAULT 3,  -- free tier: 3/month
  stripe_customer_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Analysis jobs
CREATE TABLE analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  document_name TEXT,
  document_type TEXT,  -- legal, strategy, audit, finance, policy, other
  status TEXT DEFAULT 'pending',  -- pending, pass1, pass2, pass3, metrics, complete, failed
  
  -- Pass outputs (stored as JSONB)
  pass1_nodes JSONB,
  pass2_edges JSONB,
  pass2_metrics JSONB,
  pass2_issues JSONB,
  pass3_verification JSONB,
  pass3_chains JSONB,
  pass3_assessment JSONB,
  
  -- Computed metrics
  computed_metrics JSONB,
  
  -- Metadata
  node_count INTEGER,
  edge_count INTEGER,
  quality_rating TEXT,  -- STRONG, ADEQUATE, MARGINAL, WEAK
  processing_time_ms INTEGER,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  product TEXT DEFAULT 'reasonqa'
);

-- Document storage uses Supabase Storage bucket 'documents'
-- Uploaded documents stored as: documents/{user_id}/{analysis_id}/original.pdf

-- Usage tracking
CREATE TABLE usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  analysis_id UUID REFERENCES analyses(id),
  event TEXT,  -- upload, pass1_start, pass1_complete, etc.
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## UI

### Page 1: Landing Page (`/`)

Clean, direct. The pitch:

**Headline:** "Does your reasoning hold?"
**Subhead:** "Upload any professional document. Get a structural analysis of every claim, every citation, every logical step. Know where arguments are strong and where they're vulnerable — before anyone else finds out."

Three example findings from the test cases (anonymised):
- "Your AI said the limitation deadline passed. It hadn't. We caught it."
- "A cited case didn't support the stated proposition. We flagged it."
- "The same evidence supported opposing conclusions. We mapped both."

CTA: "Try it free" → sign up → 3 free analyses/month
Pricing: Pro at £200/month (unlimited), Enterprise (contact us)

### Page 2: Dashboard (`/dashboard`)

List of past analyses with status, quality rating, date.
"New Analysis" button → upload flow.

### Page 3: Upload (`/analyse`)

1. Drop/select document (PDF, DOCX, TXT, MD)
2. Optional: select document type (legal, strategy, audit, finance, policy, other)
3. Optional: upload reference documents for citation verification
4. "Analyse" button → processing begins

### Page 4: Analysis Report (`/analysis/{id}`)

**Summary bar:** Quality rating (colour-coded), node count, edge count, issues found, processing time.

**Tab 1: Issues** (default view)
List of problems found, ordered by severity. Each issue shows:
- The specific claim text
- What's wrong (evidence gap, invalid warrant, missing qualifier, unaddressed counter, confabulation)
- Why it matters
- Suggested fix

**Tab 2: Claims Table**
All nodes in a searchable/sortable table. Columns: ID, claim text, type (F/M/V/P), citation status, qualifier, verification status. Click any row to see its edges and verification detail.

**Tab 3: Structure**
Structural metrics: reasoning %, elaboration %, max chain depth, convergence points, orphan claims. Visual DAG rendering if feasible (nice-to-have, not MVP).

**Tab 4: Verification**
Per-citation verification results. Match/Depth/Warrant scores. Failure modes. Reasoning chain assessments with grounding scores.

### Tech Stack

- **Framework:** Next.js (same as Jasper — shared deployment knowledge)
- **Hosting:** Vercel
- **Database:** Supabase (same instance as Jasper, separate tables with `product = 'reasonqa'`)
- **Auth:** Supabase Auth
- **Storage:** Supabase Storage
- **Payments:** Stripe Checkout + webhook for plan management
- **PDF parsing:** pdf-parse or similar (extract text from uploaded PDFs)
- **Models:** Anthropic API (Sonnet for Pass 1+2, Opus for Pass 3)

## ProductConfig (for shared intermediary)

```typescript
const reasonQAConfig: ProductConfig = {
  name: 'reasonqa',
  identityPrompt: '', // No conversational identity needed
  
  classifierDimensions: [], // No classification — every document gets the same pipeline
  classifierPrompt: '',
  
  policies: [], // No adaptive policies
  policySelector: () => null,
  
  routingRules: {
    pass1: 'claude-sonnet-4-20250514',
    pass2: 'claude-sonnet-4-20250514',
    pass3: 'claude-opus-4-20250414',
  },
  
  recallConfig: { sources: [] }, // No recall — each analysis is independent
  
  promptComponents: (pass, documentText, priorPassOutput) => {
    // Assemble the appropriate pass prompt with document content
    // Pass 1: pass1Prompt + documentText
    // Pass 2: pass2Prompt + pass1Output
    // Pass 3: pass3Prompt + pass1Output + pass2Output + sourceCorpus
  },
  
  preGenerationGuards: [
    // Document size check (reject if too long for context window)
    // Profanity/abuse check on uploaded content
  ],
  
  postGenerationGuards: [
    // JSON validation — ensure each pass output parses correctly
    // Schema validation — ensure required fields present
  ],
  
  backgroundTasks: [
    // Citation corpus lookup (async, feeds into Pass 3)
  ],
  
  analyticsConfig: {
    trackPerAnalysis: ['document_type', 'node_count', 'edge_count', 'quality_rating', 'issues_found', 'processing_time']
  }
};
```

## Processing Flow

```
User uploads document
  → Extract text (PDF parse / direct text)
  → Create analysis record (status: 'pending')
  → Start pipeline:
  
    Pass 1 (status: 'pass1')
      → Assemble prompt: Pass 1 system prompt + document text
      → Call Sonnet
      → Parse JSON response → validate schema
      → Store pass1_nodes
      → If legal: trigger background citation lookup for Ext-cited nodes
    
    Pass 2 (status: 'pass2')
      → Assemble prompt: Pass 2 system prompt + Pass 1 nodes JSON
      → Call Sonnet
      → Parse JSON response → validate schema
      → Store pass2_edges, pass2_issues
      → Compute structural metrics (code) → store pass2_metrics + computed_metrics
    
    Pass 3 (status: 'pass3')
      → Assemble prompt: Pass 3 system prompt + Pass 1 nodes + Pass 2 edges + source corpus (if available)
      → Call Opus
      → Parse JSON response → validate schema
      → Store pass3_verification, pass3_chains, pass3_assessment
    
    Finalise (status: 'complete')
      → Compute final quality rating
      → Update analysis record
      → Notify user (email or in-app)
```

## Cost Estimate Per Analysis

| Component | Model | Estimated tokens | Cost |
|-----------|-------|-----------------|------|
| Pass 1 | Sonnet | ~15K in + ~8K out | ~$0.12 |
| Pass 2 | Sonnet | ~10K in + ~5K out | ~$0.07 |
| Pass 3 | Opus | ~20K in + ~8K out | ~$0.60 |
| Corpus lookup | API calls | — | negligible |
| **Total** | | | **~$0.80/analysis** |

At £200/month Pro tier, a user running 20 analyses/month costs £16 in compute. Healthy margins.

## MVP Scope — What Ships First

**In scope:**
- Document upload (PDF, DOCX, TXT, MD)
- Three-pass pipeline with JSON output
- Deterministic metric computation
- Issues list with severity, explanation, and suggested fix
- Claims table with verification status
- Structural metrics summary
- Basic user auth and usage tracking
- Landing page
- Stripe integration (free tier: 3/month, Pro: £200/month)

**Deferred:**
- Visual DAG rendering
- Legal corpus auto-lookup (MVP: user uploads reference docs; auto-lookup comes later)
- Enterprise tier with SSO/on-premise
- Domain-specific prompt tuning (legal vs strategy vs audit)
- Batch analysis (multiple documents)
- API access for programmatic use
- Completeness checking (Pass 4: "what issues should have been addressed?")

## Files to Create

```
apps/reasonqa/
  ├── app/
  │   ├── page.tsx                    # Landing page
  │   ├── layout.tsx                  # App layout
  │   ├── dashboard/
  │   │   └── page.tsx                # Analysis list
  │   ├── analyse/
  │   │   └── page.tsx                # Upload flow
  │   ├── analysis/
  │   │   └── [id]/
  │   │       └── page.tsx            # Report view
  │   └── api/
  │       ├── analyse/
  │       │   └── route.ts            # Upload + start pipeline
  │       ├── analysis/
  │       │   └── [id]/
  │       │       └── route.ts        # Get analysis results
  │       └── webhook/
  │           └── stripe/
  │               └── route.ts        # Stripe webhooks
  ├── lib/
  │   ├── pipeline/
  │   │   ├── orchestrator.ts         # Runs three passes sequentially
  │   │   ├── pass1.ts                # Node extraction prompt + parsing
  │   │   ├── pass2.ts                # Edge construction prompt + parsing
  │   │   ├── pass3.ts                # Verification prompt + parsing
  │   │   └── metrics.ts              # Deterministic DAG metric computation
  │   ├── corpus/
  │   │   ├── national-archives.ts    # Find Case Law API connector
  │   │   └── legislation.ts          # legislation.gov.uk connector
  │   ├── documents/
  │   │   └── parser.ts               # PDF/DOCX/TXT text extraction
  │   └── config.ts                   # ProductConfig for shared intermediary
  ├── prompts/
  │   ├── pass1.ts                    # Pass 1 system prompt
  │   ├── pass2.ts                    # Pass 2 system prompt
  │   └── pass3.ts                    # Pass 3 system prompt
  └── components/
      ├── UploadForm.tsx
      ├── AnalysisReport.tsx
      ├── IssuesList.tsx
      ├── ClaimsTable.tsx
      ├── StructureMetrics.tsx
      └── VerificationDetail.tsx
```

## Reference Documents

The CC instance should have access to these files for prompt content and methodology:

- `/mnt/user-data/outputs/three-pass-verification-prompts.md` — The three pass prompts (adapt to JSON output)
- `/mnt/user-data/uploads/Coding_Methodology_v4.md` — Full Toulmin coding methodology (467 lines)
- `/mnt/user-data/outputs/intermediary-refactor-brief.md` — Shared component architecture
- The Jasper codebase (for shared intermediary imports)

## Success Criteria

The product is shippable when:

1. A user can upload a PDF and receive a structured reasoning quality report
2. The report identifies specific issues with claim text, explanation, and fix
3. Citations with Ext status show verification results
4. Structural metrics are computed deterministically (not by LLM)
5. The quality rating (STRONG/ADEQUATE/MARGINAL/WEAK) is honest and useful
6. Stripe payment works for Pro tier
7. Free tier limits are enforced (3 analyses/month)
8. The landing page clearly communicates "does your reasoning hold?" without mentioning Toulmin
