// Shared post-response actions for both web chat and voice routes.
// Handles: conversation persistence, turn logging, profile classification, memory extraction.

import { getSupabaseAdmin } from '@/lib/supabase';
import { classifyConversation } from '@/lib/backbone/classify';
import { mergeProfileUpdates } from '@/lib/backbone/profile';
import type { Message } from '@/types/message';
import type { steer } from '@/lib/intermediary';
import { createHash } from 'crypto';

// Per-user conversation tracking (in-memory, server-side)
const activeConversations = new Map<string, string>();

export async function getOrCreateConversation(userId: string): Promise<string | null> {
  const existing = activeConversations.get(userId);
  if (existing) return existing;

  try {
    const { data, error } = await getSupabaseAdmin()
      .from('conversations')
      .insert({
        user_id: userId,
        started_at: new Date().toISOString(),
        messages: [],
        exchange_count: 0,
      })
      .select('id')
      .single();

    if (error || !data) {
      console.error('[post-response] Failed to create conversation:', error?.message);
      return null;
    }

    activeConversations.set(userId, data.id);
    return data.id;
  } catch {
    return null;
  }
}

export async function handlePostResponse(
  userId: string,
  conversationId: string | null,
  sessionHistory: Message[],
  userMessage: string,
  assistantResponse: string,
  steering: Awaited<ReturnType<typeof steer>>,
  responseLatencyMs: number,
): Promise<void> {
  const turnNumber = sessionHistory.filter(m => m.role === 'user').length;

  // 1. Persist conversation messages
  if (conversationId) {
    const allMessages: Message[] = [
      ...sessionHistory,
      { role: 'assistant', content: assistantResponse, timestamp: new Date().toISOString() },
    ];
    try {
      const exchangeCount = allMessages.filter(m => m.role === 'user').length;
      await getSupabaseAdmin()
        .from('conversations')
        .update({ messages: allMessages, exchange_count: exchangeCount })
        .eq('id', conversationId);
    } catch (err) {
      console.error('[post-response] Failed to persist messages:', err);
    }
  }

  // 2. Log turn
  try {
    await getSupabaseAdmin().from('turn_logs').insert({
      user_id: userId,
      conversation_id: conversationId,
      turn_number: turnNumber,
      user_message: userMessage,
      response_directive: steering.responseDirective,
      selected_policy_id: steering.selectedPolicy.id,
      exploration_flag: false,
      system_prompt_hash: createHash('sha256').update(steering.systemPrompt).digest('hex').slice(0, 16),
      reformulated_message: steering.reformulatedMessage,
      model_config: steering.modelConfig,
      assistant_response: assistantResponse,
      response_latency_ms: responseLatencyMs,
    });
  } catch (err) {
    console.error('[post-response] Turn log failed:', err);
  }

  // 3. Classify profile (async, non-blocking)
  if (steering.postResponseActions.classifyProfile) {
    const allMessages: Message[] = [
      ...sessionHistory,
      { role: 'assistant', content: assistantResponse, timestamp: new Date().toISOString() },
    ];
    classifyConversation(allMessages).then(async (result) => {
      if (result.profileUpdates && Object.keys(result.profileUpdates).length > 0) {
        await mergeProfileUpdates(userId, result.profileUpdates).catch(console.error);
      }
    }).catch(console.error);
  }

  // 4. Extract memories (async, non-blocking)
  if (steering.postResponseActions.extractMemories) {
    import('@/lib/backbone/memory').then(({ addToMemory }) => {
      addToMemory(userId, [
        { role: 'user', content: userMessage },
        { role: 'assistant', content: assistantResponse },
      ]).catch(console.error);
    }).catch(console.error);
  }
}
