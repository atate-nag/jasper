import { streamText, generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { createClient } from '@/lib/supabase/server';
import { getPersonContext } from '@/lib/backbone';
import { steer } from '@/lib/intermediary';
import { JASPER, buildIdentityPrompt, buildCharacterConfig, isCloneUser } from '@/lib/product/identity';
import type { Message } from '@/types/message';
import type { ResponseDirective } from '@/lib/intermediary/types';
import { setObserveData } from '@/app/api/observe/route';
import { getOrCreateConversation, handlePostResponse } from '@/lib/post-response';
import { logUsage } from '@/lib/usage';
import { relationshipSafetyRewrite } from '@/lib/intermediary/relationship-safety';

export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  // Auth check — defence in depth, don't rely on middleware alone
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const body = await req.json();
  const { messages: rawMessages = [], previousDirective, openerMessage } = body as {
    messages?: Array<{
      role: string;
      content?: string;
      parts?: Array<{ type: string; text?: string }>;
    }>;
    previousDirective?: ResponseDirective;
    openerMessage?: string;
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

    // 2. Build identity prompt from profile's jasper_character
    const profileData = personContext.profile as unknown as Record<string, unknown>;
    const charConfig = buildCharacterConfig(profileData);
    const jasperIdentity = {
      ...JASPER,
      identityPrompt: buildIdentityPrompt(charConfig, isCloneUser(profileData)),
    };

    // 3. Intermediary: steer
    const steerStart = Date.now();
    const steering = await steer(lastUserMessage, personContext, jasperIdentity, sessionHistory, previousDirective);
    const steerLatencyMs = Date.now() - steerStart;

    // Consolidated turn log — one block with everything
    const d = steering.responseDirective;
    const sysPromptWords = steering.systemPrompt.split(/\s+/).length;
    const historyWords = sessionHistory.reduce((sum, m) => sum + m.content.split(/\s+/).length, 0);

    // 3. Get or create conversation for persistence
    const conversationId = await getOrCreateConversation(user.id);

    // 4. Stream the response via AI SDK
    const responseStart = Date.now();

    // Build the full message array: conversation history + reformulated current message
    const llmMessages = [
      ...sessionHistory.slice(0, -1).map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user' as const, content: steering.reformulatedMessage },
    ];

    // Include opener so the model sees its own greeting before the user's first reply
    if (openerMessage && !sessionHistory.some(m => m.role === 'assistant')) {
      llmMessages.unshift({ role: 'assistant' as const, content: openerMessage });
    }

    const userName = personContext.profile.identity?.name || user.email || user.id.slice(0, 8);
    const relationshipModeActive = (steering.analytics?.relationshipContextActive) || false;
    console.log(`[TURN:${userName}] msgs=${sessionHistory.length} | llmMsgs=${llmMessages.length} | prompt=${sysPromptWords}w | ${d.communicativeIntent}→${steering.selectedPolicy.id} | ${steering.modelConfig.model} (${steering.modelConfig.tier}) max=${steering.modelConfig.maxTokens} | steer=${steerLatencyMs}ms | recall=${d.recallTriggered ? d.recallTier : 'no'}${relationshipModeActive ? ' | REL-MODE' : ''} | "${lastUserMessage.slice(0, 50)}"`);

    // When relationship mode is active, buffer the response for safety rewrite
    console.log(`[chat] relationshipModeActive=${relationshipModeActive} | analytics.relCtx=${steering.analytics?.relationshipContextActive} | analytics.relTurns=${steering.analytics?.relationshipTurnCount}`);
    if (relationshipModeActive) {
      console.log('[chat] ENTERING BUFFERED RELATIONSHIP MODE');
      const genResult = await generateText({
        model: anthropic(steering.modelConfig.model),
        system: steering.systemPrompt,
        messages: llmMessages,
        temperature: steering.modelConfig.temperature,
        maxOutputTokens: steering.modelConfig.maxTokens,
      });

      const responseLatencyMs = Date.now() - responseStart;
      logUsage({
        inputTokens: genResult.usage.inputTokens || 0,
        outputTokens: genResult.usage.outputTokens || 0,
        model: steering.modelConfig.model,
        provider: steering.modelConfig.provider,
      }, 'chat', user.id, conversationId, responseLatencyMs);

      // Run relationship safety rewrite
      const safetyResult = await relationshipSafetyRewrite(
        genResult.text, userName, user.id,
      );

      if (safetyResult.rewritten) {
        console.log(`[relationship-safety] Rewritten. Violations: ${safetyResult.violations.join(' | ')}`);
      }

      const finalText = safetyResult.text;

      handlePostResponse(
        user.id, conversationId, sessionHistory,
        lastUserMessage, finalText, steering, responseLatencyMs, userName,
      ).catch(console.error);

      // Return as a non-streaming response wrapped in UI message stream format
      const encoder = new TextEncoder();
      const responseStream = new ReadableStream({
        start(controller) {
          // Send as a UI message stream event
          controller.enqueue(encoder.encode(`e:${JSON.stringify({ type: 'text', textDelta: finalText })}\n`));
          controller.enqueue(encoder.encode(`d:${JSON.stringify({ finishReason: 'stop' })}\n`));
          controller.close();
        },
      });

      // Store observe data
      setObserveData(user.id, {
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
      });

      return new Response(responseStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'X-Jasper-Policy': steering.selectedPolicy.id,
          'X-Jasper-Tier': steering.modelConfig.tier,
          'X-Jasper-Relationship-Mode': 'true',
          'X-Jasper-Rewritten': safetyResult.rewritten ? 'true' : 'false',
        },
      });
    }

    // Normal streaming path (no relationship mode)
    const result = streamText({
      model: anthropic(steering.modelConfig.model),
      system: steering.systemPrompt,
      messages: llmMessages,
      temperature: steering.modelConfig.temperature,
      maxOutputTokens: steering.modelConfig.maxTokens,
      onFinish: async ({ text, finishReason, usage }) => {
        const responseLatencyMs = Date.now() - responseStart;
        if (finishReason === 'length') {
          console.warn(`[chat] Response truncated at token limit (${steering.modelConfig.maxTokens} tokens)`);
        }
        logUsage({
          inputTokens: usage.inputTokens || 0,
          outputTokens: usage.outputTokens || 0,
          model: steering.modelConfig.model,
          provider: steering.modelConfig.provider,
        }, 'chat', user.id, conversationId, responseLatencyMs);
        handlePostResponse(
          user.id, conversationId, sessionHistory,
          lastUserMessage, text, steering, responseLatencyMs, userName,
        ).catch(console.error);
      },
    });

    // Store observe data for the debug panel
    setObserveData(user.id, {
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
    });

    return result.toUIMessageStreamResponse({
      headers: {
        'X-Jasper-Policy': steering.selectedPolicy.id,
        'X-Jasper-Tier': steering.modelConfig.tier,
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
