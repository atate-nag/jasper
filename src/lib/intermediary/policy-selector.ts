import type { ResponseDirective, Policy, RelationalDepth } from './types';
import type { PersonContext } from '@/lib/backbone/types';

function getRelationalDepth(ctx: PersonContext): RelationalDepth {
  const count = ctx.relationshipMeta.conversationCount;
  if (count <= 1) return 'first_encounter';
  if (count <= 5) return 'early';
  if (count <= 15) return 'developing';
  return 'established';
}

export function selectPolicy(
  directive: ResponseDirective,
  personContext: PersonContext,
  policyLibrary: Policy[],
): Policy {
  const depth = getRelationalDepth(personContext);
  const postureClass = directive.recommendedPostureClass;

  // 1. Filter by posture class — STRICT, never cross classes
  let candidates = policyLibrary.filter(p => p.posture_class === postureClass);

  if (candidates.length === 0) {
    // No policies for this posture class — this is a library gap, log it
    console.warn(`[policy-selector] No policies for posture class: ${postureClass}`);
    // Fall back to warm_reflective generics, NOT distress
    candidates = policyLibrary.filter(p => p.posture_class === 'warm_reflective');
    if (candidates.length === 0) {
      // Ultimate fallback
      return {
        id: 'fallback-warm',
        name: 'Fallback Warm Reflective',
        posture_class: 'warm_reflective',
        relational_depth_range: ['first_encounter', 'early', 'developing', 'established'],
        system_prompt_fragment: 'Respond warmly and reflectively. Show that you heard them before doing anything else.',
        response_structure: {
          opening_move: 'simple_reflection',
          development_approach: 'reflect_then_observe',
          closing_move: 'gentle_question_or_silence',
          dispreferred: false,
        },
        constraints: {
          max_length: 'medium',
          reflection_minimum: true,
          challenge_permitted: false,
          humour_permitted: true,
        },
      };
    }
  }

  // 2. Prefer policies matching relational depth
  const depthMatches = candidates.filter(p =>
    p.relational_depth_range.includes(depth) || p.relational_depth_range.includes('any')
  );
  if (depthMatches.length > 0) candidates = depthMatches;

  // 3. Refine based on directive specifics
  if (candidates.length > 1) {
    // For warm_reflective with connecting/light intent, prefer connecting/light variants
    if (postureClass === 'warm_reflective') {
      if (directive.communicativeIntent === 'connecting' ||
          (directive.emotionalArousal < 0.3 && directive.emotionalValence > 0.2)) {
        const lightVariants = candidates.filter(p =>
          p.id.includes('connecting') || p.id.includes('light')
        );
        if (lightVariants.length > 0) candidates = lightVariants;
      }
    }

    // For exploratory without explicit ambivalence signals, prefer curious/intellectual variants
    if (postureClass === 'exploratory') {
      if (!directive.dispreferred && !directive.challengeAppropriate &&
          (directive.communicativeIntent === 'connecting' || directive.communicativeIntent === 'sense_making')) {
        const curiousVariants = candidates.filter(p =>
          p.id.includes('curious') || p.id.includes('intellectual')
        );
        if (curiousVariants.length > 0) candidates = curiousVariants;
      }
    }

    // Prefer challenge variants if challengeAppropriate
    if (directive.challengeAppropriate) {
      const challengeVariants = candidates.filter(p => p.constraints.challenge_permitted);
      if (challengeVariants.length > 0) candidates = challengeVariants;
    }

    // Prefer dispreferred-structured variants if dispreferred
    if (directive.dispreferred) {
      const disprefVariants = candidates.filter(p => p.response_structure.dispreferred);
      if (disprefVariants.length > 0) candidates = disprefVariants;
    }

    // Match response length
    const lengthMatches = candidates.filter(p =>
      p.constraints.max_length === directive.recommendedResponseLength
    );
    if (lengthMatches.length > 0) candidates = lengthMatches;
  }

  return candidates[0];
}
