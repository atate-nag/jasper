// Backfill session-end processing for all unended conversations.
// Usage: npx tsx scripts/backfill-session-end.ts [--dry-run]
// Processes sequentially to avoid overwhelming Opus.

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
  timestamp?: string;
}

async function main(): Promise<void> {
  // Get all unended conversations with enough messages
  const { data: convos, error } = await sb
    .from('conversations')
    .select('id, user_id, started_at, messages')
    .is('ended_at', null)
    .order('started_at', { ascending: true });

  if (error) {
    console.error('Query error:', error.message);
    return;
  }

  const toProcess = (convos || []).filter(c => {
    const msgs = c.messages as Message[] | null;
    return msgs && msgs.length >= 4;
  });

  const tooShort = (convos || []).length - toProcess.length;

  console.log(`Found ${convos?.length || 0} unended conversations`);
  console.log(`  ${toProcess.length} with ≥4 messages (will process)`);
  console.log(`  ${tooShort} too short (will mark ended without processing)`);
  if (dryRun) {
    console.log('\n--dry-run: not processing anything\n');
    for (const c of toProcess) {
      const msgs = c.messages as Message[];
      console.log(`  ${c.started_at?.slice(0, 16)} | ${msgs.length} msgs | user=${c.user_id.slice(0, 8)}`);
    }
    return;
  }

  // Mark short conversations as ended (no processing needed)
  const shortIds = (convos || [])
    .filter(c => {
      const msgs = c.messages as Message[] | null;
      return !msgs || msgs.length < 4;
    })
    .map(c => c.id);

  if (shortIds.length > 0) {
    const { error: updateErr } = await sb
      .from('conversations')
      .update({ ended_at: new Date().toISOString() })
      .in('id', shortIds);
    if (updateErr) console.error('Failed to mark short convos:', updateErr.message);
    else console.log(`Marked ${shortIds.length} short conversations as ended`);
  }

  // Process substantive conversations
  // Dynamic import to get the compiled module
  const { runSessionEnd } = await import('../src/lib/post-response');

  let processed = 0;
  let failed = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const conv = toProcess[i];
    const messages = conv.messages as Message[];
    console.log(`\n[${i + 1}/${toProcess.length}] Conv ${conv.id.slice(0, 8)} | user=${conv.user_id.slice(0, 8)} | ${messages.length} messages | ${conv.started_at?.slice(0, 16)}`);

    try {
      await runSessionEnd(conv.user_id, conv.id, messages);
      processed++;
      console.log(`  ✓ Done`);
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ Failed: ${msg}`);
    }
  }

  console.log(`\nBackfill complete: ${processed} processed, ${failed} failed, ${shortIds.length} marked ended (short)`);
}

main().catch(console.error);
