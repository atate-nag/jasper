// Metacognitive layer: observes the system's own relational patterns,
// evaluates them against metaheuristic markers, and produces self-observations.

import { getSupabaseAdmin } from '@/lib/supabase';
import type { Message } from '@/types/message';
import type { PatternNote, Adaptation, SelfObservation } from './types';

interface SessionMetrics {
  totalTurns: number;
  patternNamingCount: number;
  questionEndingCount: number;
  topicShiftsBySystem: number;
  topicShiftsByUser: number;
  challengeAttempts: number;
  challengeAccepted: number;
  warmthTokenVariety: number;
  policyIds: string[];
}

/**
 * Compute per-session metrics from messages and turn metadata.
 */
export function computeSessionMetrics(
  messages: Message[],
  policyIds: string[] = [],
): SessionMetrics {
  const assistantMessages = messages.filter(m => m.role === 'assistant');
  const userMessages = messages.filter(m => m.role === 'user');

  let patternNamingCount = 0;
  let questionEndingCount = 0;
  let topicShiftsBySystem = 0;
  let challengeAttempts = 0;
  let challengeAccepted = 0;

  const warmthPhrases = new Set<string>();
  const warmthPatterns = [
    /that (sounds|must be|seems)/i,
    /i (hear|understand|can see)/i,
    /it makes sense/i,
    /that's (real|valid|understandable)/i,
  ];

  for (const msg of assistantMessages) {
    const content = msg.content;

    // Pattern naming detection
    if (/\b(i notice|pattern|you tend to|there's a tendency|what's happening here|i'm seeing)\b/i.test(content)) {
      patternNamingCount++;
    }

    // Question ending
    if (content.trim().endsWith('?')) {
      questionEndingCount++;
    }

    // Warmth token tracking
    for (const p of warmthPatterns) {
      const match = content.match(p);
      if (match) warmthPhrases.add(match[0].toLowerCase());
    }

    // Challenge detection
    if (/\b(have you considered|the tension|what if|i disagree|push back|honest about)\b/i.test(content)) {
      challengeAttempts++;
    }
  }

  // Check challenge acceptance in user responses following challenges
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].role === 'user' && messages[i - 1].role === 'assistant') {
      const prevAssistant = messages[i - 1].content;
      const isChallenge = /\b(have you considered|the tension|what if|i disagree|push back)\b/i.test(prevAssistant);
      if (isChallenge) {
        const userResponse = messages[i].content;
        const engaged = userResponse.length > 50 && !/\b(anyway|let's move on|something else)\b/i.test(userResponse);
        if (engaged) challengeAccepted++;
      }
    }
  }

  return {
    totalTurns: userMessages.length,
    patternNamingCount,
    questionEndingCount,
    topicShiftsBySystem: 0, // TODO: implement topic shift detection
    topicShiftsByUser: 0,
    challengeAttempts,
    challengeAccepted,
    warmthTokenVariety: warmthPhrases.size,
    policyIds,
  };
}

/**
 * Evaluate session metrics against metaheuristic markers.
 * Returns pattern notes and recommended adaptations.
 */
