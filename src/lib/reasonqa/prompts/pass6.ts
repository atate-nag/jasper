// Pass 6: Construct Document B — strongest counter-argument.

import type { Pass1Output, Pass4Output, NodeScheme, CriticalQuestion } from '../types';
import { CRITICAL_QUESTIONS } from '../dialectical/critical-questions';

export function buildPass6Prompt(
  pass1: Pass1Output,
  pass4: Pass4Output,
  schemes: NodeScheme[],
  interpretiveContext: string,
  documentSummary: string,
): { systemPrompt: string; userMessage: string } {

  const systemPrompt = `You are constructing the strongest possible counter-argument to Document A. You are not trying to be balanced or fair. You are arguing the other side as forcefully as a skilled advocate would.

For each load-bearing node, construct the strongest counter-position by answering the critical questions in the direction that OPPOSES Document A's conclusion:
- For argument_from_authority: identify authorities that contradict, distinguish, or limit the cited authority
- For argument_from_rules: identify exceptions, conflicting rules, or alternative interpretations
- For practical_reasoning: identify conflicting goals, better alternatives, or negative consequences
- For all schemes: find the strongest attack on the weakest assumption

Be aggressive. Find the strongest version of the opposing case. Do not hedge. Do not acknowledge A's strengths. Argue to win.

Return raw JSON:
{
  "counterPositions": [
    {
      "nodeId": "string",
      "counterText": "string",
      "criticalQuestionsAnswered": [
        { "cqId": "string", "answer": "string", "strength": "strong|moderate|weak" }
      ],
      "overallStrength": "strong|moderate|weak"
    }
  ]
}

Return raw JSON only.`;

  // Only target CRITICAL and SIGNIFICANT nodes
  const targetNodeIds = new Set(
    pass4.criticalityAssessments
      .filter(a => a.criticality === 'CRITICAL' || a.criticality === 'SIGNIFICANT')
      .map(a => {
        // Find node ID from issue index
        const idx = a.issueIndex;
        return pass1.nodes[idx]?.id;
      })
      .filter(Boolean)
  );

  // Also include ultimate conclusions and necessary sub-conclusions
  for (const id of pass4.ultimateConclusions) targetNodeIds.add(id);
  for (const sc of pass4.necessarySubConclusions) targetNodeIds.add(sc.nodeId);

  const schemeMap = new Map(schemes.map(s => [s.nodeId, s.scheme]));

  const targetNodes = pass1.nodes
    .filter(n => targetNodeIds.has(n.id))
    .map(n => {
      const scheme = schemeMap.get(n.id) || 'other';
      const cqs = CRITICAL_QUESTIONS[scheme] || [];
      return `[${n.id}] (${scheme}) ${n.text.substring(0, 200)}\n  Critical questions: ${cqs.map(q => q.id + ': ' + q.text).join('; ')}`;
    });

  const userMessage = `DOCUMENT A'S POSITION:
${documentSummary}

LOAD-BEARING NODES TO CHALLENGE (${targetNodes.length}):
${targetNodes.join('\n\n')}

AVAILABLE EVIDENCE (from interpretive context and corpus):
${interpretiveContext || 'No interpretive context available.'}`;

  return { systemPrompt, userMessage };
}
