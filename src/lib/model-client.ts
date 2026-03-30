import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { ProviderModelConfig } from '@/lib/config/models';
import type { TokenUsage } from '@/lib/usage';

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

export interface ModelResult {
  text: string;
  usage: TokenUsage;
}

export async function callModel(
  config: ProviderModelConfig,
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  temperature?: number,
): Promise<ModelResult> {
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

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('');

    return {
      text,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        model: config.model,
        provider: 'anthropic',
      },
    };
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

    return {
      text: response.choices[0]?.message?.content || '',
      usage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
        model: config.model,
        provider: 'openai',
      },
    };
  }

  throw new Error(`Unknown provider: ${config.provider}`);
}

export interface StreamResult {
  textStream: AsyncGenerator<string>;
  usage: () => TokenUsage | null;
}

export function streamModel(
  config: ProviderModelConfig,
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  temperature?: number,
): StreamResult {
  const temp = temperature ?? config.defaultTemperature;
  let finalUsage: TokenUsage | null = null;

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

    async function* iterate(): AsyncGenerator<string> {
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield event.delta.text;
        }
        if (event.type === 'message_delta' && 'usage' in event) {
          const msg = await stream.finalMessage();
          finalUsage = {
            inputTokens: msg.usage.input_tokens,
            outputTokens: msg.usage.output_tokens,
            model: config.model,
            provider: 'anthropic',
          };
        }
      }
      // Ensure we have usage even if message_delta wasn't caught
      if (!finalUsage) {
        try {
          const msg = await stream.finalMessage();
          finalUsage = {
            inputTokens: msg.usage.input_tokens,
            outputTokens: msg.usage.output_tokens,
            model: config.model,
            provider: 'anthropic',
          };
        } catch { /* stream may have already been consumed */ }
      }
    }

    return { textStream: iterate(), usage: () => finalUsage };
  }

  if (config.provider === 'openai') {
    async function* iterate(): AsyncGenerator<string> {
      const stream = await getOpenAI().chat.completions.create({
        model: config.model,
        max_completion_tokens: config.maxTokens,
        temperature: temp,
        stream: true,
        stream_options: { include_usage: true },
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
        if (chunk.usage) {
          finalUsage = {
            inputTokens: chunk.usage.prompt_tokens || 0,
            outputTokens: chunk.usage.completion_tokens || 0,
            model: config.model,
            provider: 'openai',
          };
        }
      }
    }

    return { textStream: iterate(), usage: () => finalUsage };
  }

  throw new Error(`Unknown provider: ${config.provider}`);
}
