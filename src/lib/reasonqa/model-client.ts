// ReasonQA model client — wraps the shared callModel with ZDR Anthropic client.

import { getAnthropicZDR } from './anthropic-zdr';
import type { ProviderModelConfig } from '@/lib/config/models';
import type { TokenUsage } from '@/lib/usage';

export interface ModelResult {
  text: string;
  usage: TokenUsage;
}

export async function callModelZDR(
  config: ProviderModelConfig,
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  temperature?: number,
): Promise<ModelResult> {
  const temp = temperature ?? config.defaultTemperature;

  if (config.provider !== 'anthropic') {
    throw new Error(`ReasonQA only supports Anthropic models (ZDR required), got: ${config.provider}`);
  }

  const response = await getAnthropicZDR().messages.create({
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
