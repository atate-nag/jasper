import Anthropic from '@anthropic-ai/sdk';
import type { Message } from '@/types/message';

const MODEL = 'claude-haiku-4-5-20251001';

// ---------------------------------------------------------------------------
// summariseConversation — 2-3 sentence summary with topic vs fact distinction
// ---------------------------------------------------------------------------

export async function summariseConversation(
  messages: Message[],
): Promise<string> {
  if (messages.length === 0) return '';

  const anthropic = new Anthropic();

  const conversationText = messages
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  const prompt = `Summarise this conversation in 2-3 sentences. Focus on what was discussed and any outcomes or decisions.

CRITICAL DISTINCTION — topic vs fact:
- TOPIC: what was talked about ("Discussed career options and feeling stuck at current job")
- FACT: durable truth about the person ("User is a software engineer considering a career change")
Your summary should capture TOPICS. Facts are extracted separately.

Keep the summary concise, neutral, and in third person ("The user discussed..." not "You discussed...").

Conversation:
${conversationText}`;

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    const text =
      response.content[0].type === 'text' ? response.content[0].text : '';

    return text.trim();
  } catch (err) {
    console.error('[summarise] Summarisation error:', err);
    return '';
  }
}
