export interface ProviderModelConfig {
  provider: 'anthropic' | 'openai';
  model: string;
  maxTokens: number;
  defaultTemperature: number;
}

export interface ModelRouting {
  ambient: ProviderModelConfig;
  standard: ProviderModelConfig;
  deep: ProviderModelConfig;
  depthScoring: ProviderModelConfig;
  summary: ProviderModelConfig;
  segmentExtraction: ProviderModelConfig;
  opener: ProviderModelConfig;
  classification: ProviderModelConfig;
}

const DEFAULT_ROUTING: ModelRouting = {
  ambient: {
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 2000,
    defaultTemperature: 0.7,
  },
  standard: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    maxTokens: 2000,
    defaultTemperature: 0.7,
  },
  deep: {
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    maxTokens: 2000,
    defaultTemperature: 0.7,
  },
  depthScoring: {
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    maxTokens: 200,
    defaultTemperature: 0.3,
  },
  summary: {
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    maxTokens: 1000,
    defaultTemperature: 0.3,
  },
  segmentExtraction: {
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    maxTokens: 2000,
    defaultTemperature: 0.3,
  },
  opener: {
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 100,
    defaultTemperature: 0.7,
  },
  classification: {
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 512,
    defaultTemperature: 0,
  },
};

const MIXED_ROUTING: ModelRouting = {
  ...DEFAULT_ROUTING,
  ambient: {
    provider: 'openai',
    model: 'gpt-5.4-mini',
    maxTokens: 2000,
    defaultTemperature: 0.7,
  },
  deep: {
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    maxTokens: 2000,
    defaultTemperature: 0.7,
  },
  opener: {
    provider: 'openai',
    model: 'gpt-5.4-mini',
    maxTokens: 100,
    defaultTemperature: 0.7,
  },
};

// Fallback: use 4.5 models when 4.6 is overloaded
const FALLBACK_ROUTING: ModelRouting = {
  ...DEFAULT_ROUTING,
  standard: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    maxTokens: 2000,
    defaultTemperature: 0.7,
  },
  deep: {
    provider: 'anthropic',
    model: 'claude-opus-4-5',
    maxTokens: 2000,
    defaultTemperature: 0.7,
  },
  depthScoring: {
    provider: 'anthropic',
    model: 'claude-opus-4-5',
    maxTokens: 200,
    defaultTemperature: 0.3,
  },
  summary: {
    provider: 'anthropic',
    model: 'claude-opus-4-5',
    maxTokens: 1000,
    defaultTemperature: 0.3,
  },
  segmentExtraction: {
    provider: 'anthropic',
    model: 'claude-opus-4-5',
    maxTokens: 2000,
    defaultTemperature: 0.3,
  },
};

const ROUTING_MAP: Record<string, ModelRouting> = {
  default: DEFAULT_ROUTING,
  mixed: MIXED_ROUTING,
  fallback: FALLBACK_ROUTING,
};

let _activeRouting: ModelRouting | null = null;

export function getModelRouting(): ModelRouting {
  if (!_activeRouting) {
    const routingName = process.env.MODEL_ROUTING || 'default';
    _activeRouting = ROUTING_MAP[routingName] || DEFAULT_ROUTING;
    console.log(`[models] Using ${routingName} routing`);
  }
  return _activeRouting;
}

export function getModelForTier(tier: 'ambient' | 'standard' | 'deep'): ProviderModelConfig {
  return getModelRouting()[tier];
}
