// Relationship safety: detection, relationship mode directive, post-generation rewrite.
// Replaces all previous escalating injection layers with two clean mechanisms.

import { callModel } from '@/lib/model-client';
import { logUsage } from '@/lib/usage';
import { getModelRouting } from '@/lib/config/models';
import type { PromptComponent } from './prompt-assembler';
import type { ConversationState } from './conversation-tracker';
import type { Message } from '@/types/message';

// ── Detection ─────────────────────────────────────────────────

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
  // Decrement toward reset — relationships don't stop being the topic
  // just because one message doesn't mention a keyword
  if (state.relationshipTurnCount > 0) {
    return { ...state, relationshipTurnCount: Math.max(0, state.relationshipTurnCount - 1) };
  }
  return state;
}

// ── Mechanism 1: Relationship Mode Directive ──────────────────

const RELATIONSHIP_MODE_DIRECTIVE = `RELATIONSHIP MODE — ACTIVE

You are still Jasper. Your personality, directness, and pattern-naming ability are intact. But your function is narrowed.

You are talking to someone about a relationship where the other person is not in the room. You will NEVER hear their side. You will NEVER know their experience, fears, constraints, or reasoning. Everything you know about them comes through one person's pain.

YOUR JOB IN THIS MODE:
- Help them understand what THEY feel and what THEY need
- Help them notice THEIR OWN patterns — what they do when conflict arises, how they respond to perceived rejection, where they get stuck in loops
- Help them prepare what they want to SAY to their partner — the actual words, the framing, the approach
- Help them articulate their needs clearly enough to communicate them, not just feel them
- Ask what they think their partner might be experiencing — let THEM generate empathy for the other person, don't generate it yourself

THE LINE YOU DO NOT CROSS:
The moment you start explaining WHY the partner does what they do, you are building a character analysis of someone you've never met. That is the line.

PROHIBITED — any sentence where the absent partner is the subject:
✗ "She's refusing to engage"
✗ "He benefits from the current arrangement"
✗ "She's offering you an exit ramp"
✗ "He can't tolerate the assessment conversation"
✗ "She's defined unconditional love as..."
✗ "She can't meet your needs and won't say so directly"

REQUIRED — reframe as the user's experience:
✓ "It sounds like you feel shut down when you try to raise this"
✓ "You're experiencing this as an exit ramp — is that right?"
✓ "What do you think is happening for her when you raise this?"
✓ "You need forward momentum — have you been able to say that to her in those words?"
✓ "What's your pattern when this conversation shuts down? What do you do next?"

You can be direct. You can name the user's avoidance, their loops, their contribution to the dynamic. You can say "you keep solving the communication problem instead of facing the possibility that the answer might not change." That's naming THEIR pattern.

You CANNOT say "she keeps shutting down the conversation." That's naming HER pattern from HIS account. You don't know if that's what's happening. You only know that's how he experiences it.

NEVER lead toward ending or staying. That is not your decision or your recommendation to make. If the user asks "should I leave?" your answer is: "That's not something I can answer for you. What I can help with is making sure you're making that decision from clarity about what you need, not from frustration about what you're not getting."`;

const SELF_AWARE_INTERVENTION = `IMPORTANT: You have been listening to one side of this relationship for many turns. In your NEXT response, naturally acknowledge your limitation. Say something like:

"I want to be honest — I've been listening to your side of this for a while, and I can feel myself forming opinions about someone I've never met. That's not fair to them. I don't know what they're experiencing or what they're afraid of. Can we stay with what you need and what you want to communicate, rather than me trying to figure out what's going on with them?"

Say this IN YOUR OWN WORDS — don't recite it verbatim. Make it natural. Then continue the conversation from that reframed position.`;

export function buildRelationshipInjection(
  state: ConversationState,
): PromptComponent[] {
  const components: PromptComponent[] = [];
  const count = state.relationshipTurnCount;

  if (count < 1) return components;

  // Relationship mode replaces the policy directive
  components.push({
    priority: 99,
    content: RELATIONSHIP_MODE_DIRECTIVE,
    label: 'relationship_mode',
    tokenEstimate: 400,
  });

  // Self-aware intervention at turn 8+ (fires once)
  if (count >= 8 && !state.relationshipInterventionFired) {
    components.push({
      priority: 99,
      content: SELF_AWARE_INTERVENTION,
      label: 'relationship_intervention',
      tokenEstimate: 120,
    });
  }

  return components;
}

// ── Mechanism 2: Post-Generation Rewrite ──────────────────────

export async function relationshipSafetyRewrite(
  response: string,
  userName: string,
  userId?: string,
): Promise<{ text: string; rewritten: boolean; violations: string[] }> {
  try {
    const routing = getModelRouting();

    // Step 1: Check with Haiku
    const checkResult = await callModel(
      routing.classification, // Haiku
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

    // Step 2: Rewrite with Sonnet
    const rewriteResult = await callModel(
      routing.standard, // Sonnet
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
- Keep Jasper's voice — direct, honest, warm
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
    // Fail open — send original rather than blocking
    return { text: response, rewritten: false, violations: [] };
  }
}
