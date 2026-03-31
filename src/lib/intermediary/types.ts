// LAYER B: Intermediary types
// This layer MUST NOT import from product/

import type { ConversationState } from './conversation-tracker';

export type CommunicativeIntent =
  | 'sharing' | 'venting' | 'sense_making'
  | 'requesting_input' | 'requesting_action'
  | 'connecting' | 'distress';

export type ChallengeReadiness =
  | 'pre_contemplation' | 'contemplation' | 'preparation' | 'action';

export type ConversationalPhase =
  | 'opening' | 'topic_initiation' | 'development' | 'potential_shift' | 'closing';

export type PostureClass =
  | 'warm_reflective' | 'exploratory' | 'analytical' | 'challenging' | 'minimal' | 'playful';

export type ResponseLength = 'minimal' | 'short' | 'medium' | 'long';

export type RelationalDepth = 'first_encounter' | 'early' | 'developing' | 'established';

export type ModelTier = 'ambient' | 'standard' | 'deep';

export interface ResponseDirective {
  communicativeIntent: CommunicativeIntent;
  emotionalValence: number;
  emotionalArousal: number;
  challengeReadiness: ChallengeReadiness;
  conversationalPhase: ConversationalPhase;
  recallTriggered: boolean;
  recallQuery: string | null;
  recallTier: 'deep' | 'shallow' | 'none';
  recallSignals: string[];
  recommendedPostureClass: PostureClass;
  recommendedResponseLength: ResponseLength;
  challengeAppropriate: boolean;
  dispreferred: boolean;
  confidence: number;
  rationale: string;
  communicationStyle: {
    verbosity: 'terse' | 'moderate' | 'verbose';
    formality: 'casual' | 'moderate' | 'formal';
    humourPresent: boolean;
    disclosureLevel: 'none' | 'light' | 'substantive';
    energy: 'low' | 'moderate' | 'high';
  };
}

export interface Policy {
  id: string;
  name: string;
  posture_class: string;
  relational_depth_range: string[];
  system_prompt_fragment: string;
  response_structure: {
    opening_move: string;
    development_approach: string;
    closing_move: string;
    dispreferred: boolean;
    dispreferred_steps?: string;
  };
  constraints: {
    max_length: string;
    reflection_minimum: boolean;
    challenge_permitted: boolean;
    humour_permitted: boolean;
  };
  conversation_aware?: boolean;
}

export interface PolicyReference {
  id: string;
  name: string;
  posture_class: string;
}

export interface ModelConfig {
  tier: ModelTier;
  provider: 'anthropic' | 'openai';
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface SteeringResult {
  systemPrompt: string;
  reformulatedMessage: string;
  modelConfig: ModelConfig;
  responseDirective: ResponseDirective;
  selectedPolicy: PolicyReference;
  recallTriggered: boolean;
  postResponseActions: {
    classifyProfile: boolean;
    extractMemories: boolean;
    logTurn: boolean;
  };
  conversationState: ConversationState;
  analytics?: {
    promptComponents: Record<string, number>;
    recallSegmentsReturned: number;
    recallTopSimilarity: number | null;
    depthConsumed: boolean;
    relationalConsumed: boolean;
    careContextInjected: boolean;
    distressOverride: boolean;
    correctionDetected: boolean;
    disclosureDepth: number;
    userInitiatedTopic: boolean;
    laughterDetected: boolean;
    relationshipContextActive: boolean;
    relationshipTurnCount: number;
  };
}

export type { ConversationState } from './conversation-tracker';

export interface ProductIdentity {
  name: string;
  identityPrompt: string;
  obligations: string;
  antiLabellingRule: string;
}
