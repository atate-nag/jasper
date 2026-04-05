// Conversation state tracker — detects when conversations develop genuine momentum
// and shifts from user-centric to conversation-centric mode.

import type { ResponseDirective } from '@/lib/platform/types';

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

export function initialConversationState(): ConversationState {
  return {
    activeThreads: [],
    threadDepth: 0,
    topicShiftInitiator: null,
    conceptualBuilding: false,
    crossDomainConnection: false,
    energyTrajectory: 'stable',
    metaConversationalAwareness: false,
    conversationDevelopmentMode: false,
    turnsInMode: 0,
    entryReason: null,
    recentArousal: [],
    lastArousal: 0,
    witClusterActive: false,
    witClusterTurnsRemaining: 0,
    relationshipTurnCount: 0,
    relationshipInterventionFired: false,
  };
}

const LAUGHTER_PATTERNS = /\b(ha|haha|hahaha|lol|lmao|rofl|funny|hilarious|made me laugh|crack(?:ing|ed) (?:me )?up|😂|🤣)\b/i;

export function detectLaughter(message: string): boolean {
  return LAUGHTER_PATTERNS.test(message);
}

export function activateWitCluster(state: ConversationState): ConversationState {
  return {
    ...state,
    witClusterActive: true,
    witClusterTurnsRemaining: 4,
  };
}

function detectMetaAwareness(message: string): boolean {
  return /\b(this conversation|what we're (doing|building|exploring)|we're onto something|this feels (important|significant|different)|where (are we|is this) going)\b/i.test(message);
}

function computeEnergyTrajectory(
  recentArousal: number[],
  currentArousal: number,
): 'rising' | 'stable' | 'falling' {
  if (recentArousal.length < 2) return 'stable';
  const recent = recentArousal.slice(-3);
  const avg = recent.reduce((s, v) => s + v, 0) / recent.length;
  const diff = currentArousal - avg;
  if (diff > 0.1) return 'rising';
  if (diff < -0.1) return 'falling';
  return 'stable';
}

export function updateConversationState(
  currentState: ConversationState,
  directive: ResponseDirective,
  userMessage: string,
  turnNumber: number,
): ConversationState {
  const updated = { ...currentState };
  updated.recentArousal = [...currentState.recentArousal.slice(-5), directive.emotionalArousal];
  updated.lastArousal = directive.emotionalArousal;

  // Track threads — use classifier's conversational phase as signal
  if (directive.conversationalPhase === 'topic_initiation') {
    // New topic
    const topic = directive.rationale.slice(0, 50);
    updated.activeThreads = [
      ...currentState.activeThreads.slice(-3), // keep last 3 threads
      { topic, startTurn: turnNumber, turnCount: 1, depthLevel: 'surface' },
    ];
    updated.topicShiftInitiator = 'user';
  } else if (directive.conversationalPhase === 'development' && updated.activeThreads.length > 0) {
    // Continue current thread
    const current = { ...updated.activeThreads[updated.activeThreads.length - 1] };
    current.turnCount++;
    current.depthLevel = current.turnCount >= 5 ? 'deep' : current.turnCount >= 3 ? 'developing' : 'surface';
    updated.activeThreads = [...updated.activeThreads.slice(0, -1), current];
    updated.topicShiftInitiator = null;
  }

  updated.threadDepth = Math.max(0, ...updated.activeThreads.map(t => t.turnCount));

  // Detect conceptual building
  updated.conceptualBuilding =
    directive.conversationalPhase === 'development' &&
    directive.emotionalArousal >= (currentState.lastArousal || 0) - 0.1;

  // Detect cross-domain connection
  updated.crossDomainConnection =
    directive.recallTriggered &&
    directive.recallTier !== 'none' &&
    currentState.activeThreads.length > 1;

  // Energy trajectory
  updated.energyTrajectory = computeEnergyTrajectory(
    currentState.recentArousal,
    directive.emotionalArousal,
  );

  // Meta-conversational awareness
  updated.metaConversationalAwareness = detectMetaAwareness(userMessage);

  // Entry conditions for conversation-development mode
  if (!updated.conversationDevelopmentMode) {
    const entrySignals = [
      updated.threadDepth >= 5,
      updated.conceptualBuilding,
      updated.crossDomainConnection,
      updated.energyTrajectory === 'rising',
      updated.metaConversationalAwareness,
    ].filter(Boolean).length;

    if (entrySignals >= 3) {
      updated.conversationDevelopmentMode = true;
      updated.turnsInMode = 0;
      const reasons: string[] = [];
      if (updated.threadDepth >= 5) reasons.push(`thread_depth=${updated.threadDepth}`);
      if (updated.conceptualBuilding) reasons.push('building');
      if (updated.crossDomainConnection) reasons.push('cross_domain');
      if (updated.energyTrajectory === 'rising') reasons.push('energy_rising');
      if (updated.metaConversationalAwareness) reasons.push('meta_aware');
      updated.entryReason = reasons.join(' + ');
    }
  }

  // Wit cluster decay
  if (updated.witClusterActive) {
    updated.witClusterTurnsRemaining = currentState.witClusterTurnsRemaining - 1;
    if (updated.witClusterTurnsRemaining <= 0) {
      updated.witClusterActive = false;
      updated.witClusterTurnsRemaining = 0;
    }
  }

  // Exit conditions
  if (updated.conversationDevelopmentMode) {
    updated.turnsInMode++;

    const exitSignals = [
      directive.communicativeIntent === 'connecting' && directive.emotionalArousal < 0.3,
      updated.energyTrajectory === 'falling',
      directive.recommendedResponseLength === 'minimal',
      userMessage.length < 20 && !updated.metaConversationalAwareness,
    ].filter(Boolean).length;

    if (exitSignals >= 2) {
      updated.conversationDevelopmentMode = false;
      updated.turnsInMode = 0;
      updated.entryReason = null;
    }
  }

  return updated;
}
