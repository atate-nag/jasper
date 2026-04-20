// Pass 2: Edge Construction — build the argumentative graph from extracted nodes.

import type { Pass1Output } from '../types';

export function buildPass2Prompt(documentText: string, pass1: Pass1Output): {
  systemPrompt: string;
  userMessage: string;
} {
  const systemPrompt = `You are a document analysis system that constructs the argumentative graph (edges between claims) from a set of extracted nodes.

You have been given a document and its extracted nodes from Pass 1. Your job is to:

1. CONSTRUCT EDGES between nodes. For each logical connection:
   - **id**: Sequential (E001, E002, ...)
   - **fromId**: Source node ID
   - **toId**: Target node ID
   - **type**: One of:
     - S (Support): fromId provides evidence supporting the truth of toId. "Does knowing the source is true make the target more likely true?"
     - W (Warrant): fromId provides the reasoning rule (mechanism) that connects evidence to conclusion — explains WHY the evidence leads to the conclusion.
     - J (Justification): fromId provides the normative reason why the target prescription should be adopted. Answers "why should we do this?" Typically V→P or M→P, occasionally V→V. J is NOT the same as S: S connects evidence to factual/evaluative claims (truth-supporting); J connects evaluative conclusions to action recommendations (action-warranting). Example: "The actionability point is independently fatal" (V) --J--> "The court should dismiss the claim" (P).
     - E (Elaboration): fromId explains, defines, or contextualises toId without adding new evidential weight. If removing this edge wouldn't weaken the argument, it's E.
   - **explicitness**:
     - EX: The connection is explicitly stated in the document ("therefore", "because", "as shown by")
     - IM: The connection is implicit — you infer it from structure, proximity, or logical necessity
   - **notes**: Any observations about the strength or nature of the connection

2. IDENTIFY STRUCTURAL ISSUES. Look for:
   - **Unsupported conclusions**: V nodes with no incoming S or W edges
   - **Unsupported prescriptions**: P nodes with no incoming J edge from a V or M node — a recommendation with no stated justification. Severity: HIGH if this is the document's ultimate recommendation, MEDIUM otherwise.
   - **Circular reasoning**: Cycles in the S/W/J edge graph
   - **Contradictions**: Nodes that make incompatible claims
   - **Missing warrants**: S edges with no accompanying W edge (evidence cited but not explained)
   - **Over-reliance on single source**: Multiple conclusions depending on one factual node
   - **Qualifier mismatches**: Q0 (certain) conclusions drawn from Q1/Q2 (hedged) premises

For each issue:
   - **nodeIds**: Which nodes are involved
   - **issueType**: Category name (e.g. "unsupported_conclusion", "circular_reasoning", "missing_warrant")
   - **description**: Clear explanation of the problem
   - **severity**: high (undermines a key conclusion), medium (weakens an argument), low (minor gap)
   - **suggestedFix**: How to address it

DO NOT compute arithmetic metrics (percentages, counts, depths). That will be computed by code. Focus ONLY on edge construction and issue identification.

Return raw JSON matching this exact schema:

{
  "edges": [
    {
      "id": "string",
      "fromId": "string",
      "toId": "string",
      "type": "S|W|J|E",
      "explicitness": "EX|IM",
      "notes": "string (optional)"
    }
  ],
  "structuralIssues": [
    {
      "nodeIds": ["string"],
      "issueType": "string",
      "description": "string",
      "severity": "high|medium|low",
      "suggestedFix": "string (optional)"
    }
  ]
}

Return raw JSON only. No markdown fences. No commentary outside the JSON.`;

  const nodesJson = JSON.stringify(pass1.nodes, null, 2);

  // Build a compact node reference list for the hard constraint
  const nodeRefList = pass1.nodes
    .map(n => `[${n.id}] ${n.text.substring(0, 60)}...`)
    .join('\n');

  const userMessage = `AVAILABLE NODES — HARD CONSTRAINT:
Every edge you create MUST reference ONLY these IDs as source and target. Do NOT reference any ID not in this list. If you believe an edge should exist but no node captures the proposition, state this as a note rather than creating an edge with a non-existent ID.

${nodeRefList}

ORIGINAL DOCUMENT:
${documentText}

EXTRACTED NODES (from Pass 1):
${nodesJson}`;

  return { systemPrompt, userMessage };
}
