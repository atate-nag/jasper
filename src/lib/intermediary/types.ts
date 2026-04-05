// LAYER B: Intermediary types — re-exported from platform
// This layer MUST NOT import from product/

export type {
  CommunicativeIntent,
  ChallengeReadiness,
  ConversationalPhase,
  PostureClass,
  ResponseLength,
  RelationalDepth,
  ModelTier,
  ResponseDirective,
  Policy,
  PolicyReference,
  ModelConfig,
  SteeringResult,
  SteeringAnalytics,
  ConversationState,
  ProductIdentity,
  PromptComponent,
  Thread,
} from '@/lib/platform/types';
