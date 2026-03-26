// LAYER B: Intermediary — Steering Engine
// This layer MUST NOT import from product/

import type { PersonContext } from '@/lib/backbone/types';
import type { Message } from '@/types/message';
import { recall } from '@/lib/backbone/recall';
import type { RecallRequest } from '@/lib/backbone/recall';
import type { ProductIdentity, SteeringResult, ResponseDirective, ModelConfig, Policy } from './types';
import { updateConversationState, initialConversationState, type ConversationState } from './conversation-tracker';
import { classify } from './classifier';
import { selectPolicy } from './policy-selector';
import { loadPolicies } from './policy-loader';
import { assemblePrompt, type PromptComponent } from './prompt-assembler';
import { reformulate } from './reformulator';
import { validate } from './validation';
import { antiSycophancyReinjection } from './sycophancy';
import { scoreDepth } from './depth-scoring';
import { storePendingDepth, consumePendingDepth, type PendingDepth } from './pending-depth';
import { DEPTH_EVAL_CONFIG } from './depth-config';
import { getModelRouting } from '@/lib/config/models';

function determineModelConfig(directive: ResponseDirective, ctx: PersonContext): ModelConfig {
  const depth = ctx.relationshipMeta.conversationCount > 15 ? 'established' : 'other';

  let tier: 'ambient' | 'standard' | 'deep' = 'standard';

  // Recall-triggered messages always get at least standard tier
  const recallBoost = directive.recallTriggered && directive.recallTier !== 'none';

  if (directive.communicativeIntent === 'distress') {
    tier = 'deep';
  } else if (directive.communicativeIntent === 'connecting' && !recallBoost) {
    tier = 'ambient';
  } else if (directive.communicativeIntent === 'requesting_input' && directive.emotionalArousal > 0.7) {
    tier = 'deep';
  } else if (directive.communicativeIntent === 'sense_making' && depth === 'established') {
    tier = 'deep';
  }

  // Get provider config from routing
  const routing = getModelRouting();
  const providerConfig = routing[tier];

  let maxTokens = providerConfig.maxTokens;

  // Length guidance is handled by the identity prompt ("keep it short").
  // Hard caps here are only a safety net against truly runaway generation.
  // They should NEVER truncate a coherent thought mid-sentence.
  const SAFETY_CAP = 2000;
  maxTokens = Math.min(maxTokens, SAFETY_CAP);

  const tempRanges = { ambient: [0.7, 1.0], standard: [0.6, 0.95], deep: [0.5, 0.8] };
  const [min, max] = tempRanges[tier];
  let temperature = min + Math.random() * (max - min);

  // Cap temperature for shallow relationships
  const relDepth = ctx.relationshipMeta.conversationCount;
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

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffHours / 24;

  if (diffHours < 1) return 'just now';
  if (diffHours < 24) return `${Math.floor(diffHours)} hours ago`;
  if (diffDays < 2) return 'yesterday';
  if (diffDays < 7) return `${Math.floor(diffDays)} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

function shouldFireDepthScoring(
  directive: ResponseDirective,
  conversationState: ConversationState,
  modelTier: string,
): boolean {
  // Don't fire on deep tier (already getting full attention) or in development mode
  if (modelTier === 'deep') return false;
  if (conversationState.conversationDevelopmentMode) return false;

  const noveltySignals = [
    directive.emotionalArousal > 0.5,
    directive.communicativeIntent === 'sense_making',
    directive.communicativeIntent === 'sharing',
    directive.communicativeIntent === 'venting',
    directive.challengeAppropriate === true,
    directive.recommendedPostureClass === 'exploratory',
    directive.recommendedPostureClass === 'analytical',
  ];

  const signalCount = noveltySignals.filter(Boolean).length;
  return signalCount >= DEPTH_EVAL_CONFIG.noveltyThreshold;
}

function buildPersonContextBlock(profile: PersonContext['profile'], conversationCount: number): string | null {
  const name = profile?.identity?.name;

  const parts: string[] = [];

  if (name) {
    parts.push(`YOU ARE TALKING TO: ${name}`);
  } else {
    parts.push('YOU ARE TALKING TO: [unknown — listen for their name]');
  }

  if (conversationCount > 0) {
    parts.push(`You have spoken ${conversationCount} time${conversationCount > 1 ? 's' : ''} before.`);
  } else {
    parts.push('This is your first conversation.');
  }

  const keyFacts: string[] = [];
  if (profile?.values?.core_values && profile.values.core_values.length > 0) {
    keyFacts.push(`Values: ${profile.values.core_values.slice(0, 3).join(', ')}`);
  }
  if (profile?.current_state?.mood_trajectory) {
    keyFacts.push(`Current mood: ${profile.current_state.mood_trajectory}`);
  }
  if (profile?.current_state?.active_concerns && profile.current_state.active_concerns.length > 0) {
    keyFacts.push(`On their mind: ${profile.current_state.active_concerns[0]}`);
  }
  if (keyFacts.length > 0) {
    parts.push(keyFacts.join('. ') + '.');
  }

  if (name) {
    parts.push(`Use ${name}'s name occasionally — at greetings, at genuine moments, at goodbyes. Not every turn. The way a friend does.`);
  }

  return parts.join('\n');
}

