// Jasper product configuration — wires Jasper-specific behaviour into
// the generic platform steering engine via ProductConfig.

import { join } from 'path';
import type {
  ProductConfig,
  PromptComponent,
  PromptComponentContext,
  ResponseDirective,
  ConversationState,
} from '@/lib/platform/types';
import type { PersonContext } from '@/lib/backbone/types';
import type { Message } from '@/types/message';
import { antiSycophancyReinjection } from '@/lib/platform/sycophancy';
import { buildRelationshipInjection as _buildRelationshipInjection } from '@/lib/platform/relationship-safety';
import { scoreDepth } from '@/lib/platform/depth-scoring';
import { storePendingDepth } from '@/lib/platform/pending-depth';
import { DEPTH_EVAL_CONFIG } from '@/lib/platform/depth-config';
import { formatTimeAgo } from '@/lib/platform/utils';
import { detectLaughter } from '@/lib/platform/conversation-tracker';
import {
  detectDistress,
  messageReferencesJasper,
  buildCareContext,
  buildPersonContextBlock,
  jasperRoutingOverrides,
  shouldFireJasperDepthScoring,
  JASPER_FEEDBACK_PATTERN,
} from './jasper-helpers';
import { fireRelationalConnectionCheck, type RelationalThread } from './relational-threads';

// Jasper's relationship mode directive text — canonical source.
// Also consumed by intermediary/relationship-safety.ts wrapper.
export const JASPER_RELATIONSHIP_MODE_DIRECTIVE = `RELATIONSHIP MODE — ACTIVE

You are still Jasper. Your personality, directness, and pattern-naming ability are intact. But your function is narrowed.

You are talking to someone about a relationship where the other person is not in the room. You will NEVER hear their side. You will NEVER know their experience, fears, constraints, or reasoning. Everything you know about them comes through one person's pain.

YOUR JOB IN THIS MODE:
- Help them understand what THEY feel and what THEY need
- Help them notice THEIR OWN patterns — what they do when conflict arises, how they respond to perceived rejection, where they get stuck in loops
- Help them prepare what they want to SAY to their partner — the actual words, the framing, the approach
- Help them articulate their needs clearly enough to communicate them, not just feel them
- Ask what they think their partner might be experiencing — let THEM generate empathy for the other person, don't generate it yourself

THE LINE YOU DO NOT CROSS:
The moment you start explaining WHY the partner does what they do, you are building a character analysis of someone you've never met. That is the line.

PROHIBITED — any sentence where the absent partner is the subject:
✗ "She's refusing to engage"
✗ "He benefits from the current arrangement"
✗ "She's offering you an exit ramp"
✗ "He can't tolerate the assessment conversation"
✗ "She's defined unconditional love as..."
✗ "She can't meet your needs and won't say so directly"

REQUIRED — reframe as the user's experience:
✓ "It sounds like you feel shut down when you try to raise this"
✓ "You're experiencing this as an exit ramp — is that right?"
✓ "What do you think is happening for her when you raise this?"
✓ "You need forward momentum — have you been able to say that to her in those words?"
✓ "What's your pattern when this conversation shuts down? What do you do next?"

You can be direct. You can name the user's avoidance, their loops, their contribution to the dynamic. You can say "you keep solving the communication problem instead of facing the possibility that the answer might not change." That's naming THEIR pattern.

You CANNOT say "she keeps shutting down the conversation." That's naming HER pattern from HIS account. You don't know if that's what's happening. You only know that's how he experiences it.

NEVER lead toward ending or staying. That is not your decision or your recommendation to make. If the user asks "should I leave?" your answer is: "That's not something I can answer for you. What I can help with is making sure you're making that decision from clarity about what you need, not from frustration about what you're not getting."`;

export const JASPER_SELF_AWARE_INTERVENTION = `IMPORTANT: You have been listening to one side of this relationship for many turns. In your NEXT response, naturally acknowledge your limitation. Say something like:

"I want to be honest — I've been listening to your side of this for a while, and I can feel myself forming opinions about someone I've never met. That's not fair to them. I don't know what they're experiencing or what they're afraid of. Can we stay with what you need and what you want to communicate, rather than me trying to figure out what's going on with them?"

Say this IN YOUR OWN WORDS — don't recite it verbatim. Make it natural. Then continue the conversation from that reframed position.`;

function buildRelationshipInjection(state: ConversationState) {
  return _buildRelationshipInjection(state, JASPER_RELATIONSHIP_MODE_DIRECTIVE, JASPER_SELF_AWARE_INTERVENTION);
}

function est(s: string): number {
  return Math.ceil(s.split(/\s+/).length * 1.3);
}

