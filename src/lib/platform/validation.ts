import type { ResponseDirective } from '@/lib/platform/types';

const CRISIS_PATTERNS = [
  /\b(suicid|kill\s*my\s*self|end\s*(my|it\s*all)|don'?t\s*want\s*to\s*(live|be\s*here|exist))\b/i,
  /\b(self[- ]?harm|cutting\s*myself|hurt\s*myself)\b/i,
  /\b(crisis|emergency|help\s*me\s*please)\b/i,
];

export function validate(
  directive: ResponseDirective,
  userMessage: string,
): ResponseDirective {
  const result = { ...directive };
  const interventions: string[] = [];

  // Crisis override: if message contains crisis signals, override to distress
  const isCrisis = CRISIS_PATTERNS.some(p => p.test(userMessage));
  if (isCrisis) {
    result.communicativeIntent = 'distress';
    result.recommendedPostureClass = 'warm_reflective';
    result.challengeAppropriate = false;
    result.dispreferred = false;
    result.recommendedResponseLength = 'medium';
    interventions.push('crisis_override');
  }

  // Posture-intent sanity check: venting should not get challenging
  if (result.communicativeIntent === 'venting' && result.recommendedPostureClass === 'challenging') {
    result.recommendedPostureClass = 'warm_reflective';
    interventions.push('venting_challenge_block');
  }

  // Distress should never get minimal or playful
  if (result.communicativeIntent === 'distress' &&
      (result.recommendedPostureClass === 'minimal' || result.recommendedPostureClass === 'playful')) {
    result.recommendedPostureClass = 'warm_reflective';
    interventions.push('distress_posture_override');
  }

  if (interventions.length > 0) {
    result.rationale += ` [Validation: ${interventions.join(', ')}]`;
  }

  return result;
}
