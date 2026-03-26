import { getSupabase } from '@/lib/supabase';
import type { UserProfile, UserProfileUpdate, RelationshipMeta, CalibrationParameters } from './types';
import { dedupCandidates } from './classify';

// ---------------------------------------------------------------------------
// Helpers — deep merge logic
// ---------------------------------------------------------------------------

/** Canonical key for entity-like objects (people, etc.) */
function entityKey(obj: Record<string, unknown>): string {
  return (
    (obj.name as string) ??
    (obj.label as string) ??
    (obj.id as string) ??
    JSON.stringify(obj)
  ).toLowerCase();
}

/** Merge two entity arrays by canonical key, preferring newer entries. */
function mergeEntityArray(
  existing: Record<string, unknown>[],
  incoming: Record<string, unknown>[],
): Record<string, unknown>[] {
  const map = new Map<string, Record<string, unknown>>();
  for (const e of existing) map.set(entityKey(e), e);
  for (const e of incoming) {
    const key = entityKey(e);
    const prev = map.get(key);
    map.set(key, prev ? { ...prev, ...e } : e);
  }
  return [...map.values()];
}

/** Deep merge two field values. Arrays of primitives are unioned; arrays of
 *  objects are entity-merged; nested objects recurse. */
function mergeFields(existing: unknown, incoming: unknown): unknown {
  if (incoming === null || incoming === undefined) return existing;
  if (existing === null || existing === undefined) return incoming;

  // Both arrays
  if (Array.isArray(existing) && Array.isArray(incoming)) {
    // Array of objects → entity merge
    if (existing.length > 0 && typeof existing[0] === 'object' && existing[0] !== null) {
      return mergeEntityArray(
        existing as Record<string, unknown>[],
        incoming as Record<string, unknown>[],
      );
    }
    // Array of primitives → union
    return [...new Set([...existing, ...incoming])];
  }

  // Both plain objects
  if (
    typeof existing === 'object' &&
    typeof incoming === 'object' &&
    !Array.isArray(existing) &&
    !Array.isArray(incoming)
  ) {
    const merged: Record<string, unknown> = { ...(existing as Record<string, unknown>) };
    for (const [k, v] of Object.entries(incoming as Record<string, unknown>)) {
      merged[k] = mergeFields(merged[k], v);
    }
    return merged;
  }

  // Primitives — incoming wins
  return incoming;
}

// ---------------------------------------------------------------------------
// bareProfile — empty scaffold for new users
// ---------------------------------------------------------------------------

export function bareProfile(userId: string): UserProfile {
  return {
    id: '',
    user_id: userId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    identity: {},
    values: {},
    patterns: {},
    relationships: {},
    current_state: {},
    interaction_prefs: {},
  };
}

// ---------------------------------------------------------------------------
// getProfile — fetch from user_profiles, with relationshipMeta computation
// ---------------------------------------------------------------------------

export async function getProfile(userId: string): Promise<UserProfile | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('[profile] Error fetching profile:', error.message);
    return null;
  }

  return data as UserProfile | null;
}

// ---------------------------------------------------------------------------
// upsertProfile — full upsert to user_profiles
// ---------------------------------------------------------------------------

export async function upsertProfile(
  userId: string,
  updates: UserProfileUpdate,
): Promise<UserProfile | null> {
  const supabase = getSupabase();

  const payload = {
    user_id: userId,
    updated_at: new Date().toISOString(),
    ...updates,
  };

  const { data, error } = await supabase
    .from('user_profiles')
    .upsert(payload, { onConflict: 'user_id' })
    .select()
    .single();

  if (error) {
    console.error('[profile] Error upserting profile:', error.message);
    return null;
  }

  return data as UserProfile;
}

// ---------------------------------------------------------------------------
// patchProfileField — deep merge a single JSONB field
// ---------------------------------------------------------------------------

export async function patchProfileField(
  userId: string,
  field: keyof UserProfileUpdate,
  patch: Record<string, unknown>,
): Promise<UserProfile | null> {
  const existing = await getProfile(userId);
  const currentValue = existing?.[field] ?? {};
  const merged = mergeFields(currentValue, patch);

  return upsertProfile(userId, { [field]: merged } as UserProfileUpdate);
}

