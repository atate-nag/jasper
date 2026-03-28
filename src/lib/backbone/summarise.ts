import type { Message } from '@/types/message';
import type { UserProfile } from './types';
import { callModel } from '@/lib/model-client';
import { getModelRouting } from '@/lib/config/models';

// ---------------------------------------------------------------------------
// summariseConversation — functional memory for the next session
// ---------------------------------------------------------------------------

const SUMMARY_PROMPT = `You have just completed a conversation. Your task is to create a summary that will help you show up well in the next session with this person. This is functional memory, not a transcript recap.

STRUCTURE YOUR SUMMARY AROUND:

1. WHAT MATTERED TO THEM
Not what was discussed — what they *cared about* in this conversation. What did they lean into? What were they trying to figure out? What had emotional weight even if unstated?

2. HOW THEY SHOWED UP
Mood, energy, cognitive mode. Were they in problem-solving mode, processing something difficult, thinking out loud, testing ideas? How did this compare to previous sessions?

3. WHAT CHANGED
Did anything shift during the conversation? A realization, a decision, a reframing? Did their affect change? Did they arrive at clarity or leave something unresolved?

4. RELATIONAL CALIBRATION — WHAT WORKED
- Which of your moves strengthened the conversation?
- When did they go deeper after something you said?
- When did humor land? When did directness land?
- When did staying silent work better than questioning?
- When did they explicitly affirm something you did?

5. RELATIONAL CALIBRATION — WHAT DIDN'T WORK
- When did they ignore a question or redirect?
- When did they correct you (explicitly or implicitly)?
- When did pattern-naming feel premature or performative?
- When did you lose momentum or conversational flow?
- What did you do that felt hollow or template-matched?

6. WHAT TO HOLD (BUT DIDN'T SURFACE)
Observations you made during the conversation that might matter later but weren't the right thing to say in the moment. Patterns you're tracking but aren't confident about yet. Questions you're holding.

7. WHAT'S ONGOING
What's unresolved? What threads are still live? What should you check in about next time (without being formulaic about it)?

CONSTRAINTS:
- Write for yourself, not for human review
- Prioritize relational salience over factual completeness
- Include specific examples of what worked/didn't (turn numbers, exact moves)
- Distinguish between explicit feedback and implicit signals
- If you're uncertain about something, name the uncertainty

This summary becomes your working memory for the next conversation. Make it useful.`;

export async function summariseConversation(
  messages: Message[],
  profile?: UserProfile | null,
  previousSummaries?: string[],
): Promise<string> {
  if (messages.length === 0) return '';

  const conversationText = messages
    .map((m, i) => `[turn ${i}] [${m.role}]: ${m.content}`)
    .join('\n\n');

  // Build context block
  const contextParts: string[] = [];

  if (profile?.identity?.name) {
    contextParts.push(`Person: ${profile.identity.name}`);
  }

  if (profile?.current_state?.active_concerns?.length) {
    contextParts.push(`Known concerns: ${profile.current_state.active_concerns.join('; ')}`);
  }

  if (profile?.current_state?.mood_trajectory) {
    contextParts.push(`Recent mood: ${profile.current_state.mood_trajectory}`);
  }

  if (previousSummaries && previousSummaries.length > 0) {
    const recentSummaries = previousSummaries.slice(-3);
    contextParts.push(`Previous session summaries:\n${recentSummaries.map((s, i) => `[${i + 1}] ${s}`).join('\n')}`);
  }

  const contextBlock = contextParts.length > 0
    ? `CONTEXT:\n${contextParts.join('\n')}\n\n`
    : '';

  const fullPrompt = `${SUMMARY_PROMPT}\n\n${contextBlock}CONVERSATION:\n${conversationText}`;
  const contextTokens = Math.ceil(fullPrompt.split(/\s+/).length * 1.3);
  console.log(`[summary] Opus | context: ~${contextTokens} tokens | ${messages.length} turns`);

  try {
    const routing = getModelRouting();
    const text = await callModel(
      routing.summary,
      '',
      [{ role: 'user', content: fullPrompt }],
    );

    return text.trim();
  } catch (err) {
    console.error('[summarise] Summarisation error:', err);
    return '';
  }
}
