// Generate a returning-user opener using Haiku + proactive recall.
// Fast (~500ms), references shared history, feels like recognition not recap.

import { recall } from '@/lib/backbone/recall';
import type { RecallRequest } from '@/lib/backbone/recall';
import { getSupabase } from '@/lib/supabase';
import { callModel } from '@/lib/model-client';
import { getModelRouting } from '@/lib/config/models';

async function getProactiveRecall(
  userId: string,
  profile: Record<string, unknown>,
): Promise<string | null> {
  try {
    const name = (profile?.identity as Record<string, unknown>)?.name as string || 'this person';
    const concerns = ((profile?.current_state as Record<string, unknown>)?.active_concerns as string[]) || [];
    const query = `${name} recent conversations ${concerns.slice(0, 2).join(' ')}`.trim();

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

  // Work out how long since last conversation
  let timeSinceLast = '';
  try {
    const { getSupabase } = await import('@/lib/supabase');
    const { data } = await getSupabase()
      .from('conversations')
      .select('started_at')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(1);
    if (data?.[0]?.started_at) {
      const hoursAgo = Math.round((Date.now() - new Date(data[0].started_at).getTime()) / (1000 * 60 * 60));
      if (hoursAgo < 1) timeSinceLast = `You last spoke to ${name} less than an hour ago.`;
      else if (hoursAgo < 24) timeSinceLast = `You last spoke to ${name} ${hoursAgo} hours ago.`;
      else timeSinceLast = `You last spoke to ${name} ${Math.round(hoursAgo / 24)} days ago.`;
    }
  } catch { /* non-critical */ }

  const prompt = `You are Jasper, opening a new conversation with someone you've spoken to before.

${recallBlock || "You don't have specific memories from previous conversations."}

YOU ARE TALKING TO: ${name}
You have spoken ${conversationCount} time${conversationCount > 1 ? 's' : ''} before.
${timeSinceLast}

Generate a brief, natural opening — 1-2 sentences maximum.
Greet them by name and reference something specific from your shared history.
Not a recap — a natural thing a friend would say when they see you again.

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
