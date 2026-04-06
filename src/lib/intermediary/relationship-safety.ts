// Re-exported from platform with Jasper-specific directive text.
// See src/lib/platform/relationship-safety.ts for the generic implementation.
// Directive text lives canonically in src/lib/product/jasper-config.ts.

import {
  buildRelationshipInjection as _build,
  relationshipSafetyRewrite as _rewrite,
} from '@/lib/platform/relationship-safety';
import {
  JASPER_RELATIONSHIP_MODE_DIRECTIVE,
  JASPER_SELF_AWARE_INTERVENTION,
} from '@/lib/product/jasper-config';
import type { ConversationState, PromptComponent } from '@/lib/platform/types';

export { detectRelationshipContext } from '@/lib/platform/relationship-safety';
export { updateRelationshipTurnCount } from '@/lib/platform/relationship-safety';

// Backward-compatible wrapper — pre-fills Jasper's directive text
export function buildRelationshipInjection(
  state: ConversationState,
): PromptComponent[] {
  return _build(state, JASPER_RELATIONSHIP_MODE_DIRECTIVE, JASPER_SELF_AWARE_INTERVENTION);
}

// Backward-compatible wrapper — pre-fills Jasper's voice description
export async function relationshipSafetyRewrite(
  response: string,
  userName: string,
  userId?: string,
): Promise<{ text: string; rewritten: boolean; violations: string[] }> {
  return _rewrite(response, userName, 'direct, honest, warm', userId);
}