export function evaluateMetaheuristics(
  metrics: SessionMetrics,
): { patterns: PatternNote[]; adaptations: Adaptation[] } {
  const patterns: PatternNote[] = [];
  const adaptations: Adaptation[] = [];

  // 1. Heuristic overuse: pattern naming
  if (metrics.totalTurns > 4) {
    const namingRate = metrics.patternNamingCount / metrics.totalTurns;
    if (namingRate > 0.5) {
      patterns.push({
        metaheuristic: 'heuristic_overuse',
        observation: `Pattern-naming fired ${metrics.patternNamingCount} times in ${metrics.totalTurns} turns (${(namingRate * 100).toFixed(0)}%). This may feel predictable to the user.`,
        evidence: [`${metrics.patternNamingCount} pattern-naming instances detected`],
        severity: namingRate > 0.6 ? 'flag' : 'note',
      });
      adaptations.push({
        parameter: 'pattern_naming_frequency',
        direction: 'decrease',
        rationale: 'Pattern-naming is becoming the default move. Limit to moments where genuinely earned.',
      });
    }
  }

  // 2. Question ending overuse
  if (metrics.totalTurns > 4) {
    const questionRate = metrics.questionEndingCount / (metrics.totalTurns || 1);
    if (questionRate > 0.7) {
      patterns.push({
        metaheuristic: 'heuristic_overuse',
        observation: `${(questionRate * 100).toFixed(0)}% of responses end with a question. Consider ending with statements or silence.`,
        evidence: [`${metrics.questionEndingCount}/${metrics.totalTurns} responses end with ?`],
        severity: 'note',
      });
      adaptations.push({
        parameter: 'question_ending_ratio',
        direction: 'decrease',
        rationale: 'Over-questioning can feel interrogative. Let some responses land without redirecting.',
      });
    }
  }

  // 3. Challenge calibration
  if (metrics.challengeAttempts > 0) {
    const acceptanceRate = metrics.challengeAccepted / metrics.challengeAttempts;
    if (acceptanceRate < 0.3 && metrics.challengeAttempts >= 2) {
      patterns.push({
        metaheuristic: 'challenge_calibration',
        observation: `Challenge acceptance rate: ${(acceptanceRate * 100).toFixed(0)}% (${metrics.challengeAccepted}/${metrics.challengeAttempts}). Challenge level may be too high for current relationship stage.`,
        evidence: [`${metrics.challengeAttempts} challenges attempted, ${metrics.challengeAccepted} engaged with`],
        severity: 'flag',
      });
      adaptations.push({
        parameter: 'challenge_ceiling',
        direction: 'decrease',
        rationale: 'User is deflecting most challenges. Reduce challenge level.',
      });
    } else if (acceptanceRate > 0.9 && metrics.challengeAttempts >= 2) {
      patterns.push({
        metaheuristic: 'challenge_calibration',
        observation: `Challenge acceptance rate: ${(acceptanceRate * 100).toFixed(0)}%. User engages with all challenges — current level may be below tolerance.`,
        evidence: [`${metrics.challengeAttempts} challenges, all engaged`],
        severity: 'note',
      });
      adaptations.push({
        parameter: 'challenge_ceiling',
        direction: 'increase',
        rationale: 'User is engaging with every challenge. Can increase directness.',
      });
    }
  }

  // 4. Policy diversity
  if (metrics.policyIds.length >= 3) {
    const unique = new Set(metrics.policyIds);
    const entropy = unique.size / metrics.policyIds.length;
    if (entropy < 0.3) {
      const mostUsed = [...unique].sort((a, b) =>
        metrics.policyIds.filter(p => p === b).length - metrics.policyIds.filter(p => p === a).length
      )[0];
      patterns.push({
        metaheuristic: 'pattern_diversity',
        observation: `Policy selections concentrated on ${mostUsed}. Conversational range may be narrowing.`,
        evidence: [`${unique.size} unique policies across ${metrics.policyIds.length} turns`],
        severity: 'note',
      });
      adaptations.push({
        parameter: 'policy_exploration_rate',
        direction: 'increase',
        rationale: 'Policy entropy is low. Increase variety to prevent conversational rut.',
      });
    }
  }

  // 5. Warmth authenticity — deferred to async evaluation in runSessionMetacognition
  // (replaced token-counting with a model call that assesses whether warmth was present)

  return { patterns, adaptations };
}

/**
 * Run per-session metacognitive evaluation and store self-observations.
 */
