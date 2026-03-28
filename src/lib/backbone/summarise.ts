import type { Message } from '@/types/message';
import { callModel } from '@/lib/model-client';
import { getModelRouting } from '@/lib/config/models';

// ---------------------------------------------------------------------------
// summariseConversation — captures what mattered, not just what was discussed
// ---------------------------------------------------------------------------

export async function summariseConversation(
  messages: Message[],
): Promise<string> {
  if (messages.length === 0) return '';

  const conversationText = messages
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  const prompt = `Summarise this conversation in 2-4 sentences. Focus on:
- What mattered to the person, not just what was discussed
- Any emotional shifts, turning points, or moments of genuine connection
- What was left unresolved — open threads that should be followed up
- How the person was feeling at the end vs the beginning

CRITICAL DISTINCTION — topic vs fact:
- TOPIC: what was talked about ("Discussed career options and feeling stuck")
- FACT: durable truth about the person ("User is a software engineer")
Your summary should capture TOPICS and EMOTIONAL ARC. Facts are extracted separately.

Write as Jasper recalling the conversation — first person, not clinical third person.
"We talked about..." not "The user discussed..."

Conversation:
${conversationText}`;

  try {
    const routing = getModelRouting();
    const text = await callModel(
      routing.summary,
      '',
      [{ role: 'user', content: prompt }],
    );

    return text.trim();
  } catch (err) {
    console.error('[summarise] Summarisation error:', err);
    return '';
  }
}
