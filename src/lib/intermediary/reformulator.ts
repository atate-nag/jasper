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

  // Determine if this is a light conversation
  const isLight = directive.communicativeIntent === 'connecting' ||
    directive.recommendedPostureClass === 'playful' ||
    directive.recommendedPostureClass === 'minimal' ||
    directive.recommendedPostureClass === 'exploratory' && !directive.dispreferred;

  // Add relevant person context — scoped by intent
  const contextParts: string[] = [];

  if (isLight) {
    // Light conversations: identity + interaction prefs ONLY
    // No active concerns, no growth edges, no avoidance patterns
    if (personContext.profile.identity?.occupation) {
      contextParts.push(`Identity: ${personContext.profile.identity.occupation}`);
    }
    const prefs = personContext.profile.interaction_prefs;
    if (prefs?.directness_preference) {
      contextParts.push(`Communication: prefers directness`);
    }
  } else {
    // Substantive conversations: include relevant context
    if (personContext.memories.length > 0) {
      contextParts.push(`Relevant memories: ${personContext.memories.map(m => m.memory).join('; ')}`);
    }
    if (personContext.profile.current_state?.active_concerns?.length) {
      contextParts.push(`Active concerns: ${personContext.profile.current_state.active_concerns.join('; ')}`);
    }
    if (personContext.profile.patterns?.growth_edges?.length) {
      contextParts.push(`Growth edges: ${personContext.profile.patterns.growth_edges.join('; ')}`);
    }
  }

  if (contextParts.length > 0) {
    parts.push(`[PERSON CONTEXT — use to inform your response, do not repeat verbatim]\n${contextParts.join('\n')}`);
  }

  // Add policy framing
  parts.push(`[RESPONSE APPROACH]\n${policy.response_structure.opening_move} → ${policy.response_structure.development_approach} → ${policy.response_structure.closing_move}`);

  // Add interaction preferences (always relevant, but keep brief for light)
  if (!isLight) {
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
