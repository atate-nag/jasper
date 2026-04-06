// Platform steering engine — generic orchestrator that accepts a ProductConfig
// to produce product-specific steering results without hardcoded product logic.

import type { PersonContext } from '@/lib/backbone/types';
import type { Message } from '@/types/message';
import { recall } from '@/lib/backbone/recall';
import type { RecallRequest } from '@/lib/backbone/recall';
import type {
  ProductIdentity,
  ProductConfig,
  SteeringResult,
  ResponseDirective,
  ModelConfig,
  ModelTier,
  Policy,
  ConversationState,
  PromptComponent,
} from './types';
import {
  updateConversationState,
  initialConversationState,
  detectLaughter,
  activateWitCluster,
} from './conversation-tracker';
import { classify } from './classifier';
import { selectPolicy } from './policy-selector';
import { loadPolicies } from './policy-loader';
import { assemblePrompt } from './prompt-assembler';
import { reformulate } from './reformulator';
import { validate } from './validation';
import { consumePendingDepth, type PendingDepth } from './pending-depth';
import { consumePendingConnection } from './pending-connection';
import { getModelRouting } from '@/lib/config/models';

function defaultModelRouting(
  tier: ModelTier,
  personContext: PersonContext,
): ModelConfig {
  const routing = getModelRouting();
  const providerConfig = routing[tier];

  const SAFETY_CAP = 2000;
  const maxTokens = Math.min(providerConfig.maxTokens, SAFETY_CAP);

  const tempRanges: Record<ModelTier, [number, number]> = {
    ambient: [0.7, 1.0],
    standard: [0.6, 0.95],
    deep: [0.5, 0.8],
  };
  const [min, max] = tempRanges[tier];
  let temperature = min + Math.random() * (max - min);

  // Cap temperature for shallow relationships
  const relDepth = personContext.relationshipMeta.conversationCount;
  if (relDepth <= 1) {
    temperature = Math.min(temperature, 0.7);
  } else if (relDepth <= 5) {
    temperature = Math.min(temperature, 0.8);
  }

  return {
    tier,
    provider: providerConfig.provider,
    model: providerConfig.model,
    temperature: Math.round(temperature * 100) / 100,
    maxTokens,
  };
}

function determineModelConfig(
  directive: ResponseDirective,
  personContext: PersonContext,
  userMessage: string,
  config: ProductConfig,
): ModelConfig {
  // Start with standard tier
  let tier: ModelTier = 'standard';

  // Let product override the tier
  const overrides = config.routingOverrides?.(directive, personContext, userMessage);
  if (overrides?.tier) {
    tier = overrides.tier;
  }

  // Relational feedback — bump ambient to standard if feedback detected
  if (userMessage && tier === 'ambient' && config.feedbackPattern.test(userMessage)) {
    tier = 'standard';
    console.log('[model] Relational feedback detected — bumping to standard');
  }

  return defaultModelRouting(tier, personContext);
}

