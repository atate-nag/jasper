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
  // Check in-memory cache first (fast path within same function instance)
  const cached = activeConversations.get(userId);
  if (cached) return cached;

  try {
    // Check database for a recent active conversation (no ended_at, started within SESSION_INACTIVITY_MS)
    const cutoff = new Date(Date.now() - SESSION_INACTIVITY_MS).toISOString();
    const { data: existing } = await getSupabaseAdmin()
      .from('conversations')
      .select('id')
      .eq('user_id', userId)
      .is('ended_at', null)
      .gte('started_at', cutoff)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      activeConversations.set(userId, existing.id);
      return existing.id;
    }

    // No active conversation — create a new one
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
      // Behavioural analytics
      correction_detected: a?.correctionDetected || false,
      disclosure_depth: a?.disclosureDepth || 0,
      user_initiated_topic: a?.userInitiatedTopic || false,
      identity_tokens: a?.promptComponents?.['identity'] || null,
      relationship_context_active: a?.relationshipContextActive || false,
      relationship_turn_count: a?.relationshipTurnCount || null,
    });
  } catch (err) {
    console.error('[post-response] Turn log failed:', err);
  }

  // 2.5. Post-generation relationship safety check
  if (a?.relationshipContextActive && conversationId) {
    import('@/lib/intermediary/relationship-safety').then(async ({ checkRelationshipSafety }) => {
      const result = await checkRelationshipSafety(assistantResponse, userId);
      if (!result.pass) {
        console.warn(`[relationship-safety] VIOLATION in conv ${conversationId?.slice(0, 8)}: ${result.violations.join(' | ')}`);
      }
      // Update turn log with check result
      await getSupabaseAdmin()
        .from('turn_logs')
        .update({
          relationship_safety_check: result.pass,
        })
        .eq('conversation_id', conversationId)
        .eq('turn_number', turnNumber);
    }).catch(err => console.error('[relationship-safety] Check error:', err));
  }

  // 2.6. Retroactive wit detection — if user laughed, mark PREVIOUS turn as wit
  if (a?.laughterDetected && conversationId && turnNumber > 1) {
    Promise.resolve(
      getSupabaseAdmin()
        .from('turn_logs')
        .update({ wit_detected: true })
        .eq('conversation_id', conversationId)
        .eq('turn_number', turnNumber - 1)
    ).then(() => {
      console.log(`[wit] Laughter detected — marking turn ${turnNumber - 1} as wit`);
    }).catch((err: unknown) => console.error('[wit] Failed to mark previous turn:', err));
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

  // 6. Piggyback: process any stale conversations (non-blocking)
  processStaleConversations(conversationId).catch(() => {});
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

// Lock to prevent concurrent stale processing
let staleProcessingActive = false;

/**
 * Piggyback session-end processing on regular requests.
 * Finds one stale conversation (inactive >5 min, not ended) and processes it.
 * Runs at most one at a time to avoid overwhelming the LLM.
 */
async function processStaleConversations(currentConversationId: string | null): Promise<void> {
  if (staleProcessingActive) return;
  staleProcessingActive = true;

  try {
    const cutoff = new Date(Date.now() - SESSION_INACTIVITY_MS).toISOString();
    const { data } = await getSupabaseAdmin()
      .from('conversations')
      .select('id, user_id, messages')
      .is('ended_at', null)
      .lt('started_at', cutoff)
      .neq('id', currentConversationId || '')
      .order('started_at', { ascending: true })
      .limit(1);

    if (!data || data.length === 0) return;

    const conv = data[0];
    const messages = conv.messages as Message[] | null;
    if (!messages || messages.length < 4) {
      // Too short — just mark ended
      await getSupabaseAdmin()
        .from('conversations')
        .update({ ended_at: new Date().toISOString() })
        .eq('id', conv.id);
      return;
    }

    // Check last message timestamp is actually stale
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.timestamp && new Date(lastMsg.timestamp).getTime() > Date.now() - SESSION_INACTIVITY_MS) {
      return; // Still active
    }

    console.log(`[piggyback-session-end] Processing conv ${conv.id.slice(0, 8)} for user ${conv.user_id.slice(0, 8)}`);
    await runSessionEnd(conv.user_id, conv.id, messages, 'catchup');
  } catch (err) {
    console.error('[piggyback-session-end] Error:', err);
  } finally {
    staleProcessingActive = false;
  }
}