export async function runSessionMetacognition(
  userId: string,
  sessionId: string,
  messages: Message[],
  policyIds: string[] = [],
): Promise<SelfObservation | null> {
  if (messages.length < 6) return null; // too short for meaningful evaluation

  const metrics = computeSessionMetrics(messages, policyIds);
  const { patterns, adaptations } = evaluateMetaheuristics(metrics);

  // Async warmth check — replaces token-counting with semantic evaluation
  if (messages.length > 6) {
    try {
      const { callModel } = await import('@/lib/model-client');
      const { getModelRouting } = await import('@/lib/config/models');
      const routing = getModelRouting();

      const conversationText = messages.map((m, i) => `[turn ${i}] [${m.role}]: ${m.content}`).join('\n');
      const { logUsage } = await import('@/lib/usage');
      const warmthModelResult = await callModel(
        routing.classification, // Haiku
        '',
        [{ role: 'user', content: `Review this conversation. Answer two questions:

1. Did the assistant acknowledge the person's emotional state at any point — not with a formula, but with genuine recognition of how they were feeling? (yes/no)

2. Were there moments where the assistant prioritised presence over problem-solving — staying with the person rather than moving to solutions? (yes/no)

If the conversation was purely intellectual/analytical with no emotional content, both answers should be "n/a".

Return JSON: {"emotional_content": true/false, "acknowledged": true/false, "presence_shown": true/false}
Return raw JSON only.

Conversation:
${conversationText}` }],
      );
      logUsage(warmthModelResult.usage, 'metacognition', userId);

      const cleaned = warmthModelResult.text.replace(/^\s*```(?:json)?\s*\n?/i, '').replace(/\n?\s*```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned);

      if (parsed.emotional_content && !parsed.acknowledged && !parsed.presence_shown) {
        patterns.push({
          metaheuristic: 'warmth_authenticity',
          observation: 'Person expressed emotion but Jasper did not acknowledge their feelings or show presence.',
          evidence: ['Emotional content present but not met with acknowledgment or presence'],
          severity: 'flag',
        });
        adaptations.push({
          parameter: 'warmth_expression_style',
          direction: 'increase',
          rationale: 'Emotional content was present but not acknowledged. Prioritise presence over analysis.',
        });
      }
    } catch {
      // Non-critical — skip warmth check if model call fails
    }
  }

  if (patterns.length === 0) return null; // nothing noteworthy

  const observation: SelfObservation = {
    timestamp: new Date().toISOString(),
    sessionId,
    patternsNoted: patterns,
    adaptationsRecommended: adaptations,
    injected: false,
  };

  // Persist to profile
  try {
    const { data: profile } = await getSupabaseAdmin()
      .from('user_profiles')
      .select('self_observations')
      .eq('user_id', userId)
      .single();

    const existing = Array.isArray(profile?.self_observations) ? profile.self_observations : [];
    // Keep last 10 observations
    const updated = [...existing, observation].slice(-10);

    await getSupabaseAdmin()
      .from('user_profiles')
      .update({ self_observations: updated })
      .eq('user_id', userId);
  } catch (err) {
    console.error('[metacog] Failed to save self-observations:', err);
  }

  return observation;
}

/**
 * Get the most recent uninjected self-observations for prompt injection.
 */
export async function getInjectableObservations(
  userId: string,
): Promise<SelfObservation[]> {
  try {
    const { data: profile } = await getSupabaseAdmin()
      .from('user_profiles')
      .select('self_observations')
      .eq('user_id', userId)
      .single();

    if (!profile?.self_observations || !Array.isArray(profile.self_observations)) return [];

    return (profile.self_observations as SelfObservation[])
      .filter(obs => !obs.injected)
      .slice(-3); // inject at most 3 recent observations
  } catch {
    return [];
  }
}

/**
 * Mark observations as injected so they don't repeat.
 */
export async function markObservationsInjected(
  userId: string,
  timestamps: string[],
): Promise<void> {
  try {
    const { data: profile } = await getSupabaseAdmin()
      .from('user_profiles')
      .select('self_observations')
      .eq('user_id', userId)
      .single();

    if (!profile?.self_observations) return;

    const updated = (profile.self_observations as SelfObservation[]).map(obs => {
      if (timestamps.includes(obs.timestamp)) {
        return { ...obs, injected: true };
      }
      return obs;
    });

    await getSupabaseAdmin()
      .from('user_profiles')
      .update({ self_observations: updated })
      .eq('user_id', userId);
  } catch {
    // non-critical
  }
}
