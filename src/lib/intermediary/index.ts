// LAYER B: Intermediary — Steering Engine
// This layer MUST NOT import from product/

import type { PersonContext } from '@/lib/backbone/types';
import type { Message } from '@/types/message';
import { recall } from '@/lib/backbone/recall';
import type { RecallRequest } from '@/lib/backbone/recall';
import type { ProductIdentity, SteeringResult, ResponseDirective, ModelConfig, Policy } from './types';
import { classify } from './classifier';
import { selectPolicy } from './policy-selector';
import { loadPolicies } from './policy-loader';
import { assemblePrompt, type PromptComponent } from './prompt-assembler';
import { reformulate } from './reformulator';
import { validate } from './validation';
import { antiSycophancyReinjection } from './sycophancy';

function determineModelConfig(directive: ResponseDirective, ctx: PersonContext): ModelConfig {
  const depth = ctx.relationshipMeta.conversationCount > 15 ? 'established' : 'other';

  let tier: 'ambient' | 'standard' | 'deep' = 'standard';
  let model = 'claude-sonnet-4-6';
  let maxTokens = 2048;

  if (directive.communicativeIntent === 'distress') {
    tier = 'deep'; model = 'claude-opus-4-6'; maxTokens = 4096;
  } else if (directive.communicativeIntent === 'connecting') {
    tier = 'ambient'; model = 'claude-haiku-4-5-20251001'; maxTokens = 512;
  } else if (directive.communicativeIntent === 'requesting_input' && directive.emotionalArousal > 0.7) {
    tier = 'deep'; model = 'claude-opus-4-6'; maxTokens = 4096;
  } else if (directive.communicativeIntent === 'sense_making' && depth === 'established') {
    tier = 'deep'; model = 'claude-opus-4-6'; maxTokens = 4096;
  } else if (directive.confidence < 0.3) {
    tier = 'standard'; model = 'claude-sonnet-4-6'; maxTokens = 2048;
  }

  // Adjust maxTokens based on recommended length — floors, not ceilings
  if (directive.recommendedResponseLength === 'minimal') maxTokens = Math.min(maxTokens, 256);
  else if (directive.recommendedResponseLength === 'short') maxTokens = Math.min(maxTokens, 1024);
  else if (directive.recommendedResponseLength === 'long') maxTokens = Math.max(maxTokens, 4096);

  const tempRanges = { ambient: [0.7, 1.0], standard: [0.6, 0.95], deep: [0.5, 0.8] };
  const [min, max] = tempRanges[tier];
  const temperature = min + Math.random() * (max - min);

  return { tier, provider: 'anthropic', model, temperature: Math.round(temperature * 100) / 100, maxTokens };
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

function buildPromptComponents(
  productIdentity: ProductIdentity,
  personContext: PersonContext,
  policy: Policy,
  directive: ResponseDirective,
  sessionHistory: Message[],
): PromptComponent[] {
  const components: PromptComponent[] = [];
  const est = (s: string) => Math.ceil(s.split(/\s+/).length * 1.3);

  // Priority 100: Identity
  components.push({
    priority: 100,
    content: productIdentity.identityPrompt,
    label: 'identity',
    tokenEstimate: est(productIdentity.identityPrompt),
  });

  // Priority 95: Core obligations
  const obligations = `${productIdentity.obligations}\n\n${productIdentity.antiLabellingRule}`;
  components.push({
    priority: 95,
    content: obligations,
    label: 'obligations',
    tokenEstimate: est(obligations),
  });

  // Priority 90: Anti-sycophancy re-injection
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

  // Priority 75: Interaction preferences
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

      if (patterns.growth_edges?.length) {
        patternParts.push(`Growth edges: ${patterns.growth_edges.join('; ')}`);
      }
      if (patterns.stress_responses?.length && (isEmotional || isAnalytical)) {
        patternParts.push(`Stress responses: ${patterns.stress_responses.join('; ')}`);
      }
      if (patterns.avoidance_patterns?.length && isAnalytical) {
        patternParts.push(`Avoidance patterns: ${patterns.avoidance_patterns.join('; ')}`);
      }
      if (patterns.decision_patterns?.length && isAnalytical) {
        patternParts.push(`Decision patterns: ${patterns.decision_patterns.join('; ')}`);
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

  // Priority 50: Profile summary
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

  return components;
}

export async function steer(
  userMessage: string,
  personContext: PersonContext,
  productIdentity: ProductIdentity,
  sessionHistory: Message[],
  previousDirective?: ResponseDirective,
): Promise<SteeringResult> {
  // 1. Classify
  const rawDirective = await classify(userMessage, personContext, sessionHistory, previousDirective);

  // 2. Validate (guardrails only)
  const directive = validate(rawDirective, userMessage);

  // 3. Handle recall trigger
  let enrichedPersonContext = personContext;
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

      const recallResult = await recall(recallRequest);
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
    } catch (err) {
      console.error('[steer] Recall failed:', err);
    }
  }

  // 4. Load and select policy
  const policies = loadPolicies();
  const policy = selectPolicy(directive, enrichedPersonContext, policies);

  // 5. Assemble prompt
  const components = buildPromptComponents(productIdentity, enrichedPersonContext, policy, directive, sessionHistory);
  const { prompt: systemPrompt, includedComponents, excludedComponents } = assemblePrompt(components);

  // 6. Reformulate user message
  const reformulatedMessage = reformulate(userMessage, enrichedPersonContext, policy, directive);

  // 7. Determine model config
  const modelConfig = determineModelConfig(directive, enrichedPersonContext);

  // 8. Determine post-response actions
  const isSubstantive = directive.communicativeIntent !== 'connecting' &&
    directive.conversationalPhase !== 'opening' &&
    userMessage.split(/\s+/).length > 5;

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
  };
}

export type { ResponseDirective, SteeringResult, ProductIdentity, ModelConfig, Policy } from './types';
