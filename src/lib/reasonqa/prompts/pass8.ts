// Pass 8: Self-reflection — perturbation testing of Document C.

import type { Pass7Output, Pass4Output } from '../types';

export function buildPass8Prompt(
  documentC: Pass7Output,
  rejectedNodeId: string,
  rejectedNodeText: string,
): { systemPrompt: string; userMessage: string } {

  const systemPrompt = `You previously constructed this objective synthesis. Now you must test its robustness.

You are REQUIRED to accept a proposition you previously rejected. Given this constraint, what is the minimal set of other changes needed to maintain coherence?

Return raw JSON:
{
  "proposition": "string",
  "alternativeSynthesis": "If this proposition is accepted, then...",
  "changesRequired": ["string"],
  "coherenceImpact": "minimal|moderate|fundamental",
  "isFascinationThreshold": true
}

isFascinationThreshold = true if the alternative synthesis is COMPARABLY coherent to the original — meaning reasonable decision-makers could genuinely differ on this point.

Return raw JSON only.`;

  const userMessage = `YOUR SYNTHESIS: ${documentC.synthesis}

ACCEPTED: ${documentC.acceptedFromA.join(', ')}
REJECTED: ${documentC.rejectedFromA.join(', ')}
CONTESTED: ${documentC.contested.join(', ')}

NOW: You MUST accept proposition ${rejectedNodeId}: "${rejectedNodeText}"

Given this constraint, what changes? Does the overall synthesis survive?`;

  return { systemPrompt, userMessage };
}
