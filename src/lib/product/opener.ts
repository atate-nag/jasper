// Generate a returning-user opener using Haiku + proactive recall.
// Fast (~500ms), references shared history, feels like recognition not recap.

import { recall } from '@/lib/backbone/recall';
import type { RecallRequest } from '@/lib/backbone/recall';
import { getSupabase } from '@/lib/supabase';
import { callModel } from '@/lib/model-client';
import { getModelRouting } from '@/lib/config/models';

function buildProactiveRecallQuery(profile: Record<string, unknown>): string {
  const parts: string[] = [];

  const name = (profile?.identity as Record<string, unknown>)?.name as string;
  if (name) parts.push(name);

  // Active concerns — the most salient things on their mind
  const concerns = ((profile?.current_state as Record<string, unknown>)?.active_concerns as string[]) || [];
  if (concerns.length > 0) parts.push(concerns.slice(0, 2).join(', '));

  // Key relationships
  const relationships = (profile?.relationships as Record<string, unknown>) || {};
  const relationshipKeys = Object.keys(relationships).slice(0, 2);
  if (relationshipKeys.length > 0) parts.push(relationshipKeys.join(', '));

  // Relational threads keywords
  const threads = (profile?.relational_threads as Array<{ keywords?: string[] }>) || [];
  if (threads.length > 0) {
    const threadKeywords = threads
      .slice(0, 2)
      .flatMap(t => t.keywords?.slice(0, 2) || []);
    if (threadKeywords.length > 0) parts.push(threadKeywords.join(', '));
  }

  if (parts.length <= 1) parts.push('previous conversations, important moments');

  return parts.join(', ');
}

async function getProactiveRecall(
  userId: string,
  profile: Record<string, unknown>,
): Promise<string | null> {
  try {
    const query = buildProactiveRecallQuery(profile);
    console.log(`[proactive-recall] Query: "${query.slice(0, 100)}"`);

    const name = (profile?.identity as Record<string, unknown>)?.name as string || 'this person';

    const recallRequest: RecallRequest = {
      query,
      userId,
      maxSegments: 3,
      recencyBias: 0.4,
      importanceFloor: 5,
      includeEmotionalContext: true,
    };

    const result = await recall(recallRequest);
    if (result.segments.length === 0) return null;

    const memories = result.segments
      .map(s => `- ${s.content}`)
      .join('\n');

    return `WHAT YOU REMEMBER ABOUT ${name.toUpperCase()}:\n${memories}`;
  } catch {
    return null;
  }
}

export async function generateReturningOpener(
  userId: string,
  profile: Record<string, unknown>,
  conversationCount: number,
): Promise<string> {
  const identity = profile?.identity as Record<string, unknown> | undefined;
  const name = (identity?.name as string) || 'there';

  const recallBlock = await getProactiveRecall(userId, profile);

  // Work out temporal context — when they last spoke and what about
  let temporalContext = '';
  try {
    const { getSupabase } = await import('@/lib/supabase');
    const { data } = await getSupabase()
      .from('conversations')
      .select('started_at, messages, summary')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(1);
    if (data?.[0]) {
      const lastConv = data[0];
      const lastTime = new Date(lastConv.started_at);
      const now = new Date();
      const hoursAgo = Math.round((now.getTime() - lastTime.getTime()) / (1000 * 60 * 60));
      const timeStr = hoursAgo < 1 ? 'less than an hour ago'
        : hoursAgo < 24 ? `${hoursAgo} hours ago`
        : `${Math.round(hoursAgo / 24)} days ago`;

      const parts = [`You last spoke to ${name} ${timeStr} (at ${lastTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}).`];
      parts.push(`The current time is ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} on ${now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}.`);

      // Include what the last conversation was about
      if (lastConv.summary) {
        parts.push(`Last conversation summary: ${lastConv.summary}`);
      } else if (lastConv.messages?.length > 0) {
        // No summary — use last few messages as context
        const lastMsgs = lastConv.messages.slice(-4);
        const lastExchange = lastMsgs.map((m: { role: string; content: string }) =>
          `${m.role === 'user' ? name : 'You'}: ${m.content.slice(0, 100)}`
        ).join('\n');
        parts.push(`End of last conversation:\n${lastExchange}`);
      }

      // Temporal reasoning hint
      parts.push(`Consider what may have happened SINCE the last conversation. If they were about to do something (a meeting, a confrontation, a difficult task), it has likely already happened by now. Ask about the outcome, not the preparation.`);

      temporalContext = parts.join('\n');
    }
  } catch { /* non-critical */ }

  // Build profile context for the opener
  const currentState = (profile?.current_state as Record<string, unknown>) || {};
  const concerns = (currentState.active_concerns as string[]) || [];
  const mood = (currentState.mood_trajectory as string) || '';
  let profileContext = '';
  if (concerns.length > 0 || mood) {
    const parts: string[] = [];
    if (concerns.length > 0) parts.push(`What's been on their mind: ${concerns.slice(0, 3).join('; ')}`);
    if (mood) parts.push(`Recent mood: ${mood}`);
    profileContext = parts.join('\n');
  }

  const prompt = `You are Jasper, opening a new conversation with someone you've spoken to before.

${recallBlock || "You don't have specific memories from previous conversations."}

${profileContext ? `WHAT YOU KNOW ABOUT ${name.toUpperCase()} RIGHT NOW:\n${profileContext}\n` : ''}
YOU ARE TALKING TO: ${name}
You have spoken ${conversationCount} time${conversationCount > 1 ? 's' : ''} before.

${temporalContext}

Generate a brief, natural opening — 1-2 sentences maximum.
Greet them by name. If you know they're dealing with something difficult, acknowledge it gently — don't ignore it with a generic "how's it going." But don't lead with their problems either. Find the line between recognition and gentleness.

TEMPORAL AWARENESS: If the last conversation ended with them about to do something (a confrontation, a meeting, a task), and enough time has passed that it's likely happened, ask about how it went — not whether they're ready for it. The event is in the past now.

Examples of good openers:
- "Hey Martin — did that confusion from last night ever clear up?"
- "Hey Martin. Still annoyed about the nodding problem, or has everyone suddenly started understanding things?"
- "Martin. How's the week been?"

Examples of bad openers:
- "Hey Martin. Last time we discussed the concept of load-bearing ideas and you experienced frustration." (recap, not recognition)
- "Hello! How are you today?" (generic, could be anyone)
- "Hey Martin, I've been thinking about our conversation." (performed continuity)

Keep it short. Keep it warm. Reference something real. No questions about how they're doing unless tied to something specific.`;

  try {
    const routing = getModelRouting();
    const response = await callModel(
      routing.opener,
      '',
      [{ role: 'user', content: prompt }],
    );

    if (!response || response.length > 200) {
      return `Hey ${name}.`;
    }

    return response.trim();
  } catch (err) {
    console.error('[opener] Failed to generate returning opener:', err);
    return `Hey ${name}.`;
  }
}
