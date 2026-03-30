// Deduplicate conversations: keep the longest copy per first-user-message,
// delete the rest. Migrates segments and turn logs to the surviving conversation.
// Usage: npx tsx scripts/dedup-conversations.ts [--dry-run]

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const dryRun = process.argv.includes('--dry-run');

interface Message {
  role: string;
  content: string;
}

async function main(): Promise<void> {
  const { data: convos } = await sb
    .from('conversations')
    .select('id, user_id, started_at, messages, summary, analytics, ended_at, exchange_count')
    .order('started_at', { ascending: true });

  if (!convos || convos.length === 0) {
    console.log('No conversations found.');
    return;
  }

  // Group by user_id + first user message (50 chars)
  const groups = new Map<string, typeof convos>();
  for (const c of convos) {
    const msgs = (c.messages || []) as Message[];
    const firstUser = msgs.find(m => m.role === 'user')?.content?.slice(0, 50) || '';
    if (!firstUser) continue; // skip empty conversations
    const key = `${c.user_id}|${firstUser}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }

  // Find groups with duplicates
  const dupeGroups = [...groups.entries()].filter(([, copies]) => copies.length > 1);

  if (dupeGroups.length === 0) {
    console.log('No duplicates found.');
    return;
  }

  let totalDupes = 0;
  let totalKept = 0;

  for (const [key, copies] of dupeGroups) {
    // Keep the one with the most messages (and prefer one with summary/analytics)
    copies.sort((a, b) => {
      const aScore = ((a.messages as unknown[])?.length || 0) + (a.summary ? 100 : 0) + (a.analytics ? 50 : 0);
      const bScore = ((b.messages as unknown[])?.length || 0) + (b.summary ? 100 : 0) + (b.analytics ? 50 : 0);
      return bScore - aScore;
    });

    const keeper = copies[0];
    const toDelete = copies.slice(1);
    totalKept++;
    totalDupes += toDelete.length;

    const firstMsg = key.split('|')[1]?.slice(0, 40);
    console.log(`\n"${firstMsg}" — keeping ${keeper.id.slice(0, 8)} (${(keeper.messages as unknown[]).length} msgs), deleting ${toDelete.length} copies`);

    if (dryRun) {
      for (const d of toDelete) {
        console.log(`  would delete ${d.id.slice(0, 8)} (${(d.messages as unknown[]).length} msgs)`);
      }
      continue;
    }

    const deleteIds = toDelete.map(d => d.id);

    // Migrate segments to keeper
    const { data: segsMoved } = await sb
      .from('conversation_segments')
      .update({ conversation_id: keeper.id })
      .in('conversation_id', deleteIds)
      .select('id');
    if (segsMoved?.length) console.log(`  migrated ${segsMoved.length} segments`);

    // Migrate turn logs to keeper
    const { data: turnsMoved } = await sb
      .from('turn_logs')
      .update({ conversation_id: keeper.id })
      .in('conversation_id', deleteIds)
      .select('id');
    if (turnsMoved?.length) console.log(`  migrated ${turnsMoved.length} turn logs`);

    // Migrate session health to keeper
    const { data: healthMoved } = await sb
      .from('session_health')
      .update({ conversation_id: keeper.id })
      .in('conversation_id', deleteIds)
      .select('id');
    if (healthMoved?.length) console.log(`  migrated ${healthMoved.length} health records`);

    // Migrate token usage to keeper
    const { data: usageMoved } = await sb
      .from('token_usage')
      .update({ conversation_id: keeper.id })
      .in('conversation_id', deleteIds)
      .select('id');
    if (usageMoved?.length) console.log(`  migrated ${usageMoved.length} usage records`);

    // Delete duplicate conversations
    const { error } = await sb
      .from('conversations')
      .delete()
      .in('id', deleteIds);

    if (error) {
      console.error(`  delete failed: ${error.message}`);
    } else {
      console.log(`  deleted ${deleteIds.length} duplicates`);
    }
  }

  console.log(`\n${dryRun ? 'DRY RUN — ' : ''}Summary: ${totalKept} unique conversations, ${totalDupes} duplicates ${dryRun ? 'would be ' : ''}removed`);
}

main().catch(console.error);
