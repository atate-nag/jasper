// Platform classifier — LLM-based conversational state classification.
// Products can override the classifier prompt via ProductConfig.classifierPrompt.

import type { PersonContext } from '@/lib/backbone/types';
import type { Message } from '@/types/message';
import type { ResponseDirective, RelationalDepth } from './types';
import { buildClassifierSummary } from '@/lib/backbone/profile';
import { callModel } from '@/lib/model-client';
import { getModelRouting } from '@/lib/config/models';
import { logUsage } from '@/lib/usage';

export function computeRelationalDepth(conversationCount: number): RelationalDepth {
  if (conversationCount <= 1) return 'first_encounter';
  if (conversationCount <= 5) return 'early';
  if (conversationCount <= 15) return 'developing';
  return 'established';
}

const DEFAULT_CLASSIFIER_PROMPT = `You are a conversational state classifier. Analyze this message in context and return a JSON ResponseDirective.

PERSON CONTEXT:
{personSummary}
Relational depth: {relationalDepth}

{previousContext}
{historyText}
CURRENT MESSAGE:
{userMessage}

Return a JSON object with EXACTLY these fields:
{
  "communicativeIntent": "sharing" | "venting" | "sense_making" | "requesting_input" | "requesting_action" | "connecting" | "distress",
  "emotionalValence": <float -1 to 1>,
  "emotionalArousal": <float 0 to 1>,
  "challengeReadiness": "pre_contemplation" | "contemplation" | "preparation" | "action",
  "conversationalPhase": "opening" | "topic_initiation" | "development" | "potential_shift" | "closing",
  "recallTriggered": <boolean>,
  "recallTier": "deep" | "shallow" | "none",
  "recallQuery": <string or null - a search query to find relevant past segments>,
  "recallSignals": [<string array of entities/topics/time refs>],
  "recommendedPostureClass": "warm_reflective" | "exploratory" | "analytical" | "challenging" | "minimal" | "playful",
  "recommendedResponseLength": "minimal" | "short" | "medium" | "long",
  "challengeAppropriate": <boolean>,
  "dispreferred": <boolean - true if the best response goes against what user wants to hear>,
  "confidence": <float 0 to 1>,
  "rationale": "<brief explanation of your reading>",
  "communicationStyle": {
    "verbosity": "terse" | "moderate" | "verbose",
    "formality": "casual" | "moderate" | "formal",
    "humourPresent": <boolean>,
    "disclosureLevel": "none" | "light" | "substantive",
    "energy": "low" | "moderate" | "high"
  }
}

GUIDELINES:
- venting → warm_reflective (listen, don't solve)
- connecting / casual → minimal or playful
- sense_making → exploratory or analytical
- requesting_input → analytical
- distress → warm_reflective (always)
- If the user references a past conversation ("remember when..."), set recallTriggered: true and recallQuery to the relevant query
- When confidence < 0.5, default to warm_reflective
- challengeAppropriate only if relationship is developing+ AND readiness is contemplation+
- dispreferred = true when honest response contradicts what user seems to want

DISPREFERRED CALIBRATION:
Set dispreferred to true ONLY when you are confident (>0.8) that your response should go against what the user is seeking. This means:
- They asked for agreement but you need to disagree
- They asked for validation but you see a genuine problem
- They're describing a decision that contradicts their stated values

Do NOT set dispreferred to true when:
- You're unsure whether the user is avoiding something
- The message could be either genuine curiosity or avoidance
- The user is being playful or casual

The threshold for dispreferred is HIGH. When in doubt, set it to false. Read the message at face value first.

CONCERN FRAMING RULE:
When your rationale mentions user patterns, frame them as observations, not diagnoses.

BAD: "Intellectualizing as avoidance mechanism"
GOOD: "Intellectual engagement sometimes serves as mood management during difficult periods"

BAD: "Using curiosity as defense mechanism"
GOOD: "Curiosity spikes during emotionally heavy periods; sometimes genuine, sometimes deflective"

Diagnostic framing causes downstream components to interpret all future instances of the behaviour as pathological. Observational framing allows each instance to be assessed on its merits. Read the message at face value first.

RECALL DETECTION:
Determine whether this message references past conversations or stored knowledge.

- deep: Explicit references to past discussions ("remember when we talked about...",
  "what did I say about...", "you mentioned last time..."), asking about stored personal
  facts ("what's my son's name?"), or contradicting a previously stated fact.
- shallow: Thematic continuity with past topics not in the current session, emotional
  echoes of previous conversations, preference-dependent responses ("recommend me something
  based on what you know"), ambiguous temporal references ("how's that going?").
- none: Generic conversation, small talk, current-session continuity, world-knowledge
  questions, information already in the conversation window.

If recall is triggered (deep or shallow), extract recallSignals: specific entities,
time references, topic keywords that should inform the retrieval query.

Return ONLY valid JSON.`;

