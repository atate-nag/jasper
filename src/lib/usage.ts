// Token usage tracking and cost calculation.

import { getSupabaseAdmin } from '@/lib/supabase';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
  provider: 'anthropic' | 'openai';
}

// Pricing per 1M tokens (USD) — updated March 2026
const PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  'claude-opus-4-6': { input: 15, output: 75 },
  'claude-opus-4-5': { input: 15, output: 75 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4 },
  // OpenAI
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
  'tts-1': { input: 15, output: 0 }, // TTS is $15/1M chars, tracked as "input"
  'whisper-1': { input: 0.006, output: 0 }, // $0.006/min, approximated
};

export function calculateCost(usage: TokenUsage): number {
  const pricing = PRICING[usage.model];
  if (!pricing) {
    console.warn(`[usage] No pricing for model: ${usage.model}`);
    return 0;
  }
  return (usage.inputTokens * pricing.input + usage.outputTokens * pricing.output) / 1_000_000;
}

export function logUsage(
  usage: TokenUsage,
  purpose: string,
  userId?: string,
  conversationId?: string | null,
  latencyMs?: number,
): void {
  const cost = calculateCost(usage);

  // Fire and forget — don't block on logging
  getSupabaseAdmin().from('token_usage').insert({
    user_id: userId || null,
    conversation_id: conversationId || null,
    purpose,
    model: usage.model,
    provider: usage.provider,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cost_usd: Math.round(cost * 1_000_000) / 1_000_000, // 6 decimal places
    latency_ms: latencyMs || null,
  }).then(({ error }) => {
    if (error) console.error('[usage] Failed to log:', error.message);
  });
}
