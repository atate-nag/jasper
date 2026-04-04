// Usage report: sessions, messages, and activity per user.
// Usage: npx tsx scripts/usage-report.ts [days]
// Default: all time. Pass a number for last N days.

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const days = parseInt(process.argv[2] || '0');

async function main(): Promise<void> {
  const { data: { users } } = await sb.auth.admin.listUsers();
  const emailMap: Record<string, string> = {};
  users.forEach(u => { emailMap[u.id] = u.email || u.id.slice(0, 8); });

  let query = sb.from('conversations')
    .select('user_id, started_at, messages')
    .order('started_at', { ascending: true });

  if (days > 0) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    query = query.gte('started_at', since.toISOString());
  }

  const { data } = await query;
  // Include all conversations with messages
  const unique = (data || []).filter((c: Record<string, unknown>) =>
    Array.isArray(c.messages) && (c.messages as unknown[]).length > 0
  );

  // Per-user stats
  const userStats: Record<string, { sessions: number; messages: number; firstSeen: string; lastSeen: string }> = {};
  for (const c of unique) {
    const email = emailMap[c.user_id as string] || (c.user_id as string).slice(0, 8);
    const msgs = c.messages as unknown[];
    const started = c.started_at as string;
    if (!userStats[email]) {
      userStats[email] = { sessions: 0, messages: 0, firstSeen: started, lastSeen: started };
    }
    userStats[email].sessions++;
    userStats[email].messages += msgs.length;
    if (started > userStats[email].lastSeen) userStats[email].lastSeen = started;
    if (started < userStats[email].firstSeen) userStats[email].firstSeen = started;
  }

  const period = days > 0 ? `last ${days} day(s)` : 'all time';
  console.log(`\n=== USAGE REPORT (${period}) ===\n`);
  console.log(`Total sessions: ${unique.length}`);
  console.log(`Total messages: ${unique.reduce((s, c) => s + (c.messages as unknown[]).length, 0)}`);
  console.log(`Active users:   ${Object.keys(userStats).length}`);
  console.log();

  const sorted = Object.entries(userStats).sort((a, b) => b[1].messages - a[1].messages);
  for (const [email, stats] of sorted) {
    console.log(`${email}`);
    console.log(`  Sessions: ${stats.sessions} | Messages: ${stats.messages}`);
    console.log(`  First: ${stats.firstSeen.slice(0, 16)} | Last: ${stats.lastSeen.slice(0, 16)}`);
    console.log();
  }

  // Product signals
  let signalQuery = sb.from('conversations').select('user_id, started_at, summary');
  if (days > 0) {
    const signalSince = new Date();
    signalSince.setDate(signalSince.getDate() - days);
    signalQuery = signalQuery.gte('started_at', signalSince.toISOString());
  }

  const { data: signalConvos } = await signalQuery
    .not('summary', 'is', null)
    .order('started_at', { ascending: false });

  const signals = (signalConvos || []).filter(c => {
    const s = (c.summary as string) || '';
    return s.includes('PRODUCT SIGNALS') && !s.includes('skip this section');
  });

  if (signals.length > 0) {
    console.log(`${'='.repeat(50)}`);
    console.log(`PRODUCT SIGNALS (${signals.length} sessions)\n`);
    for (const c of signals) {
      const summary = c.summary as string;
      const signalStart = summary.indexOf('PRODUCT SIGNALS');
      if (signalStart === -1) continue;
      const signalText = summary.slice(signalStart).split(/\n\n(?=\d+\.|\*\*|##)/)[0];
      const userEmail = emailMap[c.user_id as string] || (c.user_id as string).slice(0, 8);
      console.log(`${userEmail} (${(c.started_at as string).slice(0, 16)}):`);
      console.log(`  ${signalText.replace(/\n/g, '\n  ')}`);
      console.log();
    }
  }
}

main().catch(console.error);
