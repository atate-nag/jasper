// Clone profile creation — copies Master Jasper's CHARACTER for new users.
// User-specific data (identity, patterns, concerns) is always empty.
// Jasper's character, self-observations, and communication style carry over.

import { getSupabaseAdmin } from '@/lib/supabase';
import { defaultCalibration } from './profile';

const MASTER_USER_ID = '3a1272b1-577c-42a4-801e-e952fed68971';

/**
 * Sanitise interaction_prefs: keep Jasper's communication style,
 * strip anything that describes how a specific user (Adrian) behaves.
 */
function sanitiseInteractionPrefs(masterPrefs: Record<string, unknown> | null): Record<string, unknown> {
  if (!masterPrefs) return {};

  // These describe HOW JASPER communicates — keep them
  const keepKeys = [
    'intellectual_engagement_framing',
    'humour_receptivity',
    'directness_preference',
    'feedback_receptivity',
    'entertainment_style',
  ];

  const sanitised: Record<string, unknown> = {};
  for (const key of keepKeys) {
    if (masterPrefs[key]) {
      sanitised[key] = masterPrefs[key];
    }
  }

  // Everything else (challenge_tolerance, entertainment_request_style, etc.)
  // describes how the USER behaves — strip it. These will rebuild naturally
  // for each new user through calibration.

  return sanitised;
}

export async function createCloneProfile(newUserId: string): Promise<void> {
  const sb = getSupabaseAdmin();

  // Load Master Jasper's current profile
  const { data: master, error } = await sb
    .from('user_profiles')
    .select('*')
    .eq('user_id', MASTER_USER_ID)
    .single();

  if (error || !master) {
    console.error('[clone] Failed to load master profile:', error?.message);
    await createEmptyProfile(newUserId);
    return;
  }

  const cloneProfile = {
    user_id: newUserId,

    // EMPTY — these are Adrian's data, not Jasper's character
    identity: {},
    values: {},
    patterns: {},
    relationships: {},
    current_state: {},

    // SANITISED — keep Jasper's communication style, strip user-specific observations
    interaction_prefs: sanitiseInteractionPrefs(master.interaction_prefs as Record<string, unknown>),

    // KEEP — these are Jasper's character and self-knowledge
    jasper_character: master.jasper_character,
    self_observations: master.self_observations,

    // Calibration: keep Jasper's learned parameters but reset depth and signals
    calibration: {
      ...(master.calibration || defaultCalibration()),
      preferredRegister: 'first_encounter',
      onboardingCompleted: false,
    },

    // Track the clone source
    clone_source_user_id: MASTER_USER_ID,
  };

  const { error: insertError } = await sb
    .from('user_profiles')
    .insert(cloneProfile);

  if (insertError) {
    console.error('[clone] Failed to create clone profile:', insertError.message);
    await createEmptyProfile(newUserId);
  } else {
    console.log(`[clone] Created sanitised clone profile for ${newUserId}`);
  }
}

async function createEmptyProfile(userId: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('user_profiles')
    .insert({
      user_id: userId,
      identity: {},
      values: {},
      patterns: {},
      relationships: {},
      current_state: {},
      interaction_prefs: {},
      calibration: defaultCalibration(),
      self_observations: [],
    });

  if (error) {
    console.error('[clone] Failed to create empty profile:', error.message);
  }
}