export async function steer(
  userMessage: string,
  personContext: PersonContext,
  productIdentity: ProductIdentity,
  sessionHistory: Message[],
  config: ProductConfig,
  previousDirective?: ResponseDirective,
  previousConversationState?: ConversationState,
  options?: { voiceMode?: boolean },
): Promise<SteeringResult> {
  // ── Fast path: trivial greetings ──────────────────────────────
  if (config.trivialGreetingPattern &&
      config.trivialGreetingPattern.test(userMessage.trim()) &&
      sessionHistory.length === 0) {
    const defaultDirective: ResponseDirective = {
      communicativeIntent: 'connecting',
      emotionalValence: 0.3,
      emotionalArousal: 0.2,
      challengeReadiness: 'contemplation',
      conversationalPhase: 'opening',
      recallTriggered: false,
      recallQuery: null,
      recallTier: 'none',
      recallSignals: [],
      recommendedPostureClass: 'minimal',
      recommendedResponseLength: 'short',
      challengeAppropriate: false,
      dispreferred: false,
      confidence: 0.95,
      rationale: 'Trivial greeting — fast path, no classification needed',
      communicationStyle: {
        verbosity: 'terse',
        formality: 'casual',
        humourPresent: false,
        disclosureLevel: 'none',
        energy: 'moderate',
      },
    };

    const policies = loadPolicies(config.policyDir);
    const policy = selectPolicy(defaultDirective, personContext, policies, undefined, undefined, config.policySelectionOverrides);
    const components = config.buildPromptComponents({
      productIdentity, personContext, policy, directive: defaultDirective,
      sessionHistory, voiceMode: false,
    });
    const { prompt: systemPrompt } = assemblePrompt(components);
    const reformulatedMessage = reformulate(userMessage, personContext, policy, defaultDirective);
    const modelConfig = determineModelConfig(defaultDirective, personContext, userMessage, config);
    const conversationState = initialConversationState();

    return {
      systemPrompt,
      reformulatedMessage,
      modelConfig,
      responseDirective: defaultDirective,
      selectedPolicy: { id: policy.id, name: policy.name, posture_class: policy.posture_class },
      recallTriggered: false,
      postResponseActions: { classifyProfile: false, extractMemories: false, logTurn: true },
      conversationState,
    };
  }

  // ── Main path ─────────────────────────────────────────────────

  // Check for pending depth thread and relational connection from previous turn
  const turnNumber = sessionHistory.filter(m => m.role === 'user').length;
  const pendingDepth: PendingDepth | null = consumePendingDepth(personContext.profile.user_id, turnNumber);
  const pendingConnection = consumePendingConnection(personContext.profile.user_id, turnNumber);

  // 1. Classify
  const rawDirective = await classify(userMessage, personContext, sessionHistory, previousDirective);

  // 2. Validate (guardrails only)
  const directive = validate(rawDirective, userMessage);

  // 2.5 Update conversation state
  let conversationState = updateConversationState(
    previousConversationState || initialConversationState(),
    directive,
    userMessage,
    sessionHistory.filter(m => m.role === 'user').length,
  );

  // 2.6 Relationship context tracking
  const { detectRelationshipContext, updateRelationshipTurnCount } = await import('./relationship-safety');
  const relationshipContextActive = detectRelationshipContext(userMessage, sessionHistory);
  conversationState = updateRelationshipTurnCount(conversationState, relationshipContextActive);

  // 3. Handle recall trigger
  let enrichedPersonContext = personContext;
  const rc = config.recallConfig;
  if (directive.recallTriggered && directive.recallTier !== 'none') {
    try {
      const isDeep = directive.recallTier === 'deep';
      const recallRequest: RecallRequest = {
        query: directive.recallQuery || userMessage,
        userId: personContext.profile.user_id,
        maxSegments: isDeep ? (rc?.deepMaxSegments ?? 5) : (rc?.shallowMaxSegments ?? 2),
        recencyBias: isDeep ? (rc?.deepRecencyBias ?? 0.2) : (rc?.shallowRecencyBias ?? 0.6),
        importanceFloor: isDeep ? (rc?.deepImportanceFloor ?? 3) : (rc?.shallowImportanceFloor ?? 5),
        includeEmotionalContext: true,
        product: config.name.toLowerCase(),
      };

      console.log(`[steer] Recall request: userId=${recallRequest.userId}, query="${recallRequest.query}", maxSegments=${recallRequest.maxSegments}`);
      const recallResult = await recall(recallRequest);
      console.log(`[steer] Recall returned ${recallResult.segments.length} segments in ${recallResult.queryLatencyMs}ms`);

      enrichedPersonContext = {
        ...personContext,
        recalledSegments: recallResult.segments.map(s => ({
          conversationId: s.conversationId,
          segmentText: s.content,
          segmentType: s.segmentType,
          conversationDate: s.conversationDate.toISOString(),
        })),
      };

      // Tier 3: pull raw source turns for deep recall with specific-detail requests
      if (isDeep && recallResult.segments.length > 0) {
        const { getSourceTurns } = await import('@/lib/backbone/recall');
        const wantsDetail = /\b(exactly|specifically|what did (i|you) say|verbatim|word for word|actual)\b/i.test(userMessage);
        if (wantsDetail) {
          for (const seg of recallResult.segments.slice(0, 2)) {
            if (seg.conversationId) {
              try {
                const turns = await getSourceTurns(seg.conversationId);
                seg.sourceTurns = turns.slice(-10);
              } catch { /* non-critical */ }
            }
          }
        }
      }
    } catch (err) {
      console.error('[steer] Recall failed:', err);
    }
  }

  // 3.5 Detect laughter → activate wit cluster
  let witConversationState = conversationState;
  if (detectLaughter(userMessage)) {
    witConversationState = activateWitCluster(witConversationState);
    console.log('[wit] Laughter detected in user message — wit cluster activated (4 turns)');
  }

  // 4. Load and select policy
  const policies = loadPolicies(config.policyDir);
  const policy = selectPolicy(
    directive,
    enrichedPersonContext,
    policies,
    witConversationState,
    undefined,
    config.policySelectionOverrides,
  );

  // 4.5 Proactive recall at session start
  let sessionStartRecall: string | null = null;
  const isFirstTurn = sessionHistory.filter(m => m.role === 'user').length <= 1;
  const isReturningUser = enrichedPersonContext.relationshipMeta.conversationCount > 0;
  if (isFirstTurn && isReturningUser && enrichedPersonContext.recalledSegments.length === 0) {
    try {
      const name = enrichedPersonContext.profile.identity?.name || 'this person';
      const queryParts: string[] = [name];
      const concerns = enrichedPersonContext.profile.current_state?.active_concerns || [];
      if (concerns.length > 0) queryParts.push(concerns.slice(0, 2).join(', '));
      const profileData = enrichedPersonContext.profile as unknown as Record<string, unknown>;
      const threads = (profileData.relational_threads as Array<{ keywords?: string[] }>) || [];
      if (threads.length > 0) {
        const keywords = threads.slice(0, 2).flatMap(t => t.keywords?.slice(0, 2) || []);
        if (keywords.length > 0) queryParts.push(keywords.join(', '));
      }
      const relationships = enrichedPersonContext.profile.relationships || {};
      const relKeys = Object.keys(relationships).slice(0, 2);
      if (relKeys.length > 0) queryParts.push(relKeys.join(', '));
      const query = queryParts.join(', ');
      const proactiveRecall = await recall({
        query,
        userId: enrichedPersonContext.profile.user_id,
        maxSegments: rc?.proactiveMaxSegments ?? 3,
        recencyBias: rc?.proactiveRecencyBias ?? 0.4,
        importanceFloor: rc?.proactiveImportanceFloor ?? 5,
        includeEmotionalContext: true,
        product: config.name.toLowerCase(),
      });
      if (proactiveRecall.segments.length > 0) {
        const memories = proactiveRecall.segments
          .map(s => `- ${s.content}`)
          .join('\n');
        sessionStartRecall = `WHAT YOU REMEMBER ABOUT ${name.toUpperCase()} (from previous conversations — not this one):\n${memories}\n\nThese are from past sessions. Reference them naturally when relevant — not as a recap, but as the texture of knowing someone. Do not confuse these with what has been said in the current conversation.`;
      }
    } catch {
      // Non-critical — session proceeds without proactive recall
    }
  }

  // 5. Assemble prompt
  const components: PromptComponent[] = config.buildPromptComponents({
    productIdentity,
    personContext: enrichedPersonContext,
    policy,
    directive,
    sessionHistory,
    voiceMode: options?.voiceMode ?? false,
    pendingDepth,
    pendingConnection,
    sessionStartRecall,
    userMessage,
    conversationState: witConversationState,
  });
  const { prompt: systemPrompt, includedComponents, excludedComponents } = assemblePrompt(components);

  // 6. Reformulate user message
  const reformulatedMessage = reformulate(userMessage, enrichedPersonContext, policy, directive);

  // 7. Determine model config
  const modelConfig = determineModelConfig(directive, enrichedPersonContext, userMessage, config);

  // 8. Determine post-response actions
  const isSubstantive = directive.communicativeIntent !== 'connecting' &&
    directive.conversationalPhase !== 'opening' &&
    userMessage.split(/\s+/).length > 5;

  // 9. Fire background tasks
  for (const task of config.backgroundTasks ?? []) {
    if (task.shouldFire(directive, witConversationState, modelConfig.tier, enrichedPersonContext)) {
      task.run(userMessage, sessionHistory, enrichedPersonContext, witConversationState)
        .catch(err => console.error(`[${task.name}] Async error:`, err));
    }
  }

  // 10. Build analytics
  const promptComponentMap: Record<string, number> = {};
  for (const label of includedComponents) {
    const comp = components.find(c => c.label === label);
    if (comp) promptComponentMap[label] = comp.tokenEstimate;
  }

  const recallSegs = enrichedPersonContext.recalledSegments || [];
  const recallTopSim = recallSegs.length > 0 ? Math.max(...recallSegs.map(() => 0.5)) : null;

  // Disclosure depth for analytics
  const disclosureIntents: string[] = ['sharing', 'venting', 'distress'];
  const disclosureDepth = disclosureIntents.includes(directive.communicativeIntent)
    ? directive.emotionalArousal : 0;

  // User-initiated topic proxy
  const lastAssistantMsg = sessionHistory.filter(m => m.role === 'assistant').pop();
  const previousEndedWithQuestion = lastAssistantMsg ? /\?\s*$/.test(lastAssistantMsg.content) : false;
  const userInitiatedTopic = userMessage.length > 50 && !previousEndedWithQuestion;

  // Merge product-specific analytics extensions
  const extensions = config.analyticsExtensions?.(directive, userMessage, witConversationState) ?? {};

  return {
    systemPrompt,
    reformulatedMessage,
    modelConfig,
    responseDirective: directive,
    selectedPolicy: {
      id: policy.id,
      name: policy.name,
      posture_class: policy.posture_class,
    },
    recallTriggered: directive.recallTriggered,
    postResponseActions: {
      classifyProfile: isSubstantive,
      extractMemories: isSubstantive,
      logTurn: true,
    },
    conversationState: witConversationState,
    analytics: {
      promptComponents: promptComponentMap,
      recallSegmentsReturned: recallSegs.length,
      recallTopSimilarity: recallTopSim,
      depthConsumed: !!pendingDepth,
      relationalConsumed: !!pendingConnection,
      disclosureDepth,
      userInitiatedTopic,
      relationshipContextActive,
      relationshipTurnCount: witConversationState.relationshipTurnCount,
      // Product extensions merged in
      careContextInjected: false,
      distressOverride: false,
      correctionDetected: false,
      laughterDetected: false,
      ...extensions,
    },
  };
}
