// LAYER A: Backbone — Person Model
// This layer MUST NOT import from intermediary/ or product/

export { getProfile, upsertProfile, mergeProfileUpdates, removeResolvedConcerns, patchProfileField, buildClassifierSummary, compressProfile } from './profile';
// Memory exports are dynamic — mem0ai has many optional peer deps that break Next.js bundling.
// Use: const { addToMemory } = await import('@/lib/backbone/memory');
export async function getMemoryModule(): Promise<typeof import('./memory')> {
  return import('./memory');
}
export { createConversation, saveMessages, endConversation, getRecentConversations } from './conversations';
export { classifyConversation, dedupCandidates } from './classify';
export { summariseConversation } from './summarise';
export { recallConversation, extractSegments, recall } from './recall';
export type { SegmentExtraction, RecallRequest, RecallResult, RecalledSegment } from './recall';
export type { UserProfile, UserProfileUpdate, PersonContext, Memory, ConversationSummary, ConversationRecord, ConversationSegment, RelationshipMeta } from './types';

import { getProfile } from './profile';
// searchMemories is dynamically imported to avoid mem0ai bundling issues
import { getRecentConversations } from './conversations';
import { recallConversation } from './recall';
import type { PersonContext } from './types';
import type { Message } from '@/types/message';

function bareProfile(userId: string) {
  return {
    id: '', user_id: userId,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    identity: {}, values: {}, patterns: {}, relationships: {},
    current_state: {}, interaction_prefs: {},
  };
}

export async function getPersonContext(
  userId: string,
  currentMessage: string,
  sessionMessages: Message[] = [],
  recallQuery?: string,
): Promise<PersonContext> {
  // 1. Load profile
  const profile = await getProfile(userId) ?? bareProfile(userId);

  // 2. Search Mem0 for relevant memories (gated by relevance threshold)
  const isTrivial = currentMessage.split(/\s+/).length < 5 && /^(hi|hey|hello|bye|later|thanks|cheers)\b/i.test(currentMessage.trim());
  let memories: { memory: string; score?: number }[] = [];
  if (!isTrivial) {
    try {
      const { searchMemories } = await import('./memory');
      memories = await searchMemories(userId, currentMessage);
    } catch { /* mem0 unavailable */ }
  }

  // 3. Load recent conversation summaries
  const recentConversations = await getRecentConversations(userId, 15).catch(() => []);

  // 4. Deep recall (placeholder)
  const recalledSegments = recallQuery
    ? await recallConversation(userId, recallQuery).catch(() => [])
    : [];

  // 5. Compute relationshipMeta
  const conversationCount = recentConversations.length;
  const sortedByDate = [...recentConversations].sort((a, b) =>
    new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
  );
  const totalMessages = sessionMessages.length; // approximate

  return {
    profile,
    memories,
    recentConversations: recentConversations.map(c => ({
      id: c.id,
      summary: c.summary,
      started_at: c.started_at,
      ended_at: c.ended_at,
    })),
    recalledSegments,
    currentSession: {
      messages: sessionMessages,
      startedAt: new Date(),
    },
    relationshipMeta: {
      conversationCount,
      firstConversationDate: sortedByDate[0]?.started_at ?? null,
      lastConversationDate: sortedByDate[sortedByDate.length - 1]?.started_at ?? null,
      totalMessages,
    },
  };
}
