// Platform types — shared across all product shells.
// Products implement ProductConfig to plug into the shared steering engine.

import type { PersonContext, UserProfile } from '@/lib/backbone/types';
import type { Message } from '@/types/message';
import type { ProviderModelConfig } from '@/lib/config/models';

// ── Re-export generic types from intermediary ─────────────────
// These are the stable contracts between layers. They originate here
// in the platform and are re-exported by intermediary for backward compat.

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

export interface ProductIdentity {
  name: string;
  identityPrompt: string;
  obligations: string;
  antiLabellingRule: string;
}

export interface PromptComponent {
  priority: number;
  content: string;
  label: string;
  tokenEstimate: number;
}

// ── Conversation State (re-exported, canonical definition stays in conversation-tracker) ──

export interface Thread {
  topic: string;
  startTurn: number;
  turnCount: number;
  depthLevel: 'surface' | 'developing' | 'deep';
}

export interface ConversationState {
  activeThreads: Thread[];
  threadDepth: number;
  topicShiftInitiator: 'user' | 'system' | null;
  conceptualBuilding: boolean;
  crossDomainConnection: boolean;
  energyTrajectory: 'rising' | 'stable' | 'falling';
  metaConversationalAwareness: boolean;
  conversationDevelopmentMode: boolean;
  turnsInMode: number;
  entryReason: string | null;
  recentArousal: number[];
  lastArousal: number;
  witClusterActive: boolean;
  witClusterTurnsRemaining: number;
  relationshipTurnCount: number;
  relationshipInterventionFired: boolean;
}

// ── Steering Result ───────────────────────────────────────────

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
  analytics?: SteeringAnalytics;
}

export interface SteeringAnalytics {
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
}

// ── ProductConfig — the contract a product shell implements ───

export interface Guard {
  name: string;
  check: (
    text: string,
    context: {
      userMessage: string;
      conversationState: ConversationState;
      personContext: PersonContext;
      sessionHistory: Message[];
    },
  ) => Promise<GuardResult>;
}

export interface GuardResult {
  pass: boolean;
  rewrite?: string;
  block?: boolean;
  fallbackResponse?: string;
  violations?: string[];
}

export interface BackgroundTaskConfig {
  name: string;
  shouldFire: (
    directive: ResponseDirective,
    conversationState: ConversationState,
    modelTier: string,
    personContext: PersonContext,
  ) => boolean;
  run: (
    userMessage: string,
    sessionHistory: Message[],
    personContext: PersonContext,
    conversationState: ConversationState,
  ) => Promise<void>;
}

export type PolicySelectionOverride = (
  postureClass: PostureClass,
  directive: ResponseDirective,
  context: {
    relationalDepth: RelationalDepth;
    conversationState: ConversationState;
    careContextActive: boolean;
  },
) => PostureClass | null;

export interface PromptComponentContext {
  productIdentity: ProductIdentity;
  personContext: PersonContext;
  policy: Policy;
  directive: ResponseDirective;
  sessionHistory: Message[];
  voiceMode: boolean;
  pendingDepth?: { thread: string; dimension: string; score: number } | null;
  pendingConnection?: { thread: string; connection: string } | null;
  sessionStartRecall?: string | null;
  userMessage?: string;
  conversationState?: ConversationState;
}

export interface RecallConfig {
  deepMaxSegments?: number;
  shallowMaxSegments?: number;
  deepRecencyBias?: number;
  shallowRecencyBias?: number;
  deepImportanceFloor?: number;
  shallowImportanceFloor?: number;
  proactiveRecencyBias?: number;
  proactiveImportanceFloor?: number;
  proactiveMaxSegments?: number;
}

export interface ProductConfig {
  // Product identity
  name: string;

  // Feedback detection — regex for "you're being cold/abrupt/etc"
  feedbackPattern: RegExp;

  // Classification — optional override of default classifier prompt
  classifierPrompt?: string;

  // Policies
  policyDir: string;
  policySelectionOverrides?: PolicySelectionOverride[];

  // Prompt assembly — product builds its own component list
  buildPromptComponents: (ctx: PromptComponentContext) => PromptComponent[];

  // Model routing — optional overrides
  routingOverrides?: (
    directive: ResponseDirective,
    personContext: PersonContext,
    userMessage: string,
  ) => Partial<ModelConfig> | null;

  // Guards
  preGenerationGuards?: Guard[];
  postGenerationGuards?: Guard[];

  // Session lifecycle
  onSessionEnd?: (
    userId: string,
    conversationId: string | null,
    messages: Message[],
  ) => Promise<void>;

  // Background tasks
  backgroundTasks?: BackgroundTaskConfig[];

  // Analytics extensions
  analyticsExtensions?: (
    directive: ResponseDirective,
    userMessage: string,
    conversationState: ConversationState,
  ) => Record<string, unknown>;

  // Fast path — trivial greetings that skip classification
  trivialGreetingPattern?: RegExp;

  // Recall configuration
  recallConfig?: RecallConfig;

  // Reformulator extensions
  reformulatorExtensions?: (
    parts: string[],
    context: {
      userMessage: string;
      personContext: PersonContext;
      policy: Policy;
      directive: ResponseDirective;
    },
  ) => string[];
}
