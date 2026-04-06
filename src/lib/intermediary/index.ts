// Intermediary — Jasper-specific wiring layer.
// Imports Jasper product config and passes it to the generic platform steer().
// Route files continue importing from here with zero signature changes.

import { steer as platformSteer } from '@/lib/platform/steer';
import { JASPER_PRODUCT_CONFIG } from '@/lib/product/jasper-config';
import type { PersonContext } from '@/lib/backbone/types';
import type { Message } from '@/types/message';
import type { ProductIdentity, ResponseDirective, SteeringResult, ConversationState } from '@/lib/platform/types';

// Re-export Jasper-specific helpers for backward compat (used in route files)
export { detectDistress, messageReferencesJasper } from '@/lib/product/jasper-helpers';

// Backward-compatible steer() — injects Jasper config into the generic platform engine
export async function steer(
  userMessage: string,
  personContext: PersonContext,
  productIdentity: ProductIdentity,
  sessionHistory: Message[],
  previousDirective?: ResponseDirective,
  previousConversationState?: ConversationState,
  options?: { voiceMode?: boolean },
): Promise<SteeringResult> {
  return platformSteer(
    userMessage,
    personContext,
    productIdentity,
    sessionHistory,
    JASPER_PRODUCT_CONFIG,
    previousDirective,
    previousConversationState,
    options,
  );
}

// Re-export types for backward compat
export type { ResponseDirective, SteeringResult, ProductIdentity, ModelConfig, Policy } from '@/lib/platform/types';