function buildPromptComponents(
  productIdentity: ProductIdentity,
  personContext: PersonContext,
  policy: Policy,
  directive: ResponseDirective,
  sessionHistory: Message[],
  voiceMode: boolean = false,
  pendingDepth?: PendingDepth | null,
  sessionStartRecall?: string | null,
): PromptComponent[] {
  const components: PromptComponent[] = [];
  const est = (s: string) => Math.ceil(s.split(/\s+/).length * 1.3);

  // Determine if this is a light conversation — light intents get a stripped-down prompt
  const isLightIntent = directive.communicativeIntent === 'connecting' ||
    directive.recommendedPostureClass === 'playful' ||
    directive.recommendedPostureClass === 'minimal';

  // Priority 100: Identity — use full or condensed version
  if (isLightIntent) {
    // Condensed identity for light exchanges — just character + name + key rules
    const name = personContext.profile.identity?.name;
    const condensed = `Your name is Jasper. You are direct, curious, slightly dry. You lead with substance. You keep responses short — a few sentences.${name ? ` You are talking to ${name}.` : ''} You never fabricate memories. You have full access to this conversation's history.`;
    components.push({
      priority: 100,
      content: condensed,
      label: 'identity',
      tokenEstimate: est(condensed),
    });
  } else {
    components.push({
      priority: 100,
      content: productIdentity.identityPrompt,
      label: 'identity',
      tokenEstimate: est(productIdentity.identityPrompt),
    });

    // Priority 95: Core obligations — only for substantive exchanges
    const obligations = `${productIdentity.obligations}\n\n${productIdentity.antiLabellingRule}`;
    components.push({
      priority: 95,
      content: obligations,
      label: 'obligations',
      tokenEstimate: est(obligations),
    });
  }

  // Priority 88: Person context — who you're talking to (skip for light if already in condensed identity)
  if (!isLightIntent) {
    const personBlock = buildPersonContextBlock(
      personContext.profile,
      personContext.relationshipMeta.conversationCount,
    );
    if (personBlock) {
      components.push({
        priority: 88,
        content: personBlock,
        label: 'person_context_block',
        tokenEstimate: est(personBlock),
      });
    }
  }

  // Priority 55: Session-start recall — skip for light intents
  if (sessionStartRecall && !isLightIntent) {
    components.push({
      priority: 55,
      content: sessionStartRecall,
      label: 'session_start_recall',
      tokenEstimate: est(sessionStartRecall),
    });
  }

  // Priority 90: Anti-sycophancy re-injection — skip for light intents
  if (!isLightIntent) {
    const turnCount = sessionHistory.filter(m => m.role === 'user').length;
    const reinjection = antiSycophancyReinjection(turnCount);
    if (reinjection) {
      components.push({
        priority: 90,
        content: reinjection,
        label: 'anti_sycophancy',
        tokenEstimate: est(reinjection),
      });
    }
  }

  // Priority 88: Self-observations — skip for light intents
  if (!isLightIntent && personContext.selfObservations && personContext.selfObservations.length > 0) {
    const uninjected = personContext.selfObservations.filter(obs => !obs.injected);
    if (uninjected.length > 0) {
      const obsLines = uninjected.flatMap(obs =>
        obs.patternsNoted.map(p => `- ${p.observation}`)
      );
      const adaptLines = uninjected.flatMap(obs =>
        obs.adaptationsRecommended.map(a => `- ${a.parameter}: ${a.direction} — ${a.rationale}`)
      );

      let selfObsText = `SELF-OBSERVATIONS (from your recent interaction patterns with this person):\n${obsLines.join('\n')}`;
      if (adaptLines.length > 0) {
        selfObsText += `\n\nADAPTATIONS:\n${adaptLines.join('\n')}`;
      }

      components.push({
        priority: 88,
        content: selfObsText,
        label: 'self_observations',
        tokenEstimate: est(selfObsText),
      });
    }
  }

  // Priority 85: Policy directives
  const policyContent = `RESPONSE STRATEGY: ${policy.name}\n\n${policy.system_prompt_fragment}\n\nRESPONSE STRUCTURE:\n- Opening: ${policy.response_structure.opening_move}\n- Development: ${policy.response_structure.development_approach}\n- Closing: ${policy.response_structure.closing_move}\n\nCONSTRAINTS:\n- Length: ${policy.constraints.max_length}\n- Reflection minimum: ${policy.constraints.reflection_minimum}\n- Challenge permitted: ${policy.constraints.challenge_permitted}\n- Humour permitted: ${policy.constraints.humour_permitted}`;
  components.push({
    priority: 85,
    content: policyContent,
    label: 'policy_directive',
    tokenEstimate: est(policyContent),
  });

  // Priority 80: Current state
  const now = new Date();
  const timeContext = `Current time: ${now.toLocaleTimeString()}, ${now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}`;
  components.push({
    priority: 80,
    content: timeContext,
    label: 'current_state',
    tokenEstimate: est(timeContext),
  });

  // Priority 75: Interaction preferences — skip for light intents
  if (!isLightIntent) {
    const prefs = personContext.profile.interaction_prefs;
    if (prefs && Object.keys(prefs).length > 0) {
      const prefText = `HOW THIS PERSON COMMUNICATES:\n${Object.entries(prefs).filter(([,v]) => v).map(([k,v]) => `- ${k}: ${v}`).join('\n')}`;
      components.push({
        priority: 75,
        content: prefText,
        label: 'interaction_prefs',
        tokenEstimate: est(prefText),
      });
    }
  }

  // Priority 70 (shallow) or 85 (deep): Recalled segments
  if (personContext.recalledSegments.length > 0) {
    // Format with Lost in the Middle mitigation: best first, second-best last
    const segments = [...personContext.recalledSegments];
    if (segments.length >= 3) {
      const [best, secondBest, ...rest] = segments;
      segments.length = 0;
      segments.push(best, ...rest, secondBest);
    }

    const recallLines = segments.map(s => {
      const date = new Date(s.conversationDate);
      const timeAgo = formatTimeAgo(date);
      return `[${timeAgo}, ${s.segmentType}]\n${s.segmentText}`;
    });

    const recallText = `RECALLED FROM PAST CONVERSATIONS:\n${recallLines.join('\n\n')}`;
    const isDeepRecall = directive.recallTier === 'deep';

    components.push({
      priority: isDeepRecall ? 85 : 65,
      content: recallText,
      label: 'recalled_segments',
      tokenEstimate: est(recallText),
    });
  }

  // Tier 3: Raw source turns (lower priority, expensive)
  const segmentsWithTurns = personContext.recalledSegments.filter(
    (s: { sourceTurns?: unknown[] }) => s.sourceTurns && (s.sourceTurns as unknown[]).length > 0
  );
  if (segmentsWithTurns.length > 0) {
    const turnLines = segmentsWithTurns.map((s: { segmentText?: string; conversationDate?: string; sourceTurns?: Array<{ role: string; content: string }> }) => {
      const date = s.conversationDate ? new Date(s.conversationDate) : new Date();
      const timeAgo = formatTimeAgo(date);
      const turns = (s.sourceTurns || [])
        .map((t: { role: string; content: string }) => `${t.role === 'user' ? 'User' : 'Jasper'}: ${t.content}`)
        .join('\n');
      return `[Verbatim exchange from ${timeAgo}]\n${turns}`;
    });

    const turnsText = `SOURCE CONVERSATION EXCERPTS:\n${turnLines.join('\n\n')}`;
    components.push({
      priority: 55,
      content: turnsText,
      label: 'recalled_source_turns',
      tokenEstimate: est(turnsText),
    });
  }

  // Key patterns — priority varies by intent
  const patterns = personContext.profile.patterns;
  if (patterns && Object.keys(patterns).length > 0) {
    // Determine which sections are relevant based on intent
    const isLight = directive.communicativeIntent === 'connecting' ||
      directive.recommendedPostureClass === 'playful' ||
      directive.recommendedPostureClass === 'minimal';
    const isAnalytical = directive.communicativeIntent === 'requesting_input' ||
      directive.communicativeIntent === 'sense_making';
    const isEmotional = directive.communicativeIntent === 'venting' ||
      directive.communicativeIntent === 'distress';

    if (!isLight) {
      // Only include heavy psychological sections for non-light intents
      const patternParts: string[] = [];
      // Helper: safely join array or return string as-is
      const joinField = (val: unknown): string => {
        if (Array.isArray(val)) return val.join('; ');
        if (typeof val === 'string') return val;
        return String(val);
      };

      if (patterns.growth_edges?.length) {
        patternParts.push(`Growth edges: ${joinField(patterns.growth_edges)}`);
      }
      if (patterns.stress_responses?.length && (isEmotional || isAnalytical)) {
        patternParts.push(`Stress responses: ${joinField(patterns.stress_responses)}`);
      }
      if (patterns.avoidance_patterns?.length && isAnalytical) {
        patternParts.push(`Avoidance patterns: ${joinField(patterns.avoidance_patterns)}`);
      }
      if (patterns.decision_patterns?.length && isAnalytical) {
        patternParts.push(`Decision patterns: ${joinField(patterns.decision_patterns)}`);
      }

      if (patternParts.length > 0) {
        const priority = isAnalytical ? 70 : isEmotional ? 60 : 50;
        components.push({
          priority,
          content: `KEY PATTERNS:\n${patternParts.join('\n')}`,
          label: 'key_patterns',
          tokenEstimate: est(patternParts.join('\n')),
        });
      }
    }
    // For light intents: patterns are simply not included in the prompt
  }

  // Priority 50: Profile summary — skip for light intents
  if (!isLightIntent) {
    const profileParts: string[] = [];
    const p = personContext.profile;
    if (p.identity && Object.keys(p.identity).length > 0) {
      profileParts.push(`Identity: ${Object.entries(p.identity).filter(([,v]) => v).map(([k,v]) => `${k}: ${v}`).join(', ')}`);
    }
    if (p.values?.core_values?.length) profileParts.push(`Values: ${p.values.core_values.join(', ')}`);
    if (p.relationships?.key_dynamics?.length) profileParts.push(`Key dynamics: ${p.relationships.key_dynamics.join('; ')}`);
    if (profileParts.length > 0) {
      const profileText = `ABOUT THIS PERSON:\n${profileParts.join('\n')}`;
      components.push({
        priority: 50,
        content: profileText,
        label: 'profile_summary',
        tokenEstimate: est(profileText),
      });
    }
  }

  // Current state — boosted priority for emotional intents
  const currentState = personContext.profile.current_state;
  if (currentState) {
    const stateParts: string[] = [];
    if (currentState.active_concerns?.length) {
      stateParts.push(`Active concerns: ${currentState.active_concerns.join('; ')}`);
    }
    if (currentState.mood_trajectory) {
      stateParts.push(`Mood trajectory: ${currentState.mood_trajectory}`);
    }
    if (currentState.recent_wins?.length) {
      stateParts.push(`Recent wins: ${currentState.recent_wins.join('; ')}`);
    }
    if (stateParts.length > 0) {
      const isEmotional = directive.communicativeIntent === 'venting' ||
        directive.communicativeIntent === 'distress';
      components.push({
        priority: isEmotional ? 75 : 45,
        content: `CURRENT STATE:\n${stateParts.join('\n')}`,
        label: 'person_current_state',
        tokenEstimate: est(stateParts.join('\n')),
      });
    }
  }

  // Priority 40: Recent conversation summaries
  const summaries = personContext.recentConversations
    .filter(c => c.summary)
    .slice(0, 5)
    .map(c => `[${c.started_at}] ${c.summary}`);
  if (summaries.length > 0) {
    const summaryText = `RECENT CONVERSATIONS:\n${summaries.join('\n')}`;
    components.push({
      priority: 40,
      content: summaryText,
      label: 'conversation_summaries',
      tokenEstimate: est(summaryText),
    });
  }

  // Priority 30: Factual memories
  if (personContext.memories.length > 0) {
    const memText = `KNOWN FACTS (from memory):\n${personContext.memories.map(m => `- ${m.memory}`).join('\n')}`;
    components.push({
      priority: 30,
      content: memText,
      label: 'factual_memories',
      tokenEstimate: est(memText),
    });
  }

  // Warmth-first directive when in distress
  if (directive.communicativeIntent === 'distress') {
    components.push({
      priority: 99,
      content: `DISTRESS PROTOCOL: This person is in distress. Your ONLY job is to be present.
- Acknowledge their pain directly
- Do not analyse, solve, or redirect
- Do not ask probing questions
- Hold space. Be warm. Be clear that you are here.
- If they express suicidal ideation, gently name it and ask if they have support, then provide crisis line information.`,
      label: 'distress_protocol',
      tokenEstimate: 80,
    });
  }

  // Voice mode modifier
  if (voiceMode) {
    components.push({
      priority: 85,
      content: `VOICE MODE ACTIVE:
You are speaking out loud. Your response will be converted to speech.
- Never use markdown: no **bold**, no headers, no bullet points, no lists
- Keep sentences short and direct
- Maximum 4-6 sentences for most turns
- Use verbal emphasis through word choice, not formatting
- No parenthetical asides`,
      label: 'voice_modifier',
      tokenEstimate: 60,
    });
  }

  // Depth signal from fascination threshold
  if (pendingDepth) {
    components.push({
      priority: 80,
      content: `[DEPTH SIGNAL]: The previous exchange contained a thread worth pulling: "${pendingDepth.thread}" (${pendingDepth.dimension}). Consider weaving this into your response naturally if the conversation allows it. Do not force it. If the conversation has moved on, let it go. Do not announce that you noticed something — just follow the thread as though it occurred to you naturally.`,
      label: 'depth_signal',
      tokenEstimate: 80,
    });
  }

  return components;
}

