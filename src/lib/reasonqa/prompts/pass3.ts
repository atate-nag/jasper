// Pass 3: Verification — verify citations, assess reasoning chains, produce quality rating.

import type { Pass1Output, Pass2Output, DAGMetrics } from '../types';

export function buildPass3Prompt(
  documentText: string,
  pass1: Pass1Output,
  pass2: Pass2Output,
  metrics: DAGMetrics,
  sourceCorpus?: string,
): {
  systemPrompt: string;
  userMessage: string;
} {
  const hasCorpus = !!sourceCorpus;
  const systemPrompt = `You are a document verification system. You have been given a document, its extracted claims (nodes), its argumentative structure (edges), and computed structural metrics.${hasCorpus ? ' You have also been provided with SOURCE MATERIALS retrieved from authoritative legal databases (National Archives case law and legislation.gov.uk). Use these to verify citations against the actual text of judgments and statutes.' : ''} Your job is the most critical: verify the reasoning quality.

YOUR THREE TASKS:

## 1. CITATION VERIFICATION

For every node with citationStatus "Ext" or "Int", assess whether the citation actually supports the claim.${hasCorpus ? '\n\nIMPORTANT: Where source materials have been retrieved, compare the document\'s claims DIRECTLY against the source text. Check whether the cited case or statute actually says what the document claims it says. Look for misquotation, selective quotation, overstatement, or claims that the source simply does not support.' : ''}

- **nodeId**: The node being verified
- **status**: One of:
  - VERIFIED: The cited source says what the claim says it says
  - PARTIAL: The source partially supports the claim but the claim overstates, omits qualifiers, or takes it out of context
  - FAILED: The source does not support the claim, or contradicts it
  - UNGROUNDED: The claim needs a citation but doesn't have one (citationStatus is None but the claim makes an empirical assertion)
  - UNTRACEABLE: A citation is provided but the source cannot be identified or located

- **failureMode** (if status is PARTIAL or FAILED):
  - INTERPRETIVE: The source is correctly cited but the interpretation is stretched
  - MISATTRIBUTION: The source is real but doesn't say what's claimed
  - FABRICATION: The source appears not to exist
  - CITATION_AS_SIGNAL: The citation is used for authority signalling rather than substantive support
  - COMPOUND_BUNDLING: Multiple distinct claims are bundled under a single citation

- **match** (1-5): How closely the claim matches the source
- **depth** (1-5): How deeply the source was engaged with (1=surface mention, 5=detailed analysis)
- **warrant** (1-5): How well the claim explains WHY the source supports the conclusion
- **notes**: Specific explanation

For nodes with citationStatus "None" that make factual claims, mark them UNGROUNDED.

Additionally, check for UNSUPPORTED PRESCRIPTIONS: P (Prescriptive) nodes that have no incoming J (Justification) edge from a V or M node. A prescription without a justification — "the court should dismiss the claim" with no evaluative basis — is a structural gap. Flag these in the correctionsNeeded list. This is HIGH severity if the P node is the document's ultimate recommendation, MEDIUM otherwise.

## 1b. INTERPRETIVE ISSUE DETECTION

The source materials may include an INTERPRETIVE CONTEXT section with FLAGS for each authority. When flags are present, create corresponding issues. These MUST appear as named, typed issues — not just scattered across citation verifications.

**Issue types and their triggers:**

**janus_faced_evidence** (HIGH if on critical chain, MEDIUM otherwise):
When FLAGS include "janus_faced". The authority has been applied by courts to reach opposing conclusions.
- Name the authority and the proposition
- Name the case(s) that UNDERMINE and those that SUPPORT
- State whether the document acknowledges the counter-reading
- If not: fix is to engage with the counter-authority and explain why the supportive reading is preferred
- Mark affected nodes as PARTIAL (not VERIFIED)

**overrelied_contested** (HIGH — supersedes janus_faced for the same authority):
When FLAGS include "overrelied_contested". The authority is both structurally load-bearing (many nodes depend on it) AND interpretively contested.
- Name the authority and dependent nodes
- State the structural dependency AND the interpretive contest
- Fix: diversify the evidential base or engage with counter-authority

**eroded_authority** (MEDIUM):
When FLAGS include "eroded". 30%+ of substantive citing cases distinguish this authority — its scope is narrower than a blanket citation implies.
- Name the authority and percentage distinguished
- Name 1-2 significant distinguishing cases
- Fix: acknowledge limited scope

**uncited_counter_authority** (MEDIUM — one issue PER uncited case):
When FLAGS include "uncited_counter_authority". A case that undermines or distinguishes the authority is not mentioned in the document. This is directly actionable.
- Name the counter-authority (full case name)
- Name the authority it distinguishes/undermines
- One sentence on how it was applied
- Fix: cite the counter-authority and address it

**stale_authority** (LOW if <3 post-2020 contrary cases, MEDIUM if ≥3):
When FLAGS include "stale". Older cases support the authority but recent cases increasingly distinguish or undermine it.
- Name the authority and the trend
- Name the most recent contrary case
- Fix: acknowledge the trend and argue continued applicability

**Deduplication rules:**
- If overrelied_contested AND janus_faced both flag → create ONE overrelied_contested issue (it subsumes Janus-faced)
- If janus_faced AND eroded both flag → create ONE janus_faced issue noting the erosion
- uncited_counter_authority is ALWAYS separate per uncited case
- stale_authority only if no higher-priority flag (janus_faced, overrelied_contested) already fired

**Summary requirement:** If ANY authority is flagged janus_faced or overrelied_contested, mention it in the summary as a key weakness.

## 2. REASONING CHAIN ASSESSMENT

Trace each major reasoning chain from its terminal conclusion (P or V node) back to its foundations. For each chain:

- **terminalNodeId**: The conclusion node
- **chainDepth**: How many reasoning steps from foundation to conclusion
- **groundingQuality**: Percentage (0-100) of the chain that rests on VERIFIED external citations
- **weakestLink**: The single edge in the chain where reasoning is most vulnerable, with explanation
- **counterArguments**: Arguments a skilled opponent could make against this chain

## 3. OVERALL ASSESSMENT

Produce a final quality judgment:

- **quality**: STRONG (few issues, well-grounded), ADEQUATE (some gaps but core reasoning holds), MARGINAL (significant gaps, key conclusions may not follow), WEAK (fundamental reasoning problems)
- **totalVerified/totalPartial/totalFailed/totalUngrounded**: Counts
- **correctionsNeeded**: Specific, actionable corrections the author should make, ordered by importance
- **summary**: 2-3 paragraph plain-English summary written for the document's author, not for a logician. No jargon. No mention of "nodes" or "edges". Just: what's strong, what's weak, and what to fix.

Return raw JSON matching this exact schema:

{
  "verifications": [
    {
      "nodeId": "string",
      "status": "VERIFIED|PARTIAL|FAILED|UNGROUNDED|UNTRACEABLE",
      "failureMode": "string (optional)",
      "match": "number 1-5 (optional)",
      "depth": "number 1-5 (optional)",
      "warrant": "number 1-5 (optional)",
      "notes": "string"
    }
  ],
  "interpretiveIssues": [
    {
      "nodeIds": ["string"],
      "issueType": "janus_faced_evidence|overrelied_contested|eroded_authority|uncited_counter_authority|stale_authority",
      "description": "string",
      "severity": "high|medium|low",
      "suggestedFix": "string"
    }
  ],
  "chainAssessments": [
    {
      "terminalNodeId": "string",
      "chainDepth": "number",
      "groundingQuality": "number 0-100",
      "weakestLink": { "fromId": "string", "toId": "string", "reason": "string" },
      "counterArguments": ["string"]
    }
  ],
  "assessment": {
    "quality": "STRONG|ADEQUATE|MARGINAL|WEAK",
    "totalVerified": "number",
    "totalPartial": "number",
    "totalFailed": "number",
    "totalUngrounded": "number",
    "correctionsNeeded": ["string"],
    "summary": "string"
  }
}

IMPORTANT: The "interpretiveIssues" array is where Janus-faced, eroded, overrelied, uncited counter-authority, and stale findings go. Create one issue per flag as described in section 1b. Do NOT omit this array — if no interpretive flags are present, return an empty array.

Return raw JSON only. No markdown fences. No commentary outside the JSON.`;

  const nodesJson = JSON.stringify(pass1.nodes, null, 2);
  const edgesJson = JSON.stringify(pass2.edges, null, 2);
  const issuesJson = JSON.stringify(pass2.structuralIssues, null, 2);
  const metricsJson = JSON.stringify(metrics, null, 2);

  let userMessage = `ORIGINAL DOCUMENT:\n${documentText}\n\nEXTRACTED NODES:\n${nodesJson}\n\nEDGES:\n${edgesJson}\n\nSTRUCTURAL ISSUES (from Pass 2):\n${issuesJson}\n\nCOMPUTED METRICS:\n${metricsJson}`;

  if (sourceCorpus) {
    userMessage += `\n\n${sourceCorpus}`;
  }

  return { systemPrompt, userMessage };
}
