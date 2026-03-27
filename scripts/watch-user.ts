// Watch a user's conversation in real time.
// Usage: npx tsx scripts/watch-user.ts <user-id-or-email>
// Polls every 5 seconds for new messages.

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const arg = process.argv[2];
if (!arg) {
  console.log('Usage: npx tsx scripts/watch-user.ts <email-or-uuid>');
  process.exit(0);
}

let lastMessageCount = 0;
let userId: string;

async function resolveUserId(): Promise<string> {
  if (arg.includes('@')) {
    const { data: { users } } = await sb.auth.admin.listUsers();
    const user = users.find(u => u.email === arg);
    if (!user) { console.error('User not found:', arg); process.exit(1); }
    return user.id;
  }
  return arg;
}

async function poll(): Promise<void> {
  const { data } = await sb
    .from('conversations')
    .select('id, messages, started_at')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(1);

  if (!data?.[0]?.messages) return;

  const messages = data[0].messages as Array<{ role: string; content: string }>;

  if (messages.length > lastMessageCount) {
    // Show new messages
    const newMessages = messages.slice(lastMessageCount);
    for (const m of newMessages) {
      const label = m.role === 'user' ? '\x1b[36mUser\x1b[0m' : '\x1b[32mJasper\x1b[0m';
      console.log(`${label}: ${m.content}\n`);
    }
    lastMessageCount = messages.length;
  }
}

async function main(): Promise<void> {
  userId = await resolveUserId();
  console.log(`Watching ${arg} (${userId})`);
  console.log('Polling every 5 seconds... (Ctrl+C to stop)\n');

  setInterval(poll, 5000);
  await poll(); // immediate first check
}

main().catch(console.error);
