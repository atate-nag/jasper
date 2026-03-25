import Anthropic from '@anthropic-ai/sdk';
import type { UserProfile, UserProfileUpdate } from './types';
import type { Message } from '@/types/message';

const MODEL = 'claude-haiku-4-5-20251001';

// ---------------------------------------------------------------------------
// classifyConversation — post-conversation analysis and profile extraction
// ---------------------------------------------------------------------------

export async function classifyConversation(
  messages: Message[],
  existingProfile?: UserProfile | null,
): Promise<{
  classification: Record<string, unknown>;
  profileUpdates: UserProfileUpdate;
  resolvedConcerns: string[];
}> {
  const anthropic = new Anthropic();

  const conversationText = messages
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  const profileContext = existingProfile
    ? `\nExisting profile:\n${JSON.stringify(existingProfile, null, 2)}`
    : '';

  const prompt = `Analyse this conversation and extract structured information.

STRICT RULES:
1. DEDUP: Do NOT add items that are semantically identical to existing profile entries. Check the existing profile carefully.
2. PATTERN THRESHOLD: Only extract patterns if you see clear evidence across multiple messages. A single mention is NOT a pattern.
3. TEMPORAL FILTER: Distinguish between durable facts and momentary states. "I'm stressed today" → current_state, NOT patterns.
4. ARRAY CAPS: Each array field should have at most 15 items. If the existing array is near the cap, only add truly novel entries.
5. TOPIC vs FACT: "We talked about cooking" is a TOPIC (goes in classification.topics). "User is a trained chef" is a FACT (goes in identity or values).
6. RESOLVED CONCERNS: If a previously active concern appears to be resolved or no longer relevant, include it in resolved_concerns.

INTERACTION PREFERENCES UPDATE RULE:
The interaction_prefs object has a FIXED set of fields:
- humour_receptivity
- challenge_tolerance
- entertainment_style
- feedback_receptivity
- directness_preference
- entertainment_request_style
- intellectual_engagement_framing

When you have new information about one of these, REWRITE the existing
field with the updated understanding. Do NOT create new fields with
suffixes like _confirmation, _update, _refinement, _addition, _validation.

STRICT SCHEMA RULE — THIS IS CRITICAL:
The profile has a FIXED schema. The ONLY permitted fields are:
- identity: { name, age_range, location, occupation, living_situation, neurodivergence }
- values: { core_values[], priorities[], what_matters_most }
- patterns: { stress_responses[], decision_patterns[], avoidance_patterns[], growth_edges[], humor_engagement[] }
- relationships: { partner{}, children[], colleagues[], key_dynamics[] }
- current_state: { active_concerns[], mood_trajectory, recent_wins[], open_questions[] }
- interaction_prefs: { humour_receptivity, challenge_tolerance, entertainment_style, feedback_receptivity, directness_preference, entertainment_request_style, intellectual_engagement_framing }

Do NOT invent new field names. Do NOT create fields like "testing_methodology",
"emotional_processing", "cephalopod_metaphor_extension", "place_as_relational_anchor",
"late_night_vulnerability_pattern", etc. These pollute the profile with unbounded keys.
If an observation doesn't fit an existing field, it belongs in the conversation summary, not the profile.

CHILDREN ARRAY RULE:
The children array is keyed by age + relationship. When updating,
match on those fields. Do NOT create a new entry for a child that
already exists — update the existing entry. Ephemeral notes like
"departed for week-long separation" should NOT be stored on the
children array — they belong in active_concerns or current_state.

${profileContext}

Conversation:
${conversationText}

Respond with ONLY valid JSON in this exact format:
{
  "classification": {
    "topics": ["topic1", "topic2"],
    "emotional_tone": "description of overall emotional tone",
    "key_themes": ["theme1", "theme2"],
    "depth_level": "surface | moderate | deep",
    "conversation_type": "casual | support | problem_solving | exploration | planning"
  },
  "profile_updates": {
    "identity": {},
    "values": {},
    "patterns": {},
    "relationships": {},
    "current_state": {},
    "interaction_prefs": {}
  },
  "resolved_concerns": []
}

Return raw JSON only. No markdown backticks, no commentary, no explanation.`;

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const text =
      response.content[0].type === 'text' ? response.content[0].text : '';

    // Strip markdown fencing — handle whitespace, newlines, multiple backtick styles
    const cleaned = text
      .replace(/^\s*```(?:json)?\s*\n?/i, '')
      .replace(/\n?\s*```\s*$/i, '')
      .trim();
    // If still not valid JSON, try extracting JSON from within the text
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No valid JSON found in classifier response');
      }
    }

    return {
      classification: parsed.classification ?? {},
      profileUpdates: parsed.profile_updates ?? {},
      resolvedConcerns: parsed.resolved_concerns ?? [],
    };
  } catch (err) {
    console.error('[classify] Classification error:', err);
    return {
      classification: {},
      profileUpdates: {},
      resolvedConcerns: [],
    };
  }
}

// ---------------------------------------------------------------------------
// dedupCandidates — second-pass semantic dedup using Claude
// ---------------------------------------------------------------------------

export async function dedupCandidates(
  candidates: string[],
  existing: string[],
  fieldName: string,
): Promise<string[]> {
  if (candidates.length === 0) return [];
  if (existing.length === 0) return candidates;

  const anthropic = new Anthropic();

  const prompt = `You are a deduplication filter for a user profile field "${fieldName}".

Existing entries:
${JSON.stringify(existing)}

Candidate new entries:
${JSON.stringify(candidates)}

Return ONLY the candidates that are genuinely NEW information — not rewordings, subsets, or semantic duplicates of existing entries.

Rules:
- "Wants to improve fitness" and "Getting healthier" are duplicates → reject the candidate
- "Enjoys cooking Italian food" and "Likes cooking" → the candidate is more specific, KEEP it
- "Stressed about work" and "Work pressure" are duplicates → reject
- If in doubt, reject — we prefer a clean profile over a cluttered one

Respond with ONLY a JSON array of strings — the candidates to keep. If none are novel, return [].`;

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const text =
      response.content[0].type === 'text' ? response.content[0].text : '[]';

    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, text];
    return JSON.parse(jsonMatch[1]?.trim() ?? text.trim());
  } catch (err) {
    console.error('[classify] Dedup error:', err);
    // On failure, return all candidates (fail open)
    return candidates;
  }
}
