import { streamText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { createClient } from '@/lib/supabase/server';
import { getPersonContext } from '@/lib/backbone';
import { classifyConversation } from '@/lib/backbone/classify';
import { mergeProfileUpdates } from '@/lib/backbone/profile';
import { steer } from '@/lib/intermediary';
import { JASPER } from '@/lib/product/identity';
import type { Message } from '@/types/message';
import type { ResponseDirective } from '@/lib/intermediary/types';
import { createHash } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase';
import { setObserveData } from '@/app/api/observe/route';

export const maxDuration = 60;

async function logTurn(
  userId: string,
  conversationId: string | null,
  turnNumber: number,
  userMessage: string,
  steering: Awaited<ReturnType<typeof steer>>,
  assistantResponse: string,
  responseLatencyMs: number,
): Promise<void> {
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
    console.error('[turn_log] Failed:', err);
  }
}

export async function POST(req: Request): Promise<Response> {
  // Auth check — defence in depth, don't rely on middleware alone
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const body = await req.json();
  const { messages: rawMessages = [], previousDirective } = body as {
    messages?: Array<{
      role: string;
      content?: string;
      parts?: Array<{ type: string; text?: string }>;
    }>;
    previousDirective?: ResponseDirective;
  };

  // AI SDK v6 sends parts instead of content — extract text from both formats
  function extractText(msg: { content?: string; parts?: Array<{ type: string; text?: string }> }): string {
    if (msg.content) return msg.content;
    if (msg.parts) {
      return msg.parts
        .filter(p => p.type === 'text' && p.text)
        .map(p => p.text!)
        .join('');
    }
    return '';
  }

  const lastUserMessage = extractText(
    rawMessages.filter(m => m.role === 'user').pop() ?? {}
  );
  if (!lastUserMessage) {
    return new Response(JSON.stringify({ error: 'No user message' }), { status: 400 });
  }

  // Convert to internal Message format
  const sessionHistory: Message[] = rawMessages
    .filter(m => extractText(m).length > 0)
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: extractText(m),
      timestamp: new Date().toISOString(),
    }));

  try {
  // 1. Backbone: get person context
  const personContext = await getPersonContext(user.id, lastUserMessage, sessionHistory);

  // 2. Intermediary: steer
  const steerStart = Date.now();
  const steering = await steer(lastUserMessage, personContext, JASPER, sessionHistory, previousDirective);
  const steerLatencyMs = Date.now() - steerStart;

  // Server-side observe log
  const d = steering.responseDirective;
  console.log(`[OBSERVE] intent: ${d.communicativeIntent} | posture: ${d.recommendedPostureClass} | conf: ${d.confidence} | policy: ${steering.selectedPolicy.id} | model: ${steering.modelConfig.model} (${steering.modelConfig.tier}) | steer: ${steerLatencyMs}ms`);
  console.log(`[OBSERVE]   → "${d.rationale.substring(0, 120)}${d.rationale.length > 120 ? '...' : ''}"`);
  if (d.recallTriggered) {
    console.log(`[OBSERVE]   recall: ${d.recallTier} query="${d.recallQuery}"`);
  }

  // 3. Stream the response via AI SDK
  const responseStart = Date.now();

  const result = streamText({
    model: anthropic(steering.modelConfig.model),
    system: steering.systemPrompt,
    messages: [{ role: 'user', content: steering.reformulatedMessage }],
    temperature: steering.modelConfig.temperature,
    maxOutputTokens: steering.modelConfig.maxTokens,
    onFinish: async ({ text }) => {
      const responseLatencyMs = Date.now() - responseStart;
      const turnNumber = rawMessages.filter(m => m.role === 'user').length;

      // Log turn
      logTurn(user.id, null, turnNumber, lastUserMessage, steering, text, responseLatencyMs).catch(console.error);

      // Post-response: classify profile
      if (steering.postResponseActions.classifyProfile) {
        const allMessages: Message[] = [
          ...sessionHistory,
          { role: 'assistant', content: text, timestamp: new Date().toISOString() },
        ];
        classifyConversation(allMessages).then(async (result) => {
          if (result.profileUpdates && Object.keys(result.profileUpdates).length > 0) {
            await mergeProfileUpdates(user.id, result.profileUpdates).catch(console.error);
          }
        }).catch(console.error);
      }

      // Post-response: extract memories
      if (steering.postResponseActions.extractMemories) {
        import('@/lib/backbone/memory').then(({ addToMemory }) => {
          addToMemory(user.id, [
            { role: 'user', content: lastUserMessage },
            { role: 'assistant', content: text },
          ]).catch(console.error);
        }).catch(console.error);
      }
    },
  });

  // Store observe data for the debug panel
  const observeData = {
    intent: d.communicativeIntent,
    valence: d.emotionalValence,
    arousal: d.emotionalArousal,
    posture: d.recommendedPostureClass,
    length: d.recommendedResponseLength,
    challenge: d.challengeAppropriate,
    dispreferred: d.dispreferred,
    confidence: d.confidence,
    rationale: d.rationale,
    policy: steering.selectedPolicy.id,
    model: steering.modelConfig.model,
    tier: steering.modelConfig.tier,
    temperature: steering.modelConfig.temperature,
    maxTokens: steering.modelConfig.maxTokens,
    recallTier: d.recallTier,
    recallQuery: d.recallQuery,
    steerLatencyMs,
  };

  // Store for the observe endpoint
  setObserveData(user.id, observeData);

  return result.toUIMessageStreamResponse({
    headers: {
      'X-Jasper-Policy': steering.selectedPolicy.id,
      'X-Jasper-Tier': steering.modelConfig.tier,
      'X-Jasper-Observe': JSON.stringify(observeData),
    },
  });

  } catch (err) {
    console.error('[chat] Pipeline error:', err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
