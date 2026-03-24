import { getPersonContext, saveMessages, createConversation } from '@/lib/backbone';
import { classifyConversation } from '@/lib/backbone/classify';
import { mergeProfileUpdates } from '@/lib/backbone/profile';
import { steer } from '@/lib/intermediary';
import { JASPER } from '@/lib/product/identity';
import { chatStream } from '@/lib/llm/client';
import type { Message } from '@/types/message';
import type { ResponseDirective } from '@/lib/intermediary/types';
import { createHash } from 'crypto';
import { getSupabase } from '@/lib/supabase';

async function logTurn(
  userId: string,
  conversationId: string | null,
  turnNumber: number,
  userMessage: string,
  steering: Awaited<ReturnType<typeof steer>>,
  assistantResponse: string,
  classificationLatencyMs: number,
  responseLatencyMs: number,
): Promise<void> {
  try {
    await getSupabase().from('turn_logs').insert({
      user_id: userId,
      conversation_id: conversationId,
      turn_number: turnNumber,
      user_message: userMessage,
      response_directive: steering.responseDirective,
      classification_latency_ms: classificationLatencyMs,
      selected_policy_id: steering.selectedPolicy.id,
      exploration_flag: false,
      system_prompt_hash: createHash('sha256').update(steering.systemPrompt).digest('hex').slice(0, 16),
      reformulated_message: steering.reformulatedMessage,
      model_config: steering.modelConfig,
      assistant_response: assistantResponse,
      response_latency_ms: responseLatencyMs,
    });
  } catch (err) {
    console.error('[turn_log] Failed to log turn:', err);
  }
}

export async function POST(req: Request): Promise<Response> {
  const body = await req.json();
  const {
    userId,
    message,
    conversationId,
    sessionHistory = [],
    previousDirective,
    turnNumber = 0,
  } = body as {
    userId: string;
    message: string;
    conversationId?: string;
    sessionHistory?: Message[];
    previousDirective?: ResponseDirective;
    turnNumber?: number;
  };

  if (!userId || !message) {
    return new Response(JSON.stringify({ error: 'userId and message are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 1. Get person context
  const classifyStart = Date.now();
  const personContext = await getPersonContext(userId, message, sessionHistory);

  // 2. Steer
  const steering = await steer(message, personContext, JASPER, sessionHistory, previousDirective);
  const classificationLatencyMs = Date.now() - classifyStart;

  // 3. Stream LLM response
  const responseStart = Date.now();
  const encoder = new TextEncoder();
  let fullResponse = '';

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Send steering metadata as first chunk
        const meta = JSON.stringify({
          type: 'metadata',
          responseDirective: steering.responseDirective,
          selectedPolicy: steering.selectedPolicy,
          modelConfig: steering.modelConfig,
        });
        controller.enqueue(encoder.encode(`data: ${meta}\n\n`));

        // Stream the LLM response
        await chatStream(
          steering.modelConfig,
          steering.systemPrompt,
          steering.reformulatedMessage,
          sessionHistory,
          (token) => {
            fullResponse += token;
            const chunk = JSON.stringify({ type: 'token', content: token });
            controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
          },
        );

        // Send done event
        const done = JSON.stringify({ type: 'done', fullResponse });
        controller.enqueue(encoder.encode(`data: ${done}\n\n`));
        controller.close();

        const responseLatencyMs = Date.now() - responseStart;

        // 4. Log turn (async)
        logTurn(userId, conversationId ?? null, turnNumber, message, steering, fullResponse, classificationLatencyMs, responseLatencyMs).catch(console.error);

        // 5. Post-response actions (async)
        if (steering.postResponseActions.extractMemories) {
          import('@/lib/backbone/memory').then(({ addToMemory }) => {
            addToMemory(
              userId,
              [{ role: 'user', content: message }, { role: 'assistant', content: fullResponse }],
            ).catch(console.error);
          }).catch(console.error);
        }

        if (steering.postResponseActions.classifyProfile) {
          const allMessages: Message[] = [
            ...sessionHistory,
            { role: 'user', content: message, timestamp: new Date().toISOString() },
            { role: 'assistant', content: fullResponse, timestamp: new Date().toISOString() },
          ];
          classifyConversation(allMessages).then(async (result) => {
            if (result.profileUpdates && Object.keys(result.profileUpdates).length > 0) {
              await mergeProfileUpdates(userId, result.profileUpdates).catch(console.error);
            }
          }).catch(console.error);
        }
      } catch (err) {
        const errorMsg = JSON.stringify({ type: 'error', error: String(err) });
        controller.enqueue(encoder.encode(`data: ${errorMsg}\n\n`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
