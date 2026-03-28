// Query turn logs for a specific user.
// Usage: npx tsx scripts/user-logs.ts <name-or-email> [limit]
// Default limit: 20

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const search = process.argv[2];
const limit = parseInt(process.argv[3] || '20');

if (!search) {
  console.log('Usage: npx tsx scripts/user-logs.ts <name-or-email> [limit]');
  process.exit(0);
}

async function main(): Promise<void> {
  // Find user ID
  let userId: string | null = null;

  // Try by email in auth
  const { data: { users } } = await sb.auth.admin.listUsers();
  const authUser = users.find(u =>
    u.email?.toLowerCase().includes(search.toLowerCase())
  );
  if (authUser) userId = authUser.id;

  // Try by name in profile
  if (!userId) {
    const { data: profiles } = await sb.from('user_profiles')
      .select('user_id, identity')
      .limit(100);
    const match = profiles?.find(p => {
      const name = (p.identity as Record<string, unknown>)?.name as string;
      return name?.toLowerCase().includes(search.toLowerCase());
    });
    if (match) userId = match.user_id;
  }

  // Try by user_name in turn_logs
  if (!userId) {
    const { data: byName } = await sb.from('turn_logs')
      .select('user_id')
      .ilike('user_name', `%${search}%`)
      .limit(1);
    if (byName?.[0]) userId = byName[0].user_id;
  }

  if (!userId) {
    console.log(`No user found matching "${search}"`);
    return;
  }

  const { data: logs, error } = await sb.from('turn_logs')
    .select('created_at, user_name, intent, posture, policy_id, model_used, model_tier, prompt_tokens, history_message_count, recall_tier, steer_latency_ms, user_message, assistant_response')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Query error:', error.message);
    return;
  }

  if (!logs || logs.length === 0) {
    console.log('No turn logs found. (Logs only exist for turns after this feature was deployed.)');
    return;
  }

  console.log(`\n=== Turn logs for ${logs[0].user_name || search} (last ${logs.length}) ===\n`);

  // Show in chronological order
  const sorted = [...logs].reverse();
  for (const log of sorted) {
    const time = log.created_at?.slice(11, 19) || '??:??:??';
    console.log(`[${time}] ${log.intent}→${log.policy_id} | ${log.model_used} (${log.model_tier}) | msgs=${log.history_message_count} prompt=${log.prompt_tokens}t | steer=${log.steer_latency_ms}ms | recall=${log.recall_tier || 'no'}`);
    console.log(`  User: ${log.user_message?.slice(0, 80)}`);
    console.log(`  Jasper: ${log.assistant_response?.slice(0, 80)}`);
    console.log();
  }
}

main().catch(console.error);
