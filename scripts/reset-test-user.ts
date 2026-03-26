// Reset the ephemeral test user to a clean cold-start state.
// Deletes ALL data (conversations, segments, turn logs, profile)
// then creates a fresh clone profile from Master Jasper.
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

  console.log('Resetting test user:', TEST_USER_ID);

  // Delete ALL data — order matters for foreign key constraints
  for (const table of ['turn_logs', 'conversation_segments', 'conversations', 'bandit_state', 'user_profiles']) {
    const { count, error } = await sb.from(table).delete({ count: 'exact' }).eq('user_id', TEST_USER_ID);
    if (error) {
      console.log(`  ${table}: error — ${error.message}`);
    } else if (count) {
      console.log(`  ${table}: deleted ${count} rows`);
    }
  }

  // Verify deletion
  const { count: remainingConvos } = await sb.from('conversations').select('*', { count: 'exact', head: true }).eq('user_id', TEST_USER_ID);
  const { count: remainingSegments } = await sb.from('conversation_segments').select('*', { count: 'exact', head: true }).eq('user_id', TEST_USER_ID);
  if (remainingConvos || remainingSegments) {
    console.log(`  WARNING: ${remainingConvos} conversations and ${remainingSegments} segments still remain!`);
  }

  // Create fresh clone profile from Master Jasper
  const { createCloneProfile } = await import('../src/lib/backbone/clone');
  await createCloneProfile(TEST_USER_ID);

  console.log('\nClean slate ready. Run:\n');
  console.log('  npm run test-jasper\n');
}

main().catch(console.error);
