// Jasper-specific helper functions — extracted from intermediary for product-level reuse.

import type { ResponseDirective, ModelConfig, ConversationState, ModelTier } from '@/lib/platform/types';
import type { PersonContext } from '@/lib/backbone/types';
import { getModelRouting } from '@/lib/config/models';
import { DEPTH_EVAL_CONFIG } from '@/lib/platform/depth-config';

/**
 * Detect if the user's message tone contradicts distress.
 * If the user is asking questions, giving instructions, using humour,
 * or being directive, high arousal + negative valence reflects engaged
 * self-examination — not emotional crisis.
 */
export function hasActiveAgencyTone(message: string): boolean {
  const lc = message.toLowerCase();

  // Directive/instructional: telling Jasper what to do
  const directive = /\b(ask me|tell me|give me|explain|let'?s|move on|go deeper|focus on|what (should|do|can)|how (do|should|can))\b/i.test(message)
    || /(?:^|[.,!]\s*)stop \w+ing\b/i.test(message);

  // Question-asking: the user is driving the exchange
  const questioning = /\?\s*$/.test(message.trim())
    || /\b(aren'?t you|are you|don'?t you|isn'?t it|right)\s*$/i.test(message.trim());

  // Humour markers
  const humour = /\b(ha|haha|lol|lmao|god damn|fair enough|touche|touché|funny|hilarious)\b/i.test(lc)
    || /[😂🤣😅😄]/.test(message);

  // Relational feedback about Jasper (not about themselves)
  const aboutJasper = messageReferencesJasper(message);

  // Short dismissive/redirecting messages ("move on", "next", "ok whatever")
  const redirecting = message.split(/\s+/).length <= 6 && /\b(move on|next|anyway|whatever|fine|ok)\b/i.test(lc);

  return directive || questioning || humour || aboutJasper || redirecting;
}

/**
 * Central distress detection. Returns true only when the user appears
 * genuinely distressed — not just engaged with negative-valence content.
 */
export function detectDistress(
  directive: ResponseDirective,
  userMessage: string,
): boolean {
  // Explicit distress intent from classifier — trust it
  if (directive.communicativeIntent === 'distress') return true;

  // Emotional signal threshold
  const emotionalSignal = directive.emotionalArousal > 0.7 && directive.emotionalValence < -0.4;
  if (!emotionalSignal) return false;

  // Gate: if the user's tone shows active agency, it's not distress
  if (hasActiveAgencyTone(userMessage)) return false;

  return true;
}

export function messageReferencesJasper(message: string): boolean {
  return /\b(you('re| are| were| sound| seem| feel| come across as| keep) (being )?(a bit |too |very |really )?(abrupt|harsh|rushed|cold|stiff|formal|blunt|dismissive|condescending|patroni[sz]ing|preachy|generic|vague|robotic|weird|off|wrong|unhelpful)|that('s| is| was| felt) (a bit |too |really )?(abrupt|harsh|rushed|cold|dismissive|condescending|patroni[sz]ing|off|much|weird)|too (fast|quick|direct|blunt|formal|long|short|vague)|on the spot|making me feel|not (helpful|what I (asked|meant|wanted)|listening|hearing me)|I (don't like|didn't like|wish you|need you to) (how|when|the way)|don't (do that|talk to me|assume|put words)|stop (doing that|asking|being)|that's not what I (said|meant|asked))\b/i.test(message);
}

export function buildCareContext(profile: PersonContext['profile']): string | null {
  const parts: string[] = [];

  parts.push('WIDER FRAME FOR THIS PERSON:');
  parts.push('This person appears to be in distress. Before responding,');
  parts.push('consider: what are they actually asking for? It may not be');
  parts.push('what the words literally request. Consider their capacity');
  parts.push('right now — are they in a position to act on advice, or do');
  parts.push('they need to feel held first?');

  if (profile?.current_state?.active_concerns?.length) {
    parts.push(`\nWhat's been on their mind: ${profile.current_state.active_concerns.join('; ')}`);
  }

  if (profile?.current_state?.mood_trajectory) {
    parts.push(`Recent mood: ${profile.current_state.mood_trajectory}`);
  }

  if (profile?.patterns?.stress_responses?.length) {
    const joinField = (val: unknown): string => Array.isArray(val) ? val.join('; ') : String(val);
    parts.push(`How they handle stress: ${joinField(profile.patterns.stress_responses)}`);
  }

  parts.push('\nDo not solve. Be with them first. Solutions can wait');
  parts.push('for when they have the capacity to use them.');

  return parts.join('\n');
}

export function buildPersonContextBlock(profile: PersonContext['profile'], conversationCount: number): string | null {
  const name = profile?.identity?.name;

  const parts: string[] = [];

  if (name) {
    parts.push(`YOU ARE TALKING TO: ${name}`);
  } else {
    parts.push('YOU ARE TALKING TO: [unknown — listen for their name]');
  }

  if (conversationCount > 0) {
    parts.push(`You have spoken ${conversationCount} time${conversationCount > 1 ? 's' : ''} before.`);
  } else {
    parts.push('This is your first conversation.');
  }

  const keyFacts: string[] = [];
  if (profile?.values?.core_values && profile.values.core_values.length > 0) {
    keyFacts.push(`Values: ${profile.values.core_values.slice(0, 3).join(', ')}`);
  }
  if (profile?.current_state?.mood_trajectory) {
    keyFacts.push(`Current mood: ${profile.current_state.mood_trajectory}`);
  }
  if (profile?.current_state?.active_concerns && profile.current_state.active_concerns.length > 0) {
    keyFacts.push(`On their mind: ${profile.current_state.active_concerns[0]}`);
  }
  if (keyFacts.length > 0) {
    parts.push(keyFacts.join('. ') + '.');
  }

  if (name) {
    parts.push(`Use ${name}'s name occasionally — at greetings, at genuine moments, at goodbyes. Not every turn. The way a friend does.`);
  }

  return parts.join('\n');
}

/**
 * Jasper-specific model tier selection. Returns the tier override
 * or null to use the default (standard).
 */
export function jasperRoutingOverrides(
  directive: ResponseDirective,
  personContext: PersonContext,
  userMessage: string,
): Partial<ModelConfig> | null {
  const depth = personContext.relationshipMeta.conversationCount > 15 ? 'established' : 'other';

  const isDistressed = detectDistress(directive, userMessage);

  if (isDistressed) {
    console.log(`[model] Distress detected — routing to Opus`);
    return { tier: 'deep' as ModelTier };
  }

  if (directive.communicativeIntent === 'connecting' &&
      !(directive.recallTriggered && directive.recallTier !== 'none')) {
    return { tier: 'ambient' as ModelTier };
  }

  if (directive.communicativeIntent === 'requesting_input' && directive.emotionalArousal > 0.7) {
    return { tier: 'deep' as ModelTier };
  }

  if (directive.communicativeIntent === 'sense_making' && depth === 'established') {
    return { tier: 'deep' as ModelTier };
  }

  return null;
}

export function shouldFireJasperDepthScoring(
  directive: ResponseDirective,
  conversationState: ConversationState,
  modelTier: string,
): boolean {
  if (modelTier === 'deep') return false;
  if (conversationState.conversationDevelopmentMode) return false;

  const noveltySignals = [
    directive.emotionalArousal > 0.5,
    directive.communicativeIntent === 'sense_making',
    directive.communicativeIntent === 'sharing',
    directive.communicativeIntent === 'venting',
    directive.challengeAppropriate === true,
    directive.recommendedPostureClass === 'exploratory',
    directive.recommendedPostureClass === 'analytical',
  ];

  const signalCount = noveltySignals.filter(Boolean).length;
  return signalCount >= DEPTH_EVAL_CONFIG.noveltyThreshold;
}

/** The feedback regex — matches the same patterns as messageReferencesJasper */
export const JASPER_FEEDBACK_PATTERN = /\b(you('re| are| were| sound| seem| feel| come across as| keep) (being )?(a bit |too |very |really )?(abrupt|harsh|rushed|cold|stiff|formal|blunt|dismissive|condescending|patroni[sz]ing|preachy|generic|vague|robotic|weird|off|wrong|unhelpful)|that('s| is| was| felt) (a bit |too |really )?(abrupt|harsh|rushed|cold|dismissive|condescending|patroni[sz]ing|off|much|weird)|too (fast|quick|direct|blunt|formal|long|short|vague)|on the spot|making me feel|not (helpful|what I (asked|meant|wanted)|listening|hearing me)|I (don't like|didn't like|wish you|need you to) (how|when|the way)|don't (do that|talk to me|assume|put words)|stop (doing that|asking|being)|that's not what I (said|meant|asked))\b/i;
