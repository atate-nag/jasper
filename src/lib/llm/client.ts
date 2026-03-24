import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { Message } from '@/types/message';

export interface ModelConfig {
  tier: 'ambient' | 'standard' | 'deep';
  provider: 'anthropic' | 'openai';
  model: string;
  temperature: number;
  maxTokens: number;
}

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

export async function chat(
  config: ModelConfig,
  systemPrompt: string,
  userPrompt: string,
  history: Message[],
): Promise<string> {
  if (config.provider === 'anthropic') {
    return chatAnthropic(config, systemPrompt, userPrompt, history);
  }
  return chatOpenAI(config, systemPrompt, userPrompt, history);
}

export async function chatStream(
  config: ModelConfig,
  systemPrompt: string,
  userPrompt: string,
  history: Message[],
  onToken: (token: string) => void,
): Promise<string> {
  if (config.provider === 'anthropic') {
    return streamAnthropic(config, systemPrompt, userPrompt, history, onToken);
  }
  return streamOpenAI(config, systemPrompt, userPrompt, history, onToken);
}

async function chatAnthropic(
  config: ModelConfig,
  systemPrompt: string,
  userPrompt: string,
  history: Message[],
): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    ...history.map((m): Anthropic.MessageParam => ({ role: m.role, content: m.content })),
    { role: 'user', content: userPrompt },
  ];

  const response = await getAnthropic().messages.create({
    model: config.model,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    system: systemPrompt,
    messages,
  });

  const block = response.content[0];
  if (block.type !== 'text') throw new Error(`Unexpected content block type: ${block.type}`);
  return block.text;
}

async function streamAnthropic(
  config: ModelConfig,
  systemPrompt: string,
  userPrompt: string,
  history: Message[],
  onToken: (token: string) => void,
): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    ...history.map((m): Anthropic.MessageParam => ({ role: m.role, content: m.content })),
    { role: 'user', content: userPrompt },
  ];

  const stream = getAnthropic().messages.stream({
    model: config.model,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    system: systemPrompt,
    messages,
  });

  let full = '';
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      onToken(event.delta.text);
      full += event.delta.text;
    }
  }
  return full;
}

async function chatOpenAI(
  config: ModelConfig,
  systemPrompt: string,
  userPrompt: string,
  history: Message[],
): Promise<string> {
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...history.map((m): OpenAI.ChatCompletionMessageParam => ({ role: m.role, content: m.content })),
    { role: 'user', content: userPrompt },
  ];

  const response = await getOpenAI().chat.completions.create({
    model: config.model,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    messages,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('Empty response from OpenAI');
  return content;
}

async function streamOpenAI(
  config: ModelConfig,
  systemPrompt: string,
  userPrompt: string,
  history: Message[],
  onToken: (token: string) => void,
): Promise<string> {
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...history.map((m): OpenAI.ChatCompletionMessageParam => ({ role: m.role, content: m.content })),
    { role: 'user', content: userPrompt },
  ];

  const stream = await getOpenAI().chat.completions.create({
    model: config.model,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    messages,
    stream: true,
  });

  let full = '';
  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content;
    if (token) {
      onToken(token);
      full += token;
    }
  }
  return full;
}
