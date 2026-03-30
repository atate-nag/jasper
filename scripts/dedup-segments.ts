// Deduplicate conversation segments: keep one copy of near-identical segments.
// Usage: npx tsx scripts/dedup-segments.ts [user-email] [--dry-run]

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const userEmail = process.argv[2];
const dryRun = process.argv.includes('--dry-run');

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);
}

async function main(): Promise<void> {
  let userId: string | null = null;

  if (userEmail && !userEmail.startsWith('--')) {
    const { data: { users } } = await sb.auth.admin.listUsers();
    const user = users.find(u => u.email === userEmail);
    if (!user) { console.log(`User ${userEmail} not found`); return; }
    userId = user.id;
  }

  let query = sb.from('conversation_segments')
    .select('id, user_id, content, segment_type, importance_score, created_at')
    .order('created_at', { ascending: true });

  if (userId) query = query.eq('user_id', userId);

  const { data: segments } = await query;
  if (!segments || segments.length === 0) { console.log('No segments found.'); return; }

  // Group by user
  const byUser = new Map<string, typeof segments>();
  for (const s of segments) {
    if (!byUser.has(s.user_id)) byUser.set(s.user_id, []);
    byUser.get(s.user_id)!.push(s);
  }

  let totalKept = 0;
  let totalDeleted = 0;

  for (const [uid, userSegs] of byUser) {
    // Group by normalised first 100 chars
    const groups = new Map<string, typeof segments>();
    for (const s of userSegs) {
      const key = normalise(s.content || '');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    }

    const dupeGroups = [...groups.entries()].filter(([, copies]) => copies.length > 1);
    if (dupeGroups.length === 0) continue;

    console.log(`\nUser ${uid.slice(0, 8)}: ${userSegs.length} segments, ${dupeGroups.length} duplicate groups`);

    for (const [key, copies] of dupeGroups) {
      // Keep the one with highest importance, or most recent
      copies.sort((a, b) => (b.importance_score || 0) - (a.importance_score || 0));
      const keeper = copies[0];
      const toDelete = copies.slice(1);
      totalKept++;
      totalDeleted += toDelete.length;

      if (dryRun) {
        console.log(`  "${key.slice(0, 60)}..." — keep 1, delete ${toDelete.length}`);
      }
    }

    if (!dryRun) {
      const allDeleteIds = dupeGroups.flatMap(([, copies]) => copies.slice(1).map(c => c.id));
      // Delete in batches of 50
      for (let i = 0; i < allDeleteIds.length; i += 50) {
        const batch = allDeleteIds.slice(i, i + 50);
        const { error } = await sb.from('conversation_segments').delete().in('id', batch);
        if (error) console.error(`  Delete batch error: ${error.message}`);
      }
      console.log(`  Deleted ${allDeleteIds.length} duplicate segments`);
    }
  }

  console.log(`\n${dryRun ? 'DRY RUN — ' : ''}Summary: ${totalKept} unique kept, ${totalDeleted} duplicates ${dryRun ? 'would be ' : ''}removed`);
}

main().catch(console.error);