function buildClassifierPromptText(
  userMessage: string,
  personContext: PersonContext,
  sessionHistory: Message[],
  previousDirective?: ResponseDirective,
  promptTemplate?: string,
): string {
  const relationalDepth = computeRelationalDepth(personContext.relationshipMeta.conversationCount);
  const recentExchanges = sessionHistory.slice(-12);
  const historyText = recentExchanges.map(m => `[${m.role}]: ${m.content}`).join('\n');
  const personSummary = buildClassifierSummary(personContext.profile, personContext.relationshipMeta);

  const previousContext = previousDirective
    ? `PREVIOUS DIRECTIVE (for continuity):\nIntent: ${previousDirective.communicativeIntent}, Posture: ${previousDirective.recommendedPostureClass}, Phase: ${previousDirective.conversationalPhase}\n`
    : '';

  const template = promptTemplate || DEFAULT_CLASSIFIER_PROMPT;

  return template
    .replace('{personSummary}', personSummary)
    .replace('{relationalDepth}', relationalDepth)
    .replace('{previousContext}', previousContext)
    .replace('{historyText}', historyText ? `RECENT EXCHANGES:\n${historyText}\n` : '')
    .replace('{userMessage}', userMessage);
}

export async function classify(
  userMessage: string,
  personContext: PersonContext,
  sessionHistory: Message[],
  previousDirective?: ResponseDirective,
  classifierPromptOverride?: string,
): Promise<ResponseDirective> {
  const prompt = buildClassifierPromptText(
    userMessage, personContext, sessionHistory, previousDirective, classifierPromptOverride,
  );

  try {
    const routing = getModelRouting();
    const result = await callModel(
      routing.classification,
      '',
      [{ role: 'user', content: prompt }],
      0,
    );

    logUsage(result.usage, 'classify');

    const raw = result.text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

    // Multi-strategy JSON parsing
    let directive: ResponseDirective;
    try {
      directive = JSON.parse(raw) as ResponseDirective;
    } catch {
      // Try extracting JSON object
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          directive = JSON.parse(jsonMatch[0]) as ResponseDirective;
          console.warn('[classify] Salvaged truncated JSON response');
        } catch {
          throw new Error('JSON parse failed after salvage attempt');
        }
      } else {
        throw new Error('No JSON object found in response');
      }
    }

    // Warmth-first override: low confidence defaults to warm_reflective
    if (directive.confidence < 0.5) {
      directive.recommendedPostureClass = 'warm_reflective';
    }

    return directive;
  } catch {
    // Fallback: safe defaults
    return {
      communicativeIntent: 'connecting',
      emotionalValence: 0,
      emotionalArousal: 0.3,
      challengeReadiness: 'contemplation',
      conversationalPhase: 'opening',
      recallTriggered: false,
      recallQuery: null,
      recallTier: 'none',
      recallSignals: [],
      recommendedPostureClass: 'warm_reflective',
      recommendedResponseLength: 'medium',
      challengeAppropriate: false,
      dispreferred: false,
      confidence: 0.3,
      rationale: 'Fallback: classification failed, defaulting to warm-reflective',
      communicationStyle: {
        verbosity: 'moderate',
        formality: 'moderate',
        humourPresent: false,
        disclosureLevel: 'none',
        energy: 'moderate',
      },
    };
  }
}
