// Pass 7: Construct Document C — objective synthesis.

import type { Pass1Output, Pass6Output } from '../types';

export function buildPass7Prompt(
  pass1: Pass1Output,
  documentB: Pass6Output,
  documentSummary: string,
): { systemPrompt: string; userMessage: string } {

  const systemPrompt = `You are a detached, competent decision-maker — a senior judge or an experienced board chair. You have read two arguments about the same question.

Your task: construct the OBJECTIVELY STRONGEST position on this question. Not a compromise. Not a summary of both sides. The position you would reach if you had to decide.

RULES:
1. When A and B agree on a proposition, accept it.
2. When A and B conflict, you MUST choose one or construct a third position. Never say "both sides raise valid concerns." Decide.
3. When A asserts something B doesn't challenge, accept it unless you have independent reason to doubt it.
4. When B raises a challenge A doesn't answer, the challenge stands unless the evidence is insufficient.
5. Prefer positions with greater evidential coverage (explaining more available evidence).
6. Prefer positions with fewer internal contradictions.
7. Prefer simpler positions over complex ones when evidential support is equal.

Return raw JSON:
{
  "synthesis": "The objectively strongest position is...",
  "acceptedFromA": ["P050", "P051"],
  "rejectedFromA": ["P063", "P071"],
  "acceptedFromB": ["counter positions accepted"],
  "contested": ["P065"],
  "loadBearingNodes": [
    {
      "nodeId": "P065",
      "reason": "This is where the outcome turns",
      "resolution": "The synthesis resolves this by...",
      "confidence": 0.7
    }
  ]
}

Return raw JSON only.`;

  const nodesA = pass1.nodes.map(n => `[${n.id}] ${n.text.substring(0, 150)}`).join('\n');
  const countersB = documentB.counterPositions.map(cp =>
    `Counter to ${cp.nodeId}: ${cp.counterText.substring(0, 200)} (strength: ${cp.overallStrength})`
  ).join('\n\n');

  const userMessage = `DOCUMENT A argues: ${documentSummary}

DOCUMENT A'S PROPOSITIONS (${pass1.nodes.length}):
${nodesA}

DOCUMENT B'S COUNTER-ARGUMENTS (${documentB.counterPositions.length}):
${countersB}`;

  return { systemPrompt, userMessage };
}
