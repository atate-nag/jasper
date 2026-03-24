import { streamText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { createClient } from '@/lib/supabase/server';
import { getPersonContext } from '@/lib/backbone';
import { steer } from '@/lib/intermediary';
import { JASPER } from '@/lib/product/identity';
import type { Message } from '@/types/message';
import type { ResponseDirective } from '@/lib/intermediary/types';

export const maxDuration = 60;

function findSentenceBoundary(text: string): number | null {
  // Match sentence-ending punctuation followed by space + uppercase letter
  const match = text.match(/(?<![A-Z])[.!?]\s+(?=[A-Z"'])/);
  if (match && match.index !== undefined) return match.index + 1;

  // Fallback: if buffer exceeds ~200 chars, break at last comma
  if (text.length > 200) {
    const lastComma = text.lastIndexOf(', ');
    if (lastComma > 50) return lastComma + 1;
  }

  return null;
}

async function synthesizeSentence(text: string, voice: string = 'fable'): Promise<ArrayBuffer> {
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'tts-1',
      input: text,
      voice,
      speed: 1.2,
      response_format: 'mp3',
    }),
  });
  return response.arrayBuffer();
}

export async function POST(req: Request): Promise<Response> {
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

  const lastUserMessage = extractText(rawMessages.filter(m => m.role === 'user').pop() ?? {});
  if (!lastUserMessage) {
    return new Response(JSON.stringify({ error: 'No user message' }), { status: 400 });
  }

  const sessionHistory: Message[] = rawMessages
    .filter(m => extractText(m).length > 0)
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: extractText(m),
      timestamp: new Date().toISOString(),
    }));

  try {
    const personContext = await getPersonContext(user.id, lastUserMessage, sessionHistory);
    const steering = await steer(
      lastUserMessage, personContext, JASPER, sessionHistory, previousDirective,
      undefined, { voiceMode: true },
    );

    // Get user's voice preference
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('voice_preference')
      .eq('user_id', user.id)
      .maybeSingle();
    const voice = profile?.voice_preference || 'fable';

    const result = streamText({
      model: anthropic(steering.modelConfig.model),
      system: steering.systemPrompt,
      messages: [{ role: 'user', content: steering.reformulatedMessage }],
      temperature: steering.modelConfig.temperature,
      maxOutputTokens: steering.modelConfig.maxTokens,
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let sentenceBuffer = '';
        let sentenceIndex = 0;
        const pendingTTS: Promise<void>[] = [];

        try {
          for await (const chunk of result.textStream) {
            // Send text chunk
            controller.enqueue(encoder.encode(
              `data: ${JSON.stringify({ type: 'text', content: chunk })}\n\n`
            ));

            sentenceBuffer += chunk;

            const boundary = findSentenceBoundary(sentenceBuffer);
            if (boundary !== null) {
              const sentence = sentenceBuffer.substring(0, boundary).trim();
              sentenceBuffer = sentenceBuffer.substring(boundary).trimStart();

              if (sentence.length > 5) {
                const idx = sentenceIndex++;
                const ttsPromise = synthesizeSentence(sentence, voice)
                  .then(audioBuffer => {
                    const base64 = Buffer.from(audioBuffer).toString('base64');
                    controller.enqueue(encoder.encode(
                      `data: ${JSON.stringify({ type: 'audio', index: idx, audio: base64 })}\n\n`
                    ));
                  })
                  .catch(err => {
                    console.error(`[voice] TTS failed for sentence ${idx}:`, err);
                  });
                pendingTTS.push(ttsPromise);
              }
            }
          }

          // Flush remaining buffer
          if (sentenceBuffer.trim().length > 5) {
            const idx = sentenceIndex;
            try {
              const audioBuffer = await synthesizeSentence(sentenceBuffer.trim(), voice);
              const base64 = Buffer.from(audioBuffer).toString('base64');
              controller.enqueue(encoder.encode(
                `data: ${JSON.stringify({ type: 'audio', index: idx, audio: base64 })}\n\n`
              ));
            } catch (err) {
              console.error('[voice] TTS failed for final sentence:', err);
            }
          }

          // Wait for all pending TTS
          await Promise.allSettled(pendingTTS);

          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (err) {
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: 'error', error: String(err) })}\n\n`
          ));
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
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