/**
 * Run the same session-end pipeline as CLI /quit:
 * summarise, classify, extract segments, calibrate, metacognition.
 */
export async function runSessionEnd(
  userId: string,
  conversationId: string | null,
  messages: Message[],
  endTrigger: 'timeout' | 'catchup' | 'cron' = 'timeout',
): Promise<void> {
  if (messages.length < 4) {
    activeConversations.delete(userId);
    return;
  }

  const pipelineStart = Date.now();
  console.log(`[session-end] Processing session for user ${userId.slice(0, 8)}... (${messages.length} messages, trigger=${endTrigger})`);

  // Health tracking
  const health: Record<string, unknown> = {
    conversation_id: conversationId,
    user_id: userId,
    turn_count: messages.filter(m => m.role === 'user').length,
    end_trigger: endTrigger,
    errors: [] as Array<{ step: string; error: string }>,
    summary_generated: false,
    segments_extracted: false,
    segments_count: 0,
    segments_inserted: false,
    calibration_updated: false,
    metacognition_ran: false,
    metacognition_patterns: 0,
    profile_updated: false,
  };
  const errors = health.errors as Array<{ step: string; error: string }>;

  let summary = '';

  try {
    // 1. Summarise
    try {
      const { summariseConversation } = await import('@/lib/backbone/summarise');
      const { getProfile } = await import('@/lib/backbone/profile');
      const { getRecentConversations } = await import('@/lib/backbone/conversations');
      const userProfile = await getProfile(userId);
      const recentConvos = await getRecentConversations(userId, 5);
      const prevSummaries = recentConvos.filter(c => c.summary).map(c => c.summary!).slice(-3);
      summary = await summariseConversation(messages, userProfile, prevSummaries);
      health.summary_generated = true;
      health.summary_model = 'claude-opus-4-6';
      console.log(`[session-end] Summary: ${summary.slice(0, 120)}...`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ step: 'summary', error: msg });
      console.error('[session-end] Summary failed:', msg);
    }

    // 2. Extract segments
    if (conversationId) {
      try {
        const { extractSegments } = await import('@/lib/backbone/recall');
        const result = await extractSegments(conversationId, userId, messages, new Date());
        health.segments_extracted = true;
        health.segments_count = Array.isArray(result) ? result.length : 0;
        health.segments_inserted = true;
        console.log(`[session-end] Segments extracted: ${health.segments_count}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ step: 'segments', error: msg });
        console.error('[session-end] Segment extraction failed:', msg);
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
      health.calibration_updated = true;
      console.log(`[session-end] Calibration updated: challenge=${updated.challengeCeiling.toFixed(2)} humour=${updated.humourTolerance.toFixed(2)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ step: 'calibration', error: msg });
      console.error('[session-end] Calibration failed:', msg);
    }

    // 4. Metacognition
    try {
      const { runSessionMetacognition } = await import('@/lib/backbone/metacognition');
      const obs = await runSessionMetacognition(userId, conversationId || 'web', messages);
      health.metacognition_ran = true;
      if (obs) {
        health.metacognition_patterns = obs.patternsNoted.length;
        console.log(`[session-end] Metacognition: ${obs.patternsNoted.length} pattern(s) noted`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ step: 'metacognition', error: msg });
      console.error('[session-end] Metacognition failed:', msg);
    }

    // 4.5 Thread detection (behind feature flag)
    if (conversationId && summary) {
      try {
        const { detectThreadCandidates } = await import('@/lib/backbone/threads');
        await detectThreadCandidates(userId, conversationId, summary);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ step: 'thread_detection', error: msg });
        console.error('[session-end] Thread detection failed:', msg);
      }
    }

    // 5. Compute session analytics from turn logs
    let sessionGapHours: number | null = null;
    if (conversationId) {
      try {
        const { data: prevConv } = await getSupabaseAdmin()
          .from('conversations')
          .select('ended_at')
          .eq('user_id', userId)
          .neq('id', conversationId)
          .not('ended_at', 'is', null)
          .order('ended_at', { ascending: false })
          .limit(1)
          .single();
        if (prevConv?.ended_at) {
          sessionGapHours = Math.round((Date.now() - new Date(prevConv.ended_at).getTime()) / (1000 * 60 * 60) * 10) / 10;
        }
      } catch { /* first session — no gap */ }
    }

    let sessionAnalytics = null;
    if (conversationId) {
      try {
        const { data: turns } = await getSupabaseAdmin()
          .from('turn_logs')
          .select('intent, model_used, model_tier, recall_tier, recall_segments_returned, depth_score, depth_consumed, relational_connection_found, relational_consumed, care_context_injected, distress_override, prompt_tokens, response_length, steer_latency_ms, correction_detected, disclosure_depth, user_initiated_topic, wit_detected, turn_number')
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
            behavioral: {
              correction_count: turns.filter(t => t.correction_detected).length,
              max_disclosure_depth: Math.max(0, ...turns.map(t => t.disclosure_depth || 0)),
              avg_disclosure_depth: (() => {
                const disclosed = turns.filter(t => (t.disclosure_depth || 0) > 0);
                return disclosed.length > 0
                  ? Math.round(disclosed.reduce((s, t) => s + (t.disclosure_depth || 0), 0) / disclosed.length * 100) / 100
                  : 0;
              })(),
              user_initiation_ratio: Math.round(turns.filter(t => t.user_initiated_topic).length / turns.length * 100) / 100,
              wit_landed_count: turns.filter(t => t.wit_detected).length,
              wit_in_first_10_turns: turns.filter(t => t.wit_detected && (t.turn_number || 0) <= 10).length,
              turns_before_first_disclosure: (() => {
                const first = turns.find(t => (t.disclosure_depth || 0) > 0);
                return first ? (first.turn_number || 0) : null;
              })(),
              turns_before_first_wit: (() => {
                const first = turns.find(t => t.wit_detected);
                return first ? (first.turn_number || 0) : null;
              })(),
              session_gap_hours: sessionGapHours,
            },
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
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ step: 'end_conversation', error: msg });
        console.error('[session-end] Failed to end conversation:', msg);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push({ step: 'pipeline', error: msg });
    console.error('[session-end] Pipeline failed:', msg);
  }

  // Compute session duration
  const firstTs = messages[0]?.timestamp;
  const lastTs = messages[messages.length - 1]?.timestamp;
  if (firstTs && lastTs) {
    health.session_duration_seconds = Math.round((new Date(lastTs).getTime() - new Date(firstTs).getTime()) / 1000);
  }

  // Write health record
  try {
    await getSupabaseAdmin().from('session_health').insert(health);
  } catch (err) {
    console.error('[session-health] Failed to write health record:', err);
  }

  // Log health summary
  const bools = ['summary_generated', 'segments_extracted', 'segments_inserted', 'calibration_updated', 'metacognition_ran'] as const;
  const healthLine = bools.map(k => `${k.replace(/_/g, '-').replace('generated', '').replace('extracted', '').replace('updated', '').replace('_ran', '').replace(/-+$/, '')}:${health[k] ? '✓' : '✗'}`).join(' | ');
  console.log(`[session-health] ${healthLine}${errors.length > 0 ? ` | ERRORS: ${errors.length}` : ''}`);
  if (errors.length > 0) {
    console.log(`[session-health] errors: ${JSON.stringify(errors)}`);
  }

  // Clear the active conversation so a new one is created next time
  activeConversations.delete(userId);
  console.log(`[session-end] Done for user ${userId.slice(0, 8)} (${Date.now() - pipelineStart}ms)`);
}
