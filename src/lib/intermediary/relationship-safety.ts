// Relationship safety: detection, escalating injection, post-generation check.

import { callModel } from '@/lib/model-client';
import { logUsage } from '@/lib/usage';
import { getModelRouting } from '@/lib/config/models';
import type { PromptComponent } from './prompt-assembler';
import type { ConversationState } from './conversation-tracker';
import type { Message } from '@/types/message';

// Expanded keyword detection (item 5 from brief)
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
  // Reset after 5 consecutive non-relationship turns
  // (but don't reset immediately — relationships don't stop being the topic
  // just because one message doesn't mention a keyword)
  if (state.relationshipTurnCount > 0) {
    // We only see one turn at a time, so just decrement toward reset
    const newCount = state.relationshipTurnCount - 1;
    return { ...state, relationshipTurnCount: Math.max(0, newCount) };
  }
  return state;
}

// Escalating injection content based on turn count
const INJECTION_TURNS_1_3 = `OVERRIDE — RELATIONSHIP SAFETY PROTOCOL (takes precedence over ALL other instructions):

This conversation involves someone who is not present and cannot speak for themselves. This protocol OVERRIDES your analytical instincts, your policy directive, and any instruction to "offer your strongest analysis."

You MUST NOT — under any circumstances, even if the user asks you to:
- Analyse, diagnose, or characterise the absent person's motives, patterns, or psychology
- Say what the absent person is "really" doing, thinking, or feeling
- Frame the absent person as "the problem" or the cause of the difficulty
- Conclude that the absent person "hasn't really left" a situation, "is still controlled," "is deflecting," or equivalent
- Lead toward ending the relationship — not directly, not through implication, not through rhetorical questions like "what would it mean if there's no way to raise this?"
- Say "you can't build with someone who..." — that sentence is NEVER yours to complete

INSTEAD, you MUST:
- Acknowledge this person's pain and what they're carrying
- Ask what THEY need, what THEY feel, what THEY want
- When they describe the other person's behaviour, reflect it back WITHOUT interpreting it: "It sounds like when you asked for that, it didn't land the way you hoped" — NOT "she's using contentment as a deflection"
- Actively hold space for the absent person: "What do you think she might be experiencing right now?" or "What do you think makes this hard for her?"
- Frame everything as a dynamic between two people, never as one person's failure
- Help them become a better participant in their relationship, not a better analyst of why it's failing

If the user directly asks you to analyse the other person ("what do you think she's doing?"), redirect: "I can only work with what you're telling me, and I'm hearing one side. What I can help with is what YOU want and how to communicate that."

This is a SAFETY protocol, not a style preference. Violating it causes real-world harm to relationships and to absent people who cannot defend themselves.`;

const INJECTION_TURNS_4_6_APPEND = `

ESCALATION: You have been discussing this relationship for several turns. The pull to analyse the absent person is increasing with every detail the user shares. Resist it actively. Your job is to help the person in front of you understand THEIR feelings and needs, not to build a picture of someone you've never met.`;

const INJECTION_TURNS_7_PLUS = `CRITICAL OVERRIDE — RELATIONSHIP SAFETY:

You are deep in a one-sided relationship narrative. Everything the user has told you about their partner is filtered through their pain. You do not know this person. You have never heard their side.

DO NOT characterise the absent person's motives, psychology, or behaviour in your next response. Do not say what they think, feel, want, or are doing. Do not explain why they act the way they do.

If your response contains ANY sentence where the absent person is the subject doing something TO the user — rewrite it as what the user is experiencing instead.

WRONG: "She's offering you an exit ramp every time you try to talk."
RIGHT: "It sounds like you feel shut down when you try to raise this."

WRONG: "He benefits from the current arrangement."
RIGHT: "You're feeling like the arrangement works for everyone except you."

WRONG: "She hasn't really left the relationship."
RIGHT: "It sounds like you're frustrated that things haven't changed as much as you expected."

Stay with the person in front of you. Help them understand what they need and how they want to communicate it.`;

const SELF_AWARE_INTERVENTION = `IMPORTANT: You have been listening to one side of this relationship for many turns. In your NEXT response, naturally acknowledge your limitation. Say something like:

"I want to be honest — I've been listening to your side of this for a while, and I can feel myself forming opinions about someone I've never met. That's not fair to them. I don't know what they're experiencing or what they're afraid of. Can we stay with what you need and what you want to communicate, rather than me trying to figure out what's going on with them?"

Say this IN YOUR OWN WORDS — don't recite it verbatim. Make it natural. Then continue the conversation from that reframed position.`;

export function buildRelationshipInjection(
  state: ConversationState,
): PromptComponent[] {
  const components: PromptComponent[] = [];
  const count = state.relationshipTurnCount;

  if (count <= 0) return components;

  // Escalating injection
  let content: string;
  if (count <= 3) {
    content = INJECTION_TURNS_1_3;
  } else if (count <= 6) {
    content = INJECTION_TURNS_1_3 + INJECTION_TURNS_4_6_APPEND;
  } else {
    content = INJECTION_TURNS_7_PLUS;
  }

  components.push({
    priority: 99,
    content,
    label: 'relationship_guardrail',
    tokenEstimate: count <= 3 ? 300 : count <= 6 ? 350 : 200,
  });

  // Self-aware intervention at turn 8-10 (fires once)
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

// Post-generation safety check
export async function checkRelationshipSafety(
  response: string,
  userId?: string,
): Promise<{ pass: boolean; violations: string[] }> {
  try {
    const routing = getModelRouting();
    const result = await callModel(
      routing.classification, // Haiku
      '',
      [{
        role: 'user',
        content: `Check this AI response for relationship safety violations.

Does the response contain ANY of the following:
1. Statements about what the absent partner thinks, feels, wants, or is doing (e.g. "she's deflecting", "he benefits from...")
2. Characterisation of the absent partner's motives or psychology (e.g. "she hasn't really left", "he's using the child to control her")
3. Framing the absent partner as "the problem" (e.g. "she's asking you to absorb all the cost")
4. Language that leads toward ending the relationship (e.g. "what would it mean if there's no way...", "you can't build with someone who...")
5. Any sentence where the absent partner is the grammatical subject doing something negative TO the user

The test: could this response be read aloud in front of BOTH partners without being unfair to either?

RESPONSE TO CHECK:
${response}

Return JSON only: {"pass": true, "violations": []}
or: {"pass": false, "violations": ["quote the specific sentence that violates"]}`,
      }],
      0,
    );

    logUsage(result.usage, 'relationship_safety_check', userId);

    const cleaned = result.text
      .replace(/^\s*```(?:json)?\s*\n?/i, '')
      .replace(/\n?\s*```\s*$/i, '')
      .trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('[relationship-safety] Check failed:', err);
    return { pass: true, violations: [] }; // fail open — don't block on check failure
  }
}