// ---------------------------------------------------------------------------
// replaceProfileField — overwrite specific keys within a JSONB field (no merge)
// ---------------------------------------------------------------------------

export async function replaceProfileField(
  userId: string,
  field: keyof UserProfileUpdate,
  patch: Record<string, unknown>,
): Promise<UserProfile | null> {
  const existing = await getProfile(userId);
  const currentValue = (existing?.[field] as Record<string, unknown>) ?? {};
  // Shallow merge at the section level, but REPLACE individual keys (no array union)
  const updated = { ...currentValue, ...patch };

  return upsertProfile(userId, { [field]: updated } as UserProfileUpdate);
}

/**
 * Overwrite an entire JSONB section wholesale — no merge with existing data.
 * Used by profile compression to ensure suffixed keys are truly removed.
 */
export async function replaceProfileSection(
  userId: string,
  field: keyof UserProfileUpdate,
  value: Record<string, unknown>,
): Promise<UserProfile | null> {
  return upsertProfile(userId, { [field]: value } as UserProfileUpdate);
}

// ---------------------------------------------------------------------------
// mergeProfileUpdates — deep merge with semantic dedup
// ---------------------------------------------------------------------------

export async function mergeProfileUpdates(
  userId: string,
  updates: UserProfileUpdate,
): Promise<UserProfile | null> {
  const existing = await getProfile(userId);
  const base = existing ?? bareProfile(userId);

  const merged: Record<string, unknown> = {};
  const profileFields: (keyof UserProfileUpdate)[] = [
    'identity',
    'values',
    'patterns',
    'relationships',
    'current_state',
    'interaction_prefs',
  ];

  for (const field of profileFields) {
    const incoming = updates[field];
    if (!incoming) continue;

    const current = (base as unknown as Record<string, unknown>)[field] ?? {};
    let fieldMerged = mergeFields(current, incoming) as Record<string, unknown>;

    // Semantic dedup on array fields
    for (const [key, value] of Object.entries(fieldMerged)) {
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
        const existingArr = ((current as Record<string, unknown>)[key] as string[]) ?? [];
        const candidates = value.filter((v: string) => !existingArr.includes(v));
        if (candidates.length > 0) {
          const deduped = await dedupCandidates(candidates, existingArr, `${field}.${key}`);
          fieldMerged[key] = [...new Set([...existingArr, ...deduped])];
        }
      }
    }

    // Hard array caps — the classifier prompt asks for limits but doesn't respect them.
    // This is the enforcement layer. When an array exceeds its cap, keep only the
    // most recent entries (last N). The compression script handles quality merging;
    // this just prevents unbounded growth between compressions.
    const ARRAY_CAPS: Record<string, number> = {
      decision_patterns: 8,
      growth_edges: 6,
      stress_responses: 4,
      avoidance_patterns: 4,
      humor_engagement: 4,
      active_concerns: 6,
      recent_wins: 6,
      open_questions: 8,
      key_dynamics: 8,
      core_values: 8,
      priorities: 6,
      children: 4,
      colleagues: 4,
    };

    for (const [key, value] of Object.entries(fieldMerged)) {
      if (Array.isArray(value)) {
        const cap = ARRAY_CAPS[key];
        if (cap && value.length > cap) {
          fieldMerged[key] = value.slice(-cap); // keep most recent
        }
      }
    }

    // Reject any new keys not in the canonical schema
    const CANONICAL_KEYS: Record<string, string[]> = {
      identity: ['name', 'age_range', 'location', 'occupation', 'living_situation', 'neurodivergence'],
      values: ['core_values', 'priorities', 'what_matters_most'],
      patterns: ['stress_responses', 'decision_patterns', 'avoidance_patterns', 'growth_edges', 'humor_engagement'],
      relationships: ['partner', 'children', 'colleagues', 'key_dynamics'],
      current_state: ['active_concerns', 'mood_trajectory', 'recent_wins', 'open_questions'],
      interaction_prefs: ['humour_receptivity', 'challenge_tolerance', 'entertainment_style', 'feedback_receptivity', 'directness_preference', 'entertainment_request_style', 'intellectual_engagement_framing'],
    };

    const allowedKeys = CANONICAL_KEYS[field];
    if (allowedKeys) {
      for (const key of Object.keys(fieldMerged)) {
        if (!allowedKeys.includes(key)) {
          delete fieldMerged[key];
        }
      }
    }

    merged[field] = fieldMerged;
  }

  return upsertProfile(userId, merged as UserProfileUpdate);
}

