import type { PersonContext } from '@/lib/backbone/types';
import type { Policy, ResponseDirective } from './types';

export function reformulate(
  userMessage: string,
  personContext: PersonContext,
  policy: Policy,
  directive: ResponseDirective,
): string {
  const parts: string[] = [];

  parts.push(`[ORIGINAL MESSAGE]\n${userMessage}`);

  // Add relevant person context
  const contextParts: string[] = [];

  if (personContext.memories.length > 0) {
    contextParts.push(`Relevant memories: ${personContext.memories.map(m => m.memory).join('; ')}`);
  }
  if (personContext.profile.current_state?.active_concerns?.length) {
    contextParts.push(`Active concerns: ${personContext.profile.current_state.active_concerns.join('; ')}`);
  }
  if (personContext.profile.patterns?.growth_edges?.length) {
    contextParts.push(`Growth edges: ${personContext.profile.patterns.growth_edges.join('; ')}`);
  }

  if (contextParts.length > 0) {
    parts.push(`[PERSON CONTEXT — use to inform your response, do not repeat verbatim]\n${contextParts.join('\n')}`);
  }

  // Relationship guardrail — inject into the message itself when discussing absent partners
  const relationshipSignals = /\b(partner|wife|husband|boyfriend|girlfriend|ex|she said|he said|she thinks|he thinks|she doesn'?t|he doesn'?t|she won'?t|he won'?t|she feels|he feels|she wants|he wants|told me|accused me|blocked me|called me|says I|my family)\b/i;
  if (relationshipSignals.test(userMessage)) {
    parts.push(`[RELATIONSHIP SAFETY — THIS OVERRIDES YOUR RESPONSE APPROACH]
This message is about someone who is not present. In your response:
1. Do NOT analyse, diagnose, or characterise the absent person
2. Do NOT say what they are "really" doing or frame them as the problem
3. Do NOT lead toward ending the relationship, even implicitly
4. DO focus on what THIS person feels, needs, and wants
5. DO ask "what do you think she/he might be experiencing?"
6. DO frame difficulties as dynamics between two people
Reflect their words back without interpreting the absent person's motives.`);
  }

  // Add policy framing
  parts.push(`[RESPONSE APPROACH]\n${policy.response_structure.opening_move} → ${policy.response_structure.development_approach} → ${policy.response_structure.closing_move}`);

  // Add interaction preferences
  {
    const prefs = personContext.profile.interaction_prefs;
    if (prefs && Object.keys(prefs).length > 0) {
      const prefParts: string[] = [];
      if (prefs.directness_preference) prefParts.push(`Directness: ${prefs.directness_preference}`);
      if (prefs.humour_receptivity) prefParts.push(`Humour: ${prefs.humour_receptivity}`);
      if (prefs.challenge_tolerance) prefParts.push(`Challenge tolerance: ${prefs.challenge_tolerance}`);
      if (prefParts.length > 0) {
        parts.push(`[INTERACTION PREFERENCES]\n${prefParts.join(', ')}`);
      }
    }
  }

  return parts.join('\n\n');
}