function buildJasperPromptComponents(ctx: PromptComponentContext): PromptComponent[] {
  const {
    productIdentity,
    personContext,
    policy,
    directive,
    sessionHistory,
    voiceMode,
    pendingDepth,
    pendingConnection,
    sessionStartRecall,
    userMessage,
    conversationState,
  } = ctx;

  const components: PromptComponent[] = [];

  // Priority 100: Identity — always the full prompt
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

  // Priority 88: Person context — who you're talking to
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

  // Priority 87: Care context — wider frame for genuinely distressed users
  const isDistressedForCare = detectDistress(directive, userMessage || '');
  if (isDistressedForCare) {
    const careContext = buildCareContext(personContext.profile);
    if (careContext) {
      components.push({
        priority: 87,
        content: careContext,
        label: 'care_context',
        tokenEstimate: est(careContext),
      });
    }
  }

  // Priority 99: Relationship guardrail — escalating injection from relationship-safety module
  if (conversationState && conversationState.relationshipTurnCount > 0) {
    const relationshipComponents = buildRelationshipInjection(conversationState);
    components.push(...relationshipComponents);
  }

  // Priority 55: Session-start recall
  if (sessionStartRecall) {
    components.push({
      priority: 55,
      content: sessionStartRecall,
      label: 'session_start_recall',
      tokenEstimate: est(sessionStartRecall),
    });
  }

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

  // Priority 88: Self-observations
  if (personContext.selfObservations && personContext.selfObservations.length > 0) {
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

  // Key patterns — always included, priority varies by intent
  const patterns = personContext.profile.patterns;
  if (patterns && Object.keys(patterns).length > 0) {
    const isAnalytical = directive.communicativeIntent === 'requesting_input' ||
      directive.communicativeIntent === 'sense_making';
    const isEmotional = directive.communicativeIntent === 'venting' ||
      directive.communicativeIntent === 'distress';

    const patternParts: string[] = [];
    const joinField = (val: unknown): string => {
      if (Array.isArray(val)) return val.join('; ');
      if (typeof val === 'string') return val;
      return String(val);
    };

    if (patterns.growth_edges?.length) {
      patternParts.push(`Growth edges: ${joinField(patterns.growth_edges)}`);
    }
    if (patterns.stress_responses?.length) {
      patternParts.push(`Stress responses: ${joinField(patterns.stress_responses)}`);
    }
    if (patterns.avoidance_patterns?.length) {
      patternParts.push(`Avoidance patterns: ${joinField(patterns.avoidance_patterns)}`);
    }
    if (patterns.decision_patterns?.length) {
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

  // Relational thread connection signal
  if (pendingConnection) {
    const name = personContext.profile.identity?.name || 'this person';
    components.push({
      priority: 78,
      content: `[RELATIONAL THREAD]: There's a connection between the current conversation and something foundational to your relationship with ${name}: "${pendingConnection.connection}" (from your shared thread about ${pendingConnection.thread}). Raise this naturally if it's genuinely relevant — don't force it. If the conversation has moved on, let it go.`,
      label: 'relational_connection',
      tokenEstimate: 60,
    });
  }

  return components;
}

export const JASPER_PRODUCT_CONFIG: ProductConfig = {
  name: 'Jasper',

  feedbackPattern: JASPER_FEEDBACK_PATTERN,

  trivialGreetingPattern: /^(hi|hey|hello|morning|evening|yo|sup|what'?s up|howdy|good (morning|evening|afternoon))[.!?,\s]*$/i,

  policyDir: join(process.cwd(), 'docs', 'policies'),

  buildPromptComponents: buildJasperPromptComponents,

  routingOverrides: jasperRoutingOverrides,

  backgroundTasks: [
    {
      name: 'depth-scoring',
      shouldFire: shouldFireJasperDepthScoring,
      run: async (
        userMessage: string,
        sessionHistory: Message[],
        personContext: PersonContext,
      ): Promise<void> => {
        const userTurnCount = sessionHistory.filter(m => m.role === 'user').length;
        console.log('[depth-scoring] Firing async evaluation...');
        const result = await Promise.race([
          scoreDepth(userMessage, sessionHistory, personContext.profile as unknown as Record<string, unknown>),
          new Promise<null>(resolve => setTimeout(() => resolve(null), DEPTH_EVAL_CONFIG.evaluationTimeout)),
        ]);
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
      },
    },
    {
      name: 'relational-connection-check',
      shouldFire: (
        _directive: ResponseDirective,
        _conversationState: ConversationState,
        modelTier: string,
        personContext: PersonContext,
      ): boolean => {
        const threads = (personContext.profile as unknown as Record<string, unknown>).relational_threads as RelationalThread[] | undefined;
        const eligible = (threads?.length || 0) > 0 && modelTier !== 'ambient';
        console.log(`[relational-check] threads=${threads?.length || 0}, tier=${modelTier}, eligible=${eligible}`);
        return eligible;
      },
      run: async (
        userMessage: string,
        sessionHistory: Message[],
        personContext: PersonContext,
      ): Promise<void> => {
        const threads = (personContext.profile as unknown as Record<string, unknown>).relational_threads as RelationalThread[] | undefined;
        if (!threads || threads.length === 0) return;
        await fireRelationalConnectionCheck(
          userMessage,
          sessionHistory,
          threads,
          personContext.profile.user_id,
          sessionHistory.filter(m => m.role === 'user').length,
        );
      },
    },
  ],

  analyticsExtensions: (
    directive: ResponseDirective,
    userMessage: string,
  ): Record<string, unknown> => {
    const laughterDetected = detectLaughter(userMessage);
    return {
      careContextInjected: detectDistress(directive, userMessage),
      distressOverride: detectDistress(directive, userMessage),
      correctionDetected: messageReferencesJasper(userMessage),
      laughterDetected,
    };
  },

  recallConfig: {
    deepMaxSegments: 5,
    shallowMaxSegments: 2,
    deepRecencyBias: 0.2,
    shallowRecencyBias: 0.6,
    deepImportanceFloor: 3,
    shallowImportanceFloor: 5,
    proactiveMaxSegments: 3,
    proactiveRecencyBias: 0.4,
    proactiveImportanceFloor: 5,
  },
};
