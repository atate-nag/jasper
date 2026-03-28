// Shared post-response actions for both web chat and voice routes.
// Handles: conversation persistence, turn logging, profile classification,
// memory extraction, and session-end processing (summarisation, segments, calibration).

import { getSupabaseAdmin } from '@/lib/supabase';
import { classifyConversation } from '@/lib/backbone/classify';
import { mergeProfileUpdates } from '@/lib/backbone/profile';
import type { Message } from '@/types/message';
import type { steer } from '@/lib/intermediary';
import { createHash } from 'crypto';

// Per-user conversation tracking (in-memory, server-side)
const activeConversations = new Map<string, string>();

// Per-user inactivity timers for session-end processing
const sessionTimers = new Map<string, ReturnType<typeof setTimeout>>();

// How long to wait after the last message before running session-end processing
const SESSION_INACTIVITY_MS = 5 * 60 * 1000; // 5 minutes

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
  userName?: string,
): Promise<void> {
  const turnNumber = sessionHistory.filter(m => m.role === 'user').length;

  const allMessages: Message[] = [
    ...sessionHistory,
    { role: 'assistant', content: assistantResponse, timestamp: new Date().toISOString() },
  ];

  // 1. Persist conversation messages
  if (conversationId) {
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

  // 2. Log turn — full analytics
  const d = steering.responseDirective;
  const a = steering.analytics;
  const promptTokens = Math.ceil(steering.systemPrompt.split(/\s+/).length * 1.3);
  try {
    await getSupabaseAdmin().from('turn_logs').insert({
      user_id: userId,
      conversation_id: conversationId,
      turn_number: turnNumber,
      user_message: userMessage,
      response_directive: d,
      selected_policy_id: steering.selectedPolicy.id,
      exploration_flag: false,
      system_prompt_hash: createHash('sha256').update(steering.systemPrompt).digest('hex').slice(0, 16),
      reformulated_message: steering.reformulatedMessage,
      model_config: steering.modelConfig,
      assistant_response: assistantResponse,
      response_latency_ms: responseLatencyMs,
      // Queryable observe fields
      user_name: userName,
      user_message_preview: userMessage.slice(0, 120),
      user_message_length: userMessage.length,
      intent: d.communicativeIntent,
      valence: d.emotionalValence,
      arousal: d.emotionalArousal,
      posture: d.recommendedPostureClass,
      classification_confidence: d.confidence,
      provider: steering.modelConfig.provider,
      policy_id: steering.selectedPolicy.id,
      model_used: steering.modelConfig.model,
      model_tier: steering.modelConfig.tier,
      distress_override: a?.distressOverride || false,
      prompt_tokens: promptTokens,
      prompt_components: a?.promptComponents || null,
      history_message_count: sessionHistory.length,
      recall_tier: d.recallTriggered ? d.recallTier : null,
      recall_segments_returned: a?.recallSegmentsReturned || 0,
      recall_top_similarity: a?.recallTopSimilarity || null,
      depth_consumed: a?.depthConsumed || false,
      relational_consumed: a?.relationalConsumed || false,
      care_context_injected: a?.careContextInjected || false,
      response_preview: assistantResponse.slice(0, 120),
      response_length: assistantResponse.length,
      steer_latency_ms: responseLatencyMs,
      conversation_mode: steering.conversationState?.conversationDevelopmentMode ? 'development' : 'user-centric',
      thread_count: steering.conversationState?.activeThreads?.length || 0,
      energy: steering.conversationState?.energyTrajectory || null,
    });
  } catch (err) {
    console.error('[post-response] Turn log failed:', err);
  }

  // 3. Classify profile (async, non-blocking)
  if (steering.postResponseActions.classifyProfile) {
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

  // 5. Schedule session-end processing on inactivity
  scheduleSessionEnd(userId, conversationId, allMessages);
}

/**
 * Schedule session-end processing after a period of inactivity.
 * Each new message resets the timer. When the timer fires,
 * the session is considered ended and we run summarisation,
 * segment extraction, and calibration — same as CLI /quit.
 */
function scheduleSessionEnd(
  userId: string,
  conversationId: string | null,
  messages: Message[],
): void {
  // Clear any existing timer
  const existing = sessionTimers.get(userId);
  if (existing) clearTimeout(existing);

  // Set new timer
  const timer = setTimeout(() => {
    sessionTimers.delete(userId);
    runSessionEnd(userId, conversationId, messages).catch(err => {
      console.error('[session-end] Failed:', err);
    });
  }, SESSION_INACTIVITY_MS);

  sessionTimers.set(userId, timer);
}

/**
 * Run the same session-end pipeline as CLI /quit:
 * summarise, classify, extract segments, calibrate, metacognition.
 */
async function runSessionEnd(
  userId: string,
  conversationId: string | null,
  messages: Message[],
): Promise<void> {
  if (messages.length < 4) {
    // Too short for meaningful session-end processing
    activeConversations.delete(userId);
    return;
  }

  console.log(`[session-end] Processing session for user ${userId.slice(0, 8)}... (${messages.length} messages, ${SESSION_INACTIVITY_MS / 1000}s inactivity)`);

  try {
    // 1. Summarise — with profile and previous summaries for context
    const { summariseConversation } = await import('@/lib/backbone/summarise');
    const { getProfile } = await import('@/lib/backbone/profile');
    const { getRecentConversations } = await import('@/lib/backbone/conversations');
    const userProfile = await getProfile(userId);
    const recentConvos = await getRecentConversations(userId, 5);
    const prevSummaries = recentConvos.filter(c => c.summary).map(c => c.summary!).slice(-3);
    const summary = await summariseConversation(messages, userProfile, prevSummaries);
    console.log(`[session-end] Summary: ${summary.slice(0, 120)}...`);

    // 2. Extract segments for deep recall
    if (conversationId) {
      try {
        const { extractSegments } = await import('@/lib/backbone/recall');
        await extractSegments(conversationId, userId, messages, new Date());
        console.log('[session-end] Segments extracted');
      } catch (err) {
        console.error('[session-end] Segment extraction failed:', err);
      }
    }

    // 3. Calibrate
    try {
      const { extractSessionSignals, updateCalibration, saveCalibration } = await import('@/lib/backbone/calibrate');
      const { getProfile, defaultCalibration } = await import('@/lib/backbone/profile');
      const profile = await getProfile(userId);
      const currentCal = (profile as unknown as Record<string, unknown>)?.calibration as Record<string, unknown> | undefined;
      const cal = currentCal?.challengeCeiling != null ? currentCal : defaultCalibration();
      const signals = extractSessionSignals(messages);
      const updated = updateCalibration(cal as ReturnType<typeof defaultCalibration>, signals);
      await saveCalibration(userId, updated);
      console.log(`[session-end] Calibration updated: challenge=${updated.challengeCeiling.toFixed(2)} humour=${updated.humourTolerance.toFixed(2)}`);
    } catch (err) {
      console.error('[session-end] Calibration failed:', err);
    }

    // 4. Metacognition
    try {
      const { runSessionMetacognition } = await import('@/lib/backbone/metacognition');
      const obs = await runSessionMetacognition(userId, conversationId || 'web', messages);
      if (obs) {
        console.log(`[session-end] Metacognition: ${obs.patternsNoted.length} pattern(s) noted`);
      }
    } catch (err) {
      console.error('[session-end] Metacognition failed:', err);
    }

    // 5. Compute session analytics from turn logs
    let sessionAnalytics = null;
    if (conversationId) {
      try {
        const { data: turns } = await getSupabaseAdmin()
          .from('turn_logs')
          .select('intent, model_used, model_tier, recall_tier, recall_segments_returned, depth_score, depth_consumed, relational_connection_found, relational_consumed, care_context_injected, distress_override, prompt_tokens, response_length, steer_latency_ms')
          .eq('conversation_id', conversationId);

        if (turns && turns.length > 0) {
          const models: Record<string, number> = {};
          const intents: Record<string, number> = {};
          turns.forEach(t => {
            if (t.model_used) models[t.model_used] = (models[t.model_used] || 0) + 1;
            if (t.intent) intents[t.intent] = (intents[t.intent] || 0) + 1;
          });

          sessionAnalytics = {
            turn_count: turns.length,
            models_used: models,
            intents_distribution: intents,
            recall_stats: {
              total_recalls: turns.filter(t => t.recall_tier).length,
              avg_segments: turns.filter(t => t.recall_segments_returned).reduce((s, t) => s + (t.recall_segments_returned || 0), 0) / (turns.filter(t => t.recall_tier).length || 1),
            },
            depth_scoring: {
              consumed: turns.filter(t => t.depth_consumed).length,
            },
            relational_connections: {
              found: turns.filter(t => t.relational_connection_found).length,
              consumed: turns.filter(t => t.relational_consumed).length,
            },
            care: {
              distress_turns: turns.filter(t => t.distress_override).length,
              care_context_injections: turns.filter(t => t.care_context_injected).length,
            },
            prompt_size_avg: Math.round(turns.reduce((s, t) => s + (t.prompt_tokens || 0), 0) / turns.length),
            response_length_avg: Math.round(turns.reduce((s, t) => s + (t.response_length || 0), 0) / turns.length),
          };
        }
      } catch (err) {
        console.error('[session-end] Analytics computation failed:', err);
      }
    }

    // 6. End conversation record
    if (conversationId) {
      try {
        await getSupabaseAdmin()
          .from('conversations')
          .update({
            ended_at: new Date().toISOString(),
            summary,
            analytics: sessionAnalytics,
          })
          .eq('id', conversationId);
      } catch (err) {
        console.error('[session-end] Failed to end conversation:', err);
      }
    }
  } catch (err) {
    console.error('[session-end] Pipeline failed:', err);
  }

  // Clear the active conversation so a new one is created next time
  activeConversations.delete(userId);
  console.log(`[session-end] Done for user ${userId.slice(0, 8)}`);
}
