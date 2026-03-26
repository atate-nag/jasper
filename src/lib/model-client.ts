import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { ProviderModelConfig } from '@/lib/config/models';

let _anthropic: Anthropic | null = null;
let _openai: OpenAI | null = null;

function getAnthropic(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic();
  return _anthropic;
}

function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI();
  return _openai;
}

export async function callModel(
  config: ProviderModelConfig,
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  temperature?: number,
): Promise<string> {
  const temp = temperature ?? config.defaultTemperature;

  if (config.provider === 'anthropic') {
    const response = await getAnthropic().messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: temp,
      system: systemPrompt,
      messages: messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    });

    return response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('');
  }

  if (config.provider === 'openai') {
    const response = await getOpenAI().chat.completions.create({
      model: config.model,
      max_completion_tokens: config.maxTokens,
      temperature: temp,
      messages: [
        { role: 'system' as const, content: systemPrompt },
        ...messages.map(m => ({
          role: m.role as 'system' | 'user' | 'assistant',
          content: m.content,
        })),
      ],
    });

    return response.choices[0]?.message?.content || '';
  }

  throw new Error(`Unknown provider: ${config.provider}`);
}

export async function* streamModel(
  config: ProviderModelConfig,
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  temperature?: number,
): AsyncGenerator<string> {
  const temp = temperature ?? config.defaultTemperature;

  if (config.provider === 'anthropic') {
    const stream = getAnthropic().messages.stream({
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: temp,
      system: systemPrompt,
      messages: messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
    return;
  }

  if (config.provider === 'openai') {
    const stream = await getOpenAI().chat.completions.create({
      model: config.model,
      max_completion_tokens: config.maxTokens,
      temperature: temp,
      stream: true,
      messages: [
        { role: 'system' as const, content: systemPrompt },
        ...messages.map(m => ({
          role: m.role as 'system' | 'user' | 'assistant',
          content: m.content,
        })),
      ],
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) yield text;
    }
    return;
  }

  throw new Error(`Unknown provider: ${config.provider}`);
}
