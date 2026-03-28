import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function bootstrap(userId: string, label: string): Promise<void> {
  console.log(`\nBootstrapping threads for ${label} (${userId})...`);

  const { data: profile } = await sb.from('user_profiles').select('identity').eq('user_id', userId).single();
  const name = (profile?.identity as Record<string, unknown>)?.name as string || 'this person';

  // Get recent summaries
  const { data: convos } = await sb.from('conversations')
    .select('summary')
    .eq('user_id', userId)
    .not('summary', 'is', null)
    .order('started_at', { ascending: false })
    .limit(20);
  const summaries = (convos || []).map(c => c.summary).filter(Boolean) as string[];

  // Get high-importance segments (also check master for clone users)
  const { data: profileFull } = await sb.from('user_profiles').select('clone_source_user_id').eq('user_id', userId).single();
  const userIds = [userId];
  if (profileFull?.clone_source_user_id) userIds.push(profileFull.clone_source_user_id);

  const { data: segments } = await sb.from('conversation_segments')
    .select('content')
    .in('user_id', userIds)
    .gte('importance_score', 7)
    .order('importance_score', { ascending: false })
    .limit(20);
  const segmentTexts = (segments || []).map(s => s.content) as string[];

  // Count sessions
  const { count } = await sb.from('conversations').select('*', { count: 'exact', head: true }).eq('user_id', userId);

  console.log(`  ${summaries.length} summaries, ${segmentTexts.length} high-importance segments, ${count} sessions`);

  if (summaries.length === 0 && segmentTexts.length === 0) {
    console.log('  No data — skipping');
    return;
  }

  const { identifyFoundationalThreads } = await import('../src/lib/intermediary/relational-threads');
  const threads = await identifyFoundationalThreads(name, summaries, segmentTexts, count || 0);

  const { error } = await sb.from('user_profiles')
    .update({ relational_threads: threads })
    .eq('user_id', userId);

  if (error) {
    console.error('  Failed:', error.message);
  } else {
    console.log(`  Identified ${threads.length} threads:`);
    threads.forEach(t => console.log(`    - ${t.thread}`));
  }
}

async function main(): Promise<void> {
  // Bootstrap for all users with conversations
  await bootstrap('3a1272b1-577c-42a4-801e-e952fed68971', 'Adrian (Master)');
  await bootstrap('3c22b725-4709-4b47-9100-6e6bb62f8dc2', 'Lyndsay');
  await bootstrap('6eaabe23-4858-4d11-aaa5-803c5b844288', 'Ady');
}

main().catch(console.error);
