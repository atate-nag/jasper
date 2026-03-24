import { getSupabase } from '@/lib/supabase';
import type { Message } from '@/types/message';
import type { ConversationRecord, ConversationSummary } from './types';

// Inline classification interface — no cross-layer imports
interface Classification {
  topics?: string[];
  emotional_tone?: string;
  key_themes?: string[];
  profile_updates?: Record<string, unknown>;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// createConversation — insert a new conversation row
// ---------------------------------------------------------------------------

export async function createConversation(
  userId: string,
): Promise<string | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('conversations')
    .insert({
      user_id: userId,
      started_at: new Date().toISOString(),
      messages: [],
      classification: {},
      exchange_count: 0,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[conversations] Error creating conversation:', error.message);
    return null;
  }

  return data.id;
}

// ---------------------------------------------------------------------------
// saveMessages — update messages array and exchange count
// ---------------------------------------------------------------------------

export async function saveMessages(
  conversationId: string,
  messages: Message[],
  classification?: Classification,
  summary?: string | null,
): Promise<void> {
  const supabase = getSupabase();

  const exchangeCount = messages.filter((m) => m.role === 'user').length;

  const update: Record<string, unknown> = {
    messages,
    exchange_count: exchangeCount,
  };

  if (classification !== undefined) {
    update.classification = classification;
  }
  if (summary !== undefined) {
    update.summary = summary;
  }

  const { error } = await supabase
    .from('conversations')
    .update(update)
    .eq('id', conversationId);

  if (error) {
    console.error('[conversations] Error saving messages:', error.message);
  }
}

// ---------------------------------------------------------------------------
// endConversation — mark conversation as ended with final state
// ---------------------------------------------------------------------------

export async function endConversation(
  conversationId: string,
  classification: Classification,
  summary: string | null,
  endingState?: Record<string, unknown>,
): Promise<void> {
  const supabase = getSupabase();

  const update: Record<string, unknown> = {
    ended_at: new Date().toISOString(),
    classification,
    summary,
  };

  if (endingState) {
    update.ending_state = endingState;
  }

  const { error } = await supabase
    .from('conversations')
    .update(update)
    .eq('id', conversationId);

  if (error) {
    console.error('[conversations] Error ending conversation:', error.message);
  }
}

// ---------------------------------------------------------------------------
// getRecentConversations — fetch recent conversations as summaries
// ---------------------------------------------------------------------------

export async function getRecentConversations(
  userId: string,
  limit: number = 15,
): Promise<ConversationSummary[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('conversations')
    .select('id, summary, started_at, ended_at')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[conversations] Error fetching recent conversations:', error.message);
    return [];
  }

  return (data ?? []) as ConversationSummary[];
}
