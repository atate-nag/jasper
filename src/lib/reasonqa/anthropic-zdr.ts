// ReasonQA Anthropic client with Zero Data Retention.
// ZDR ensures Anthropic does not log or retain document content.
// This is mandatory for a legal product handling privileged documents.

import Anthropic from '@anthropic-ai/sdk';

let _client: Anthropic | null = null;

export function getAnthropicZDR(): Anthropic {
  if (!_client) {
    // ZDR is enabled at the API key level or via the Anthropic dashboard,
    // not via a beta header. The header was removed in recent API versions.
    // Ensure your Anthropic workspace has "Zero Data Retention" enabled in
    // Settings → Data Retention.
    _client = new Anthropic();
  }
  return _client;
}
