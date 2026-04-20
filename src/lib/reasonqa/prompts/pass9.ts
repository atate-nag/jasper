// Pass 9: Map A onto C — final criticality scoring.

import type { Pass1Output, Pass6Output, Pass7Output, Pass8Output } from '../types';

export function buildPass9Prompt(
  pass1: Pass1Output,
  documentB: Pass6Output,
  documentC: Pass7Output,
  perturbations: Pass8Output,
): { systemPrompt: string; userMessage: string } {

  const systemPrompt = `Map every node in Document A onto the objective synthesis (Document C). For each node, assess its final status and criticality.

For each node:
- statusInC: "accepted" (C agrees), "rejected" (C disagrees), "contested" (genuinely uncertain)
- loadBearingInC: true if this node is one of C's identified load-bearing points
- fascinationThreshold: true if perturbation testing showed the alternative is comparably coherent
- counterStrength: strength of the strongest counter-argument from Document B ("strong", "moderate", "weak", "none")
- criticality: 0-1 score. High = important + poorly grounded + highly vulnerable
- interpretation: one sentence explaining the score

Also produce a summary paragraph describing the dialectical assessment.

Return raw JSON:
{
  "scores": [
    {
      "nodeId": "string",
      "statusInC": "accepted|rejected|contested",
      "loadBearingInC": false,
      "fascinationThreshold": false,
      "counterStrength": "strong|moderate|weak|none",
      "criticality": 0.0,
      "interpretation": "string"
    }
  ],
  "summary": "string"
}

Return raw JSON only.`;

  const fascinationNodes = new Set(
    perturbations.perturbations
      .filter(p => p.isFascinationThreshold)
      .map(p => p.proposition)
  );

  const counterMap = new Map(documentB.counterPositions.map(cp => [cp.nodeId, cp.overallStrength]));
  const loadBearingIds = new Set(documentC.loadBearingNodes.map(n => n.nodeId));
  const acceptedSet = new Set(documentC.acceptedFromA);
  const rejectedSet = new Set(documentC.rejectedFromA);
  const contestedSet = new Set(documentC.contested);

  const nodeData = pass1.nodes.map(n => {
    const status = acceptedSet.has(n.id) ? 'accepted' : rejectedSet.has(n.id) ? 'rejected' : contestedSet.has(n.id) ? 'contested' : 'accepted';
    return `[${n.id}] status=${status} counter=${counterMap.get(n.id) || 'none'} loadBearing=${loadBearingIds.has(n.id)} fascination=${fascinationNodes.has(n.id)} "${n.text.substring(0, 80)}"`;
  }).join('\n');

  const userMessage = `DOCUMENT A NODES (${pass1.nodes.length}):
${nodeData}

DOCUMENT C SYNTHESIS: ${documentC.synthesis.substring(0, 500)}

LOAD-BEARING NODES IN C:
${documentC.loadBearingNodes.map(n => `${n.nodeId}: ${n.reason} (confidence: ${n.confidence})`).join('\n')}

PERTURBATION RESULTS:
${perturbations.perturbations.map(p => `${p.proposition}: impact=${p.coherenceImpact}, fascination=${p.isFascinationThreshold}`).join('\n')}`;

  return { systemPrompt, userMessage };
}