export async function steer(
  userMessage: string,
  personContext: PersonContext,
  productIdentity: ProductIdentity,
  sessionHistory: Message[],
  previousDirective?: ResponseDirective,
  previousConversationState?: ConversationState,
  options?: { voiceMode?: boolean },
): Promise<SteeringResult> {
  // Fast path: skip classification for trivial greetings
  const trivialPatterns = /^(hi|hey|hello|morning|evening|yo|sup|what'?s up|howdy|good (morning|evening|afternoon))[.!?,\s]*$/i;
  if (trivialPatterns.test(userMessage.trim()) && sessionHistory.length === 0) {
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

    const policies = loadPolicies();
    const policy = selectPolicy(defaultDirective, personContext, policies);
    const components = buildPromptComponents(productIdentity, personContext, policy, defaultDirective, sessionHistory);
    const { prompt: systemPrompt } = assemblePrompt(components);
    const reformulatedMessage = reformulate(userMessage, personContext, policy, defaultDirective);
    const modelConfig = determineModelConfig(defaultDirective, personContext);
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

  // Check for pending depth thread from previous turn
  const turnNumber = sessionHistory.filter(m => m.role === 'user').length;
  const pendingDepth = consumePendingDepth(personContext.profile.user_id, turnNumber);

  // 1. Classify
  const rawDirective = await classify(userMessage, personContext, sessionHistory, previousDirective);

  // 2. Validate (guardrails only)
  const directive = validate(rawDirective, userMessage);

  // 2.5 Update conversation state
  const conversationState = updateConversationState(
    previousConversationState || initialConversationState(),
    directive,
    userMessage,
    sessionHistory.filter(m => m.role === 'user').length,
  );

  // 3. Handle recall trigger
  let enrichedPersonContext = personContext;
  // Recall check
  if (directive.recallTriggered && directive.recallTier !== 'none') {
    try {
      const recallRequest: RecallRequest = {
        query: directive.recallQuery || userMessage,
        userId: personContext.profile.user_id,
        maxSegments: directive.recallTier === 'deep' ? 5 : 2,
        recencyBias: directive.recallTier === 'deep' ? 0.2 : 0.6,
        importanceFloor: directive.recallTier === 'deep' ? 3 : 5,
        includeEmotionalContext: true,
      };

      console.log(`[steer] Recall request: userId=${recallRequest.userId}, query="${recallRequest.query}", maxSegments=${recallRequest.maxSegments}`);
      const recallResult = await recall(recallRequest);
      console.log(`[steer] Recall returned ${recallResult.segments.length} segments in ${recallResult.queryLatencyMs}ms`);
      // Enrich person context with recalled segments
      enrichedPersonContext = {
        ...personContext,
        recalledSegments: recallResult.segments.map(s => ({
          conversationId: s.conversationId,
          segmentText: s.content,
          segmentType: s.segmentType,
          conversationDate: s.conversationDate.toISOString(),
        })),
      };
      // Tier 3: If user asks for specific detail, pull raw source turns
      if (directive.recallTier === 'deep' && recallResult.segments.length > 0) {
        const { getSourceTurns } = await import('@/lib/backbone/recall');
        const wantsDetail = /\b(exactly|specifically|what did (i|you) say|verbatim|word for word|actual)\b/i.test(userMessage);
        if (wantsDetail) {
          for (const seg of recallResult.segments.slice(0, 2)) {
            if (seg.conversationId) {
              try {
                const turns = await getSourceTurns(seg.conversationId);
                seg.sourceTurns = turns.slice(-10); // last 10 turns max
              } catch { /* non-critical */ }
            }
          }
        }
      }
    } catch (err) {
      console.error('[steer] Recall failed:', err);
    }
  }

  // 4. Load and select policy
  const policies = loadPolicies();
  const policy = selectPolicy(directive, enrichedPersonContext, policies, conversationState);

  // 4.5 Proactive recall at session start — give Jasper memories of this person
  let sessionStartRecall: string | null = null;
  const isFirstTurn = sessionHistory.filter(m => m.role === 'user').length <= 1;
  const isReturningUser = enrichedPersonContext.relationshipMeta.conversationCount > 0;
  if (isFirstTurn && isReturningUser && enrichedPersonContext.recalledSegments.length === 0) {
    try {
      const name = enrichedPersonContext.profile.identity?.name || 'this person';
      // Use profile data as query to surface most relevant memories
      const concerns = enrichedPersonContext.profile.current_state?.active_concerns || [];
      const query = `${name} recent conversations ${concerns.slice(0, 2).join(' ')}`.trim();
      const proactiveRecall = await recall({
        query,
        userId: enrichedPersonContext.profile.user_id,
        maxSegments: 3,
        recencyBias: 0.4,
        importanceFloor: 5,
        includeEmotionalContext: true,
      });
      if (proactiveRecall.segments.length > 0) {
        const memories = proactiveRecall.segments
          .map(s => `- ${s.content}`)
          .join('\n');
        sessionStartRecall = `WHAT YOU REMEMBER ABOUT ${name.toUpperCase()}:\n${memories}\n\nThese are real memories from previous conversations. Reference them naturally when relevant — not as a recap, but as the texture of knowing someone.`;
      }
    } catch {
      // Non-critical — session proceeds without proactive recall
    }
  }

  // 5. Assemble prompt
  const components = buildPromptComponents(productIdentity, enrichedPersonContext, policy, directive, sessionHistory, options?.voiceMode ?? false, pendingDepth, sessionStartRecall);
  const { prompt: systemPrompt, includedComponents, excludedComponents } = assemblePrompt(components);

  // 6. Reformulate user message
  const reformulatedMessage = reformulate(userMessage, enrichedPersonContext, policy, directive);

  // 7. Determine model config
  const modelConfig = determineModelConfig(directive, enrichedPersonContext);

  // 8. Determine post-response actions
  const isSubstantive = directive.communicativeIntent !== 'connecting' &&
    directive.conversationalPhase !== 'opening' &&
    userMessage.split(/\s+/).length > 5;

  // Fire async depth scoring if conditions are met
  if (shouldFireDepthScoring(directive, conversationState, modelConfig.tier)) {
    console.log('[depth-scoring] Firing async evaluation...');
    const userTurnCount = sessionHistory.filter(m => m.role === 'user').length;
    Promise.race([
      scoreDepth(userMessage, sessionHistory),
      new Promise<null>(resolve => setTimeout(() => resolve(null), DEPTH_EVAL_CONFIG.evaluationTimeout)),
    ]).then(result => {
      if (!result) {
        console.log('[depth-scoring] Timeout or null result');
        return;
      }
      console.log(`[depth-scoring] Score: ${result.score}/${DEPTH_EVAL_CONFIG.scoreThreshold}, dim: ${result.dimension}, thread: "${result.thread}"`);
      if (result.score >= DEPTH_EVAL_CONFIG.scoreThreshold && result.thread) {
        storePendingDepth(personContext.profile.user_id, {
          thread: result.thread,
          dimension: result.dimension || 'connection',
          score: result.score,
        }, userTurnCount);
      } else {
        console.log('[depth-scoring] Below threshold, discarded');
      }
    }).catch(err => console.error('[depth-scoring] Async error:', err));
  }

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
    conversationState,
  };
}

export type { ResponseDirective, SteeringResult, ProductIdentity, ModelConfig, Policy } from './types';
