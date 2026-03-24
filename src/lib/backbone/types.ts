export interface Identity {
  name?: string;
  age_range?: string;
  location?: string;
  occupation?: string;
  living_situation?: string;
  neurodivergence?: string;
  [key: string]: unknown;
}

export interface Values {
  core_values?: string[];
  priorities?: string[];
  what_matters_most?: string;
  [key: string]: unknown;
}

export interface Patterns {
  stress_responses?: string[];
  decision_patterns?: string[];
  avoidance_patterns?: string[];
  growth_edges?: string[];
  [key: string]: unknown;
}

export interface Relationships {
  partner?: Record<string, unknown>;
  children?: Record<string, unknown>[];
  colleagues?: Record<string, unknown>[];
  key_dynamics?: string[];
  [key: string]: unknown;
}

export interface CurrentState {
  active_concerns?: string[];
  mood_trajectory?: string;
  recent_wins?: string[];
  open_questions?: string[];
  [key: string]: unknown;
}

export interface InteractionPrefs {
  directness_preference?: string;
  humour_receptivity?: string;
  challenge_tolerance?: string;
  [key: string]: unknown;
}

export interface UserProfile {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  identity: Identity;
  values: Values;
  patterns: Patterns;
  relationships: Relationships;
  current_state: CurrentState;
  interaction_prefs: InteractionPrefs;
}

export type UserProfileUpdate = Partial<
  Pick<UserProfile, 'identity' | 'values' | 'patterns' | 'relationships' | 'current_state' | 'interaction_prefs'>
>;

export interface Memory {
  id?: string;
  memory: string;
  score?: number;
}

export interface ConversationRecord {
  id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  messages: import('@/types/message').Message[];
  classification: Record<string, unknown>;
  summary: string | null;
  ending_state?: Record<string, unknown>;
  exchange_count: number;
}

export interface ConversationSummary {
  id: string;
  summary: string | null;
  started_at: string;
  ended_at: string | null;
}

export interface ConversationSegment {
  conversationId: string;
  segmentText: string;
  segmentType?: string;
  turnRange?: [number, number];
  conversationDate: string;
  sourceTurns?: import('@/types/message').Message[];
}

export interface RelationshipMeta {
  conversationCount: number;
  firstConversationDate: string | null;
  lastConversationDate: string | null;
  totalMessages: number;
}

export interface PersonContext {
  profile: UserProfile;
  memories: Memory[];
  recentConversations: ConversationSummary[];
  recalledSegments: ConversationSegment[];
  currentSession: {
    messages: import('@/types/message').Message[];
    startedAt: Date;
  };
  relationshipMeta: RelationshipMeta;
  calibration?: CalibrationParameters;
  selfObservations?: SelfObservation[];
}

export interface CommunicationStyle {
  verbosity: 'terse' | 'moderate' | 'verbose';
  formality: 'casual' | 'moderate' | 'formal';
  humourPresent: boolean;
  disclosureLevel: 'none' | 'light' | 'substantive';
  energy: 'low' | 'moderate' | 'high';
}

export interface CalibrationSignals {
  humourInstances: number;
  challengeEngaged: number;
  challengeDeflected: number;
  correctionsGiven: number;
  unpromptedDisclosures: number;
  sessionsCompleted: number;
  sessionsAbandoned: number;
  averageTurnsPerSession: number;
  registersSustained: Record<string, number>;
}

export interface CalibrationParameters {
  challengeCeiling: number;      // Beta mean 0-1
  challengeAlpha: number;        // Beta distribution alpha
  challengeBeta: number;         // Beta distribution beta
  humourTolerance: number;       // Beta mean 0-1
  humourAlpha: number;
  humourBeta: number;
  directnessPreference: number;  // Beta mean 0-1
  directnessAlpha: number;
  directnessBeta: number;
  disclosureComfort: number;     // Beta mean 0-1
  disclosureAlpha: number;
  disclosureBeta: number;
  warmthNeed: number;            // Beta mean 0-1
  warmthAlpha: number;
  warmthBeta: number;
  preferredRegister: string;
  onboardingCompleted: boolean;
  voicePreference: 'male' | 'female' | null;
}

export interface PatternNote {
  metaheuristic: string;
  observation: string;
  evidence: string[];
  severity: 'note' | 'flag' | 'concern';
}

export interface Adaptation {
  parameter: string;
  direction: 'increase' | 'decrease' | 'diversify' | 'sustain';
  rationale: string;
}

export interface SelfObservation {
  timestamp: string;
  sessionId: string;
  patternsNoted: PatternNote[];
  adaptationsRecommended: Adaptation[];
  injected: boolean;
}
