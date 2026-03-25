// Clone profile creation — copies Master Jasper's profile for new users.

import { getSupabaseAdmin } from '@/lib/supabase';
import { defaultCalibration } from './profile';

const MASTER_USER_ID = '3a1272b1-577c-42a4-801e-e952fed68971';

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

  // Copy Jasper's character and self-knowledge, reset user-specific data
  const cloneProfile = {
    user_id: newUserId,
    // User-specific fields start empty — the clone doesn't know THIS person
    identity: {},
    values: {},
    patterns: {},
    relationships: {},
    current_state: {},
    interaction_prefs: {},
    // Jasper's character carries over — this IS Jasper
    jasper_character: master.jasper_character,
    self_observations: master.self_observations,
    // Calibration: keep Jasper's learned parameters but reset signals
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
    // Fall back to empty profile
    await createEmptyProfile(newUserId);
  } else {
    console.log(`[clone] Created clone profile for ${newUserId} from master ${MASTER_USER_ID}`);
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
