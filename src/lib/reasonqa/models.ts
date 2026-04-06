import type { ProviderModelConfig } from '@/lib/config/models';

/** Sonnet for Pass 1 (node extraction) and Pass 2 (edge construction). */
export const REASONQA_SONNET: ProviderModelConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  maxTokens: 16000,
  defaultTemperature: 0.2,
};

/** Opus for Pass 3 (verification) — accuracy matters most here. */
export const REASONQA_OPUS: ProviderModelConfig = {
  provider: 'anthropic',
  model: 'claude-opus-4-6',
  maxTokens: 16000,
  defaultTemperature: 0.2,
};

/** Haiku for lightweight classification tasks (citation treatment). */
export const REASONQA_HAIKU: ProviderModelConfig = {
  provider: 'anthropic',
  model: 'claude-haiku-4-5-20251001',
  maxTokens: 300,
  defaultTemperature: 0.1,
};
