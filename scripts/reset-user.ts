// Reset any user to clean clone state.
// Usage: npx tsx scripts/reset-user.ts <email>
// Archives data before deleting, then creates fresh clone profile.

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const email = process.argv[2];

if (!email) {
  console.log('Usage: npx tsx scripts/reset-user.ts <email>');
  process.exit(0);
}

async function main(): Promise<void> {
  const { data: { users } } = await sb.auth.admin.listUsers();
  const user = users.find(u => u.email === email);
  if (!user) {
    console.log(`User ${email} not found`);
    process.exit(1);
  }

  const uid = user.id;
  console.log(`Resetting ${email} (${uid})`);

  // Archive
  const { data: convos } = await sb.from('conversations').select('*').eq('user_id', uid);
  const { data: segments } = await sb.from('conversation_segments').select('*').eq('user_id', uid);
  const { data: profile } = await sb.from('user_profiles').select('*').eq('user_id', uid).single();

  const withMsgs = (convos || []).filter((c: Record<string, unknown>) => c.messages && (c.messages as unknown[]).length > 0);
  if (withMsgs.length > 0) {
    const dir = join(process.cwd(), 'scripts', 'test-archives');
    mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const name = email.split('@')[0];
    writeFileSync(join(dir, `archive-${name}-${ts}.json`), JSON.stringify({
      archived_at: new Date().toISOString(),
      user_id: uid,
      email,
      summary: {
        conversations: withMsgs.length,
        messages: withMsgs.reduce((s: number, c: Record<string, unknown>) => s + (c.messages as unknown[]).length, 0),
        segments: (segments || []).length,
      },
      profile,
      conversations: withMsgs,
      segments,
    }, null, 2));
    console.log(`Archived ${withMsgs.length} conversations, ${(segments || []).length} segments`);
  }

  // Delete all data
  for (const table of ['session_health', 'token_usage', 'turn_logs', 'conversation_segments', 'conversations', 'bandit_state', 'user_profiles']) {
    const { count, error } = await sb.from(table).delete({ count: 'exact' }).eq('user_id', uid);
    if (error) console.log(`  ${table}: ${error.message}`);
    else if (count) console.log(`  ${table}: deleted ${count}`);
  }

  // Create fresh clone profile
  const { createCloneProfile } = await import('../src/lib/backbone/clone');
  await createCloneProfile(uid);

  console.log(`\n${email} reset. Clean clone profile created.`);
}

main().catch(console.error);
