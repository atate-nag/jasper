// ReasonQA Anthropic client routed through Vercel AI Gateway.
// ZDR is enforced globally in the AI Gateway dashboard settings.
// This ensures no document content is logged or retained by any provider.

import Anthropic from '@anthropic-ai/sdk';

let _client: Anthropic | null = null;

export function getAnthropicZDR(): Anthropic {
  if (!_client) {
    _client = new Anthropic({
      apiKey: process.env.AI_GATEWAY_API_KEY,
      baseURL: 'https://ai-gateway.vercel.sh',
    });
  }
  return _client;
}
