// Pass 4: Argument Reconstruction — criticality assessment of Pass 3 issues.

import type { Pass1Output, Pass2Output, Pass3Output, DAGMetrics } from '../types';

export function buildPass4Prompt(
  pass1: Pass1Output,
  pass2: Pass2Output,
  pass3: Pass3Output,
  metrics: DAGMetrics,
): {
  systemPrompt: string;
  userMessage: string;
} {
  const systemPrompt = `You are an expert legal analyst performing argument reconstruction.

You have received the structured output from a three-pass analysis of a legal document:
1. Extracted claims (nodes) with types and qualifiers
2. Reasoning connections (edges) between claims
3. Structural issues and citation verifications
4. An overall quality assessment

Your task is NOT to re-evaluate the document from scratch. Your task is to understand what the document's argument is trying to achieve, and then assess whether the identified weaknesses are critical, significant, or contextual.

## Step 1: Argument Intent

Identify the document's ultimate conclusion(s) — the terminal prescriptive or evaluative nodes that everything else supports. State what the document is trying to establish in one sentence.

Then identify the necessary sub-conclusions. These are claims that MUST hold for the ultimate conclusion to survive. Ask: if this sub-conclusion fails, does the ultimate conclusion survive on other grounds, or does it collapse?

## Step 2: Critical Path Mapping

For each necessary sub-conclusion, trace the reasoning path that supports it:
- SINGLE_POINT_OF_FAILURE: depends on exactly one chain with no independent support
- LIMITED_REDUNDANCY: has 2 supporting chains but they share common nodes
- REDUNDANT: supported by multiple independent chains

## Step 3: Criticality Assessment

Map each issue from the issues list onto the argument topology:
- CRITICAL: On a single-point-of-failure path to a necessary sub-conclusion. If exploited, the ultimate conclusion is at risk.
- SIGNIFICANT: On a limited-redundancy path, or weakens but doesn't collapse the ultimate conclusion.
- CONTEXTUAL: On a redundant path or affects a non-necessary claim. The argument survives even if this point fails.

For each CRITICAL issue, state the consequence chain:
"If [node/warrant] fails → [sub-conclusion] unsupported → [distinction/argument] collapses → [controlling authority/counter-argument] applies → [ultimate conclusion] reversed/weakened."

## Step 4: Quality Rating Adjustment

- ANY CRITICAL issue with complete consequence chain to conclusion reversal → MARGINAL or WEAK
- CRITICAL issues that weaken but don't reverse → cap at ADEQUATE
- No CRITICAL but multiple SIGNIFICANT on same path → ADEQUATE
- Predominantly CONTEXTUAL → STRONG or ADEQUATE

The rating must be consistent with the findings. If the analysis says something is "potentially fatal," the rating cannot be ADEQUATE.

## Step 3b: Proportionality Assessment

If nodes include "words" (source word count) data, check whether load-bearing nodes have proportional textual support. A node on a critical path with high convergence (many downstream dependencies) but low word count (~20-50 words = a single sentence) is disproportionately thin. Flag these as:

"This node is structurally load-bearing (depth N, convergence M) but the source document devotes approximately W words to the supporting analysis. The depth of treatment may be insufficient for the argument's structural role."

This is not a separate issue — it's additional context on an existing critical-path finding. Include it in the consequence chain or as an annotation.

IMPORTANT — ACKNOWLEDGMENT IS NOT MITIGATION:
When assessing criticality, do NOT reduce severity because the document acknowledges a weakness. A gap the author notices is the same gap as one they don't notice. The argument is equally vulnerable either way. Acknowledgment shows good professional practice but does not supply missing analysis or change the structural vulnerability.

## Step 5: Over-Formalization Check

Review CONTEXTUAL issues. Is the issue flagging a genuine defect, or applying formal logic to reasoning that works through analogy, weight-of-authority, policy extension, or other conventionally valid legal reasoning? If the latter, mark as OVER_FORMALIZED and recommend suppression.

## Output

Return raw JSON:

{
  "argumentIntent": "string",
  "ultimateConclusions": ["node IDs"],
  "necessarySubConclusions": [
    {
      "nodeId": "string",
      "description": "string",
      "pathType": "single_point_of_failure|limited_redundancy|redundant",
      "supportingChains": [["nodeId", "nodeId"]],
      "redundancy": "none|partial|full"
    }
  ],
  "criticalityAssessments": [
    {
      "issueIndex": 0,
      "issueType": "string",
      "originalSeverity": "high|medium|low",
      "criticality": "CRITICAL|SIGNIFICANT|CONTEXTUAL",
      "consequenceChain": "string (for CRITICAL only)",
      "overFormalized": false,
      "suppressionReason": "string (if overFormalized)",
      "adjustedSeverity": "high|medium|low"
    }
  ],
  "qualityAdjustment": {
    "originalRating": "string",
    "adjustedRating": "string",
    "reason": "string"
  },
  "suppressedIssueIndices": [0],
  "suppressionCount": 0
}

Return raw JSON only. No markdown fences.`;

  const allIssues = [
    ...(pass2.structuralIssues || []).map((iss, i) => ({ index: i, source: 'structural', ...iss })),
    ...(pass3.interpretiveIssues || []).map((iss, i) => ({ index: (pass2.structuralIssues?.length || 0) + i, source: 'interpretive', ...iss })),
  ];

  const issuesJson = allIssues.map((iss, i) =>
    `[${i}] [${iss.severity?.toUpperCase()}] ${iss.issueType}: ${iss.description}`
  ).join('\n');

  const nodesJson = JSON.stringify(pass1.nodes.map(n => ({
    id: n.id, text: n.text.substring(0, 150), type: n.type, qualifier: n.qualifier,
    ...(n.sourceWordCount ? { words: n.sourceWordCount } : {}),
    ...(n.sourceParagraphs ? { paras: n.sourceParagraphs } : {}),
  })), null, 1);

  const edgesJson = JSON.stringify(pass2.edges.map(e => ({
    from: e.fromId, to: e.toId, type: e.type,
  })), null, 1);

  const userMessage = `NODES (${pass1.nodes.length}):
${nodesJson}

EDGES (${pass2.edges.length}):
${edgesJson}

METRICS:
Chain depth: ${metrics.maxChainDepth}, Reasoning: ${metrics.reasoningPercent}%, Prescription reachability: ${metrics.prescriptionReachabilityPercent}%

ISSUES (${allIssues.length}):
${issuesJson}

QUALITY RATING: ${pass3.assessment.quality}
SUMMARY: ${pass3.assessment.summary}`;

  return { systemPrompt, userMessage };
}
