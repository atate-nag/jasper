// ReasonQA Anthropic client — routes through Vercel AI Gateway when
// AI_GATEWAY_API_KEY is set, otherwise falls back to direct Anthropic API.
// ZDR is enforced globally in the AI Gateway dashboard settings.

import Anthropic from '@anthropic-ai/sdk';

let _client: Anthropic | null = null;

export function getAnthropicZDR(): Anthropic {
  if (!_client) {
    const gatewayKey = process.env.AI_GATEWAY_API_KEY;
    if (gatewayKey) {
      console.log('[reasonqa] Using Vercel AI Gateway');
      _client = new Anthropic({
        apiKey: gatewayKey,
        baseURL: 'https://ai-gateway.vercel.sh',
      });
    } else {
      console.log('[reasonqa] AI_GATEWAY_API_KEY not set, using direct Anthropic API');
      _client = new Anthropic();
    }
  }
  return _client;
}
