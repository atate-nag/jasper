// Reset the ephemeral test user to a clean cold-start state.
// Usage: npx tsx scripts/reset-test-user.ts

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const TEST_USER_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

async function main(): Promise<void> {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { defaultCalibration } = await import('../src/lib/backbone/profile');

  console.log('Resetting test user:', TEST_USER_ID);

  // Delete all data
  for (const table of ['turn_logs', 'conversation_segments', 'conversations', 'bandit_state', 'user_profiles']) {
    const { count } = await sb.from(table).delete({ count: 'exact' }).eq('user_id', TEST_USER_ID);
    if (count) console.log(`  ${table}: deleted ${count} rows`);
  }

  // Create fresh profile
  const { error } = await sb.from('user_profiles').insert({
    user_id: TEST_USER_ID,
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
    console.error('Failed to create profile:', error.message);
  } else {
    console.log('\nClean slate ready. Run:\n');
    console.log('  npm run test-jasper\n');
  }
}

main().catch(console.error);