// ---------------------------------------------------------------------------
// removeResolvedConcerns — filter out resolved concerns from current_state
// ---------------------------------------------------------------------------

export async function removeResolvedConcerns(
  userId: string,
  resolved: string[],
): Promise<UserProfile | null> {
  const existing = await getProfile(userId);
  if (!existing) return null;

  const currentState = { ...existing.current_state };
  if (currentState.active_concerns) {
    const lower = resolved.map((r) => r.toLowerCase());
    currentState.active_concerns = currentState.active_concerns.filter(
      (c) => !lower.some((r) => c.toLowerCase().includes(r) || r.includes(c.toLowerCase())),
    );
  }

  return upsertProfile(userId, { current_state: currentState });
}

// ---------------------------------------------------------------------------
// buildClassifierSummary — concise person summary for the classifier
// ---------------------------------------------------------------------------

/**
 * Build a concise person summary for the classifier.
 * 150-250 tokens MAX — enough to calibrate, not enough to bias.
 * Does NOT include: growth edges, avoidance patterns, decision patterns, stress responses.
 */
export function buildClassifierSummary(profile: UserProfile, relationshipMeta: RelationshipMeta): string {
  const identity = [
    profile.identity?.occupation,
    profile.identity?.age_range,
    profile.identity?.living_situation,
  ].filter(Boolean).join('. ');

  const commParts: string[] = [];
  if (profile.interaction_prefs?.directness_preference) {
    commParts.push(`Directness: ${profile.interaction_prefs.directness_preference}`);
  }
  if (profile.interaction_prefs?.humour_receptivity) {
    commParts.push(`Humour: ${profile.interaction_prefs.humour_receptivity}`);
  }
  if (profile.interaction_prefs?.challenge_tolerance) {
    commParts.push(`Challenge tolerance: ${profile.interaction_prefs.challenge_tolerance}`);
  }
  const commStyle = commParts.length > 0 ? commParts.join('. ') : '';

  const relationship = relationshipMeta.conversationCount <= 5
    ? 'Early relationship — still building trust.'
    : relationshipMeta.conversationCount <= 15
      ? 'Developing relationship — moderate trust established.'
      : 'Established relationship — high trust, directness welcome.';

  const hasIdentity = identity.length > 0;

  if (!hasIdentity && !commStyle) {
    // New user — minimal summary
    const parts = ['PERSON SUMMARY (for classification):'];
    parts.push('New user — no prior interaction history.');
    parts.push('Communication style: unknown — observe and match.');
    parts.push(`Relationship: ${relationship}`);
    return parts.join('\n');
  }

  const parts = ['PERSON SUMMARY (for classification — do not over-interpret):'];
  if (identity) parts.push(identity);
  if (commStyle) parts.push(`Communication: ${commStyle}`);
  parts.push(`Relationship: ${relationship}`);
  if (profile.values?.what_matters_most) {
    parts.push(`Values: ${profile.values.what_matters_most}`);
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// compressProfile — compress array fields via LLM
// ---------------------------------------------------------------------------

/**
 * Consolidate suffixed keys back into their base fields, then compress.
 * The classifier sometimes invents keys like "decision_patterns_addition",
 * "challenge_tolerance_refinement", "mood_trajectory_update" etc.
 * These need to be folded into the canonical field before compression.
 */
export async function compressProfile(userId: string): Promise<void> {
  const profile = await getProfile(userId);
  if (!profile) return;

  // Step 1: Consolidate suffixed keys into base fields per section
  const sections: (keyof UserProfileUpdate)[] = [
    'patterns', 'current_state', 'interaction_prefs', 'relationships',
  ];

  for (const section of sections) {
    const sectionData = profile[section] as Record<string, unknown> | undefined;
    if (!sectionData) continue;

    const consolidated = consolidateSection(sectionData);
    if (consolidated.changed) {
      console.log(`  consolidating ${section}: removed ${consolidated.removedKeys.join(', ')}`);
      // Write the ENTIRE section — replaceProfileSection overwrites wholesale,
      // so the suffixed keys in the DB are truly removed.
      await replaceProfileSection(userId, section, consolidated.data);
    }
  }

  // Re-read after consolidation
  const updated = await getProfile(userId);
  if (!updated) return;

  // Step 2: Compress array and string fields, writing each section once
  const compressionSpec: { section: keyof UserProfileUpdate; field: string; max: number }[] = [
    { section: 'patterns', field: 'decision_patterns', max: 8 },
    { section: 'patterns', field: 'growth_edges', max: 6 },
    { section: 'patterns', field: 'stress_responses', max: 4 },
    { section: 'patterns', field: 'avoidance_patterns', max: 4 },
    { section: 'patterns', field: 'humor_engagement', max: 4 },
    { section: 'current_state', field: 'active_concerns', max: 6 },
    { section: 'current_state', field: 'recent_wins', max: 6 },
    { section: 'current_state', field: 'open_questions', max: 8 },
    { section: 'relationships', field: 'key_dynamics', max: 8 },
  ];

  // Group by section so we can write each section once
  const sectionUpdates = new Map<keyof UserProfileUpdate, Record<string, unknown>>();

  for (const { section, field, max } of compressionSpec) {
    const sectionData = updated[section] as Record<string, unknown> | undefined;
    if (!sectionData) continue;
    const entries = sectionData[field];
    if (!Array.isArray(entries) || entries.length <= max) continue;

    // Filter out non-string entries (e.g. single chars from a corrupted string→array cast)
    const validEntries = entries.filter((e): e is string => typeof e === 'string' && e.length > 3);
    if (validEntries.length <= max) {
      // Just clean up the invalid entries
      if (!sectionUpdates.has(section)) sectionUpdates.set(section, {});
      sectionUpdates.get(section)![field] = validEntries;
      continue;
    }

    console.log(`  compressing ${section}.${field}: ${validEntries.length} → max ${max}`);
    try {
      const compressed = await compressFieldWithHaiku(field, validEntries, max);
      if (!sectionUpdates.has(section)) sectionUpdates.set(section, {});
      sectionUpdates.get(section)![field] = compressed;
      console.log(`  compressed to ${compressed.length} entries`);
    } catch (err) {
      console.error(`  compression failed for ${field}:`, err);
    }
  }

  // Write all compressed fields per section in one shot
  for (const [section, fieldUpdates] of sectionUpdates) {
    const currentSection = (updated[section] as Record<string, unknown>) ?? {};
    const merged = { ...currentSection, ...fieldUpdates };
    await replaceProfileSection(userId, section, merged);
  }

  // Step 3: Trim overly long string values (interaction_prefs, current_state)
  const reloaded = await getProfile(userId);
  if (!reloaded) return;

  for (const section of ['interaction_prefs', 'current_state'] as const) {
    const data = reloaded[section] as Record<string, unknown> | undefined;
    if (!data) continue;
    let trimmed = false;
    const cleaned = { ...data };
    for (const [k, v] of Object.entries(cleaned)) {
      if (typeof v === 'string' && v.length > 200) {
        cleaned[k] = v.slice(0, 200);
        console.log(`  trimming ${section}.${k}: ${v.length} → 200 chars`);
        trimmed = true;
      }
    }
    if (trimmed) {
      await replaceProfileSection(userId, section, cleaned);
    }
  }
}

// ---------------------------------------------------------------------------
// defaultCalibration — cold-start calibration parameters
// ---------------------------------------------------------------------------

export function defaultCalibration(): CalibrationParameters {
  return {
    // Beta(2, 5) → mean 0.29, conservative, skewed toward caution
    challengeCeiling: 0.29,
    challengeAlpha: 2,
    challengeBeta: 5,
    // Beta(3, 3) → mean 0.50, neutral, high uncertainty
    humourTolerance: 0.50,
    humourAlpha: 3,
    humourBeta: 3,
    // Beta(3, 4) → mean 0.43, slightly cautious
    directnessPreference: 0.43,
    directnessAlpha: 3,
    directnessBeta: 4,
    // Beta(2, 4) → mean 0.33, conservative
    disclosureComfort: 0.33,
    disclosureAlpha: 2,
    disclosureBeta: 4,
    // Beta(4, 2) → mean 0.67, warmth-first default
    warmthNeed: 0.67,
    warmthAlpha: 4,
    warmthBeta: 2,
    preferredRegister: 'warm_reflective',
    onboardingCompleted: false,
    voicePreference: null,
  };
}

const SUFFIXES = ['_addition', '_refinement', '_update', '_confirmation', '_deletion', '_noted'];

/**
 * Find keys like "foo_addition", "foo_refinement", etc. and fold them into "foo".
 * For arrays: concatenate. For strings: keep the most recent (longest suffix chain).
 */
function consolidateSection(
  data: Record<string, unknown>,
): { data: Record<string, unknown>; changed: boolean; removedKeys: string[] } {
  const result: Record<string, unknown> = {};
  const removedKeys: string[] = [];
  const processed = new Set<string>();

  // First pass: identify base keys and their suffixed variants
  const allKeys = Object.keys(data);
  const baseKeys = new Set<string>();

  for (const key of allKeys) {
    let base = key;
    // Strip chained suffixes: "foo_refinement_addition" → "foo"
    let stripped = true;
    while (stripped) {
      stripped = false;
      for (const suffix of SUFFIXES) {
        if (base.endsWith(suffix)) {
          base = base.slice(0, -suffix.length);
          stripped = true;
        }
      }
    }
    baseKeys.add(base);
  }

  // Second pass: for each base key, collect all variants and merge
  for (const base of baseKeys) {
    const variants = allKeys.filter(k => k === base || isVariantOf(k, base));

    if (variants.length === 1) {
      // No suffixed variants — keep as is
      result[variants[0]] = data[variants[0]];
      continue;
    }

    // Multiple variants exist — merge into base, drop suffixed keys.
    // The base field's TYPE is authoritative: if the base is a string,
    // all variants are discarded (the base value wins). If the base is
    // an array, variant arrays are concatenated. Never mix types.
    const baseValue = data[base];

    // Determine the canonical type from the base key (if it exists)
    const canonicalType = baseValue !== undefined
      ? (Array.isArray(baseValue) ? 'array' : typeof baseValue)
      : undefined;

    if (canonicalType === 'array') {
      // Array field: concatenate variant arrays (skip non-array variants)
      const combined: unknown[] = [];
      for (const v of variants) {
        const val = data[v];
        if (Array.isArray(val)) {
          combined.push(...val);
        }
        // Non-array variants (strings) are dropped — they're refinement
        // text that doesn't belong in an array
        if (v !== base) removedKeys.push(v);
      }
      // Dedup string arrays
      if (combined.length > 0 && typeof combined[0] === 'string') {
        result[base] = [...new Set(combined as string[])];
      } else {
        result[base] = combined;
      }
    } else {
      // String or other type: keep the base value, discard all variants.
      // Suffixed variants are refinements/confirmations — the base value
      // is the canonical version.
      result[base] = baseValue ?? data[variants[0]];
      for (const v of variants) {
        if (v !== base) removedKeys.push(v);
      }
    }
  }

  return {
    data: result,
    changed: removedKeys.length > 0,
    removedKeys,
  };
}

function isVariantOf(key: string, base: string): boolean {
  if (!key.startsWith(base)) return false;
  const remainder = key.slice(base.length);
  if (remainder === '') return true;
  return SUFFIXES.some(s => remainder.startsWith(s));
}

async function compressFieldWithHaiku(
  fieldName: string,
  entries: string[],
  maxEntries: number,
): Promise<string[]> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const anthropic = new Anthropic();

  const prompt = `You are compressing a profile section. The current "${fieldName}" field has ${entries.length} entries, many of which overlap or restate the same observation in different words.

CURRENT ENTRIES:
${entries.map((e, i) => `${i + 1}. ${e}`).join('\n')}

YOUR TASK:
Produce a compressed version with AT MOST ${maxEntries} entries.
Each entry should be:
- Concise (one sentence, max two)
- Distinct from every other entry (no semantic overlap)
- The best available articulation of that observation (pick the crispest version)

If five entries describe variations of the same pattern, produce ONE entry that captures the core pattern. Kill the duplicates. Be ruthless.

Return ONLY a valid JSON array of strings. No commentary.`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    temperature: 0,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = response.content[0];
  if (block.type !== 'text') return entries;

  const raw = block.text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  return JSON.parse(raw) as string[];
}
