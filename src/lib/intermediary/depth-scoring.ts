import type { Message } from '@/types/message';
import { callModel } from '@/lib/model-client';
import { getModelRouting } from '@/lib/config/models';

const DEPTH_SCORING_PROMPT = `You are evaluating a conversational message for latent depth.
Your job is not to respond to the message. Your job is to
identify whether there is a thread worth pulling — a genuine
observation, connection, or question that a curious person
would find it costly to leave unasked.

Scan on two dimensions:

UNEXPECTED CONNECTION: Does something here link to something
else in a way that wasn't obvious? Specificity doing work,
an implicit contrast, something that doesn't fit the surface
register.

PRODUCTIVE TENSION: Does something here resist easy resolution?
An unresolved contradiction, two things pulling against each
other that the person hasn't named, something that would
change the available moves if surfaced.

Either dimension alone may be interesting. Both firing
simultaneously is rare and should score highest.

The load-bearing test: would surfacing this thread change what
happens next in the conversation? If the conversation would
arrive at the same place regardless, the thread is decorative,
not load-bearing. Score accordingly.

Score the message from 1 to 10 using the following rubric:

Score 1: "Just got back from the supermarket."
— Pure phatic content. No connection, no tension. Nothing offscreen.

Score 5: "Just got back from the supermarket. They've stopped
stocking the one thing my son will actually eat."
— Specificity and implicit tension present. Something offscreen.
But surfacing it wouldn't change the available moves.

Score 10: "Just got back from the supermarket. Ran into my dad
for the first time in three years. He was buying the same
cereal he always bought."
— Unexpected connection AND productive tension. Silence would
cost something. Surfacing this changes what happens next.

CONVERSATION SO FAR:
{conversation_history}

MESSAGE TO EVALUATE:
{user_message}

Return a JSON object with exactly three fields:
- "score": integer 1-10
- "thread": one sentence naming what's there, or null if score is low
- "dimension": "connection" or "tension" or "both" or null

Return raw JSON only. No markdown, no backticks, no commentary.`;

export interface DepthScore {
  score: number;
  thread: string | null;
  dimension: 'connection' | 'tension' | 'both' | null;
}

export async function scoreDepth(
  userMessage: string,
  sessionHistory: Message[],
  profile?: Record<string, unknown> | null,
): Promise<DepthScore | null> {
  // Full conversation context — no truncation
  const historyText = sessionHistory
    .map((m, i) => `[turn ${i}] [${m.role}]: ${m.content}`)
    .join('\n');

  // Add profile context if available
  let profileContext = '';
  if (profile) {
    const parts: string[] = [];
    const identity = profile.identity as Record<string, unknown> | undefined;
    if (identity?.name) parts.push(`Person: ${identity.name}`);
    const concerns = (profile.current_state as Record<string, unknown>)?.active_concerns;
    if (Array.isArray(concerns) && concerns.length > 0) parts.push(`On their mind: ${concerns.slice(0, 3).join('; ')}`);
    const patterns = profile.patterns as Record<string, unknown> | undefined;
    if (patterns?.growth_edges && Array.isArray(patterns.growth_edges)) parts.push(`Growth edges: ${patterns.growth_edges.slice(0, 3).join('; ')}`);
    if (parts.length > 0) profileContext = `\nPERSON CONTEXT:\n${parts.join('\n')}\n`;
  }

  const prompt = DEPTH_SCORING_PROMPT
    .replace('{conversation_history}', historyText + profileContext)
    .replace('{user_message}', userMessage);

  const contextTokens = Math.ceil(prompt.split(/\s+/).length * 1.3);

  try {
    console.log(`[depth-scoring] Calling Opus | context: ~${contextTokens} tokens | ${sessionHistory.length} turns`);
    const routing = getModelRouting();
    const text = await callModel(
      routing.depthScoring,
      '',
      [{ role: 'user', content: prompt }],
    );

    console.log('[depth-scoring] Raw output:', text.slice(0, 200));

    const cleaned = text
      .replace(/^\s*```(?:json)?\s*\n?/i, '')
      .replace(/\n?\s*```\s*$/i, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    console.log('[depth-scoring] Parsed:', JSON.stringify(parsed));

    return {
      score: typeof parsed.score === 'number' ? parsed.score : 0,
      thread: parsed.thread || null,
      dimension: parsed.dimension || null,
    };
  } catch (err) {
    console.error('[depth-scoring] Failed:', err);
    return null;
  }
}
