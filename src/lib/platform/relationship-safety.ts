// Platform relationship safety: generic detection, parameterized injection and rewrite.
// Product shells provide the directive text and voice description.

import { callModel } from '@/lib/model-client';
import { logUsage } from '@/lib/usage';
import { getModelRouting } from '@/lib/config/models';
import type { PromptComponent, ConversationState } from './types';
import type { Message } from '@/types/message';

// ── Detection (generic) ──────────────────────────────────────

const RELATIONSHIP_SIGNALS = /\b(partner|wife|husband|boyfriend|girlfriend|my ex|she said|he said|she thinks|he thinks|she doesn'?t|he doesn'?t|she won'?t|he won'?t|she feels|he feels|she wants|he wants|told me|accused me|blocked me|called me|says I|my family|my partner|my spouse|the divorce|custody|separated|the kids|co-?parent|his solicitor|her solicitor|settlement|he always|she always|he never|she never)\b/i;

export function detectRelationshipContext(
  userMessage: string,
  sessionHistory: Message[],
): boolean {
  if (RELATIONSHIP_SIGNALS.test(userMessage)) return true;
  return sessionHistory.slice(-6).some(m =>
    m.role === 'user' && RELATIONSHIP_SIGNALS.test(m.content)
  );
}

export function updateRelationshipTurnCount(
  state: ConversationState,
  isActive: boolean,
): ConversationState {
  if (isActive) {
    return { ...state, relationshipTurnCount: state.relationshipTurnCount + 1 };
  }
  if (state.relationshipTurnCount > 0) {
    return { ...state, relationshipTurnCount: Math.max(0, state.relationshipTurnCount - 1) };
  }
  return state;
}

// ── Injection builder (parameterized) ─────────────────────────

export function buildRelationshipInjection(
  state: ConversationState,
  modeDirective: string,
  selfAwareIntervention: string,
): PromptComponent[] {
  const components: PromptComponent[] = [];
  const count = state.relationshipTurnCount;

  if (count < 1) return components;

  components.push({
    priority: 99,
    content: modeDirective,
    label: 'relationship_mode',
    tokenEstimate: Math.ceil(modeDirective.split(/\s+/).length * 1.3),
  });

  if (count >= 8 && !state.relationshipInterventionFired) {
    components.push({
      priority: 99,
      content: selfAwareIntervention,
      label: 'relationship_intervention',
      tokenEstimate: Math.ceil(selfAwareIntervention.split(/\s+/).length * 1.3),
    });
  }

  return components;
}

// ── Post-generation rewrite (parameterized voice) ─────────────

export async function relationshipSafetyRewrite(
  response: string,
  userName: string,
  voiceDescription: string,
  userId?: string,
): Promise<{ text: string; rewritten: boolean; violations: string[] }> {
  try {
    const routing = getModelRouting();

    const checkResult = await callModel(
      routing.classification,
      '',
      [{
        role: 'user',
        content: `Check this AI response for relationship safety violations.

A violation is ANY sentence where an absent partner is:
- The grammatical subject doing something to the user
- Characterised in terms of their motives or psychology
- Framed as "the problem" in the relationship
- Used as the basis for suggesting the relationship should end

Also flag any sentence that could not be said in front of BOTH partners without being unfair to one of them.

RESPONSE:
${response}

Return JSON: {"pass": true, "violations": []}
or: {"pass": false, "violations": ["exact sentence that violates"]}`,
      }],
      0,
    );

    logUsage(checkResult.usage, 'relationship_safety_check', userId);

    const cleaned = checkResult.text
      .replace(/^\s*```(?:json)?\s*\n?/i, '')
      .replace(/\n?\s*```\s*$/i, '')
      .trim();
    const parsed = JSON.parse(cleaned) as { pass: boolean; violations: string[] };

    if (parsed.pass) {
      return { text: response, rewritten: false, violations: [] };
    }

    console.log(`[relationship-safety] Violations found: ${parsed.violations.join(' | ')}`);

    const rewriteResult = await callModel(
      routing.standard,
      '',
      [{
        role: 'user',
        content: `Rewrite this response to remove all relationship safety violations while keeping the emotional attunement, tone, and helpfulness to the user (${userName}).

VIOLATIONS FOUND:
${parsed.violations.map((v: string) => `- "${v}"`).join('\n')}

RULES FOR REWRITING:
- Replace every statement about the absent partner with a reflection of what the USER is experiencing
- "She's refusing to engage" → "It sounds like you feel shut down when you try to raise this"
- "He benefits from the arrangement" → "You're feeling like the arrangement works for everyone except you"
- Keep the voice — ${voiceDescription}
- Keep the emotional accuracy — don't flatten the response
- Do NOT add new content or analysis — only transform what's there
- If removing a violation leaves a gap, replace it with a question to the user about their own experience

ORIGINAL RESPONSE:
${response}

Return ONLY the rewritten response. No commentary, no explanation.`,
      }],
      0.3,
    );

    logUsage(rewriteResult.usage, 'relationship_safety_rewrite', userId);

    return {
      text: rewriteResult.text.trim(),
      rewritten: true,
      violations: parsed.violations,
    };
  } catch (err) {
    console.error('[relationship-safety] Rewrite failed:', err);
    return { text: response, rewritten: false, violations: [] };
  }
}
