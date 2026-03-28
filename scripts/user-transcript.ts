// Full conversation transcript with analytics context for a user.
// Usage: npx tsx scripts/user-transcript.ts <name-or-email> [days]
// Default: all conversations. Pass days to limit.

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const search = process.argv[2];
const days = parseInt(process.argv[3] || '0');

if (!search) {
  console.log('Usage: npx tsx scripts/user-transcript.ts <name-or-email> [days]');
  console.log('Examples:');
  console.log('  npx tsx scripts/user-transcript.ts Lyndsay');
  console.log('  npx tsx scripts/user-transcript.ts Lyndsay 1     # last 24 hours');
  console.log('  npx tsx scripts/user-transcript.ts alice@example.com 7');
  process.exit(0);
}

async function findUserId(): Promise<{ userId: string; label: string } | null> {
  // Try by email
  const { data: { users } } = await sb.auth.admin.listUsers();
  const authUser = users.find(u => u.email?.toLowerCase().includes(search.toLowerCase()));
  if (authUser) return { userId: authUser.id, label: authUser.email || authUser.id };

  // Try by name in profile
  const { data: profiles } = await sb.from('user_profiles').select('user_id, identity').limit(100);
  const match = profiles?.find(p => {
    const name = (p.identity as Record<string, unknown>)?.name as string;
    return name?.toLowerCase().includes(search.toLowerCase());
  });
  if (match) {
    const name = (match.identity as Record<string, unknown>)?.name as string;
    return { userId: match.user_id, label: name || match.user_id };
  }

  return null;
}

async function main(): Promise<void> {
  const found = await findUserId();
  if (!found) {
    console.log(`No user found matching "${search}"`);
    return;
  }

  const { userId, label } = found;

  // Get conversations
  let query = sb.from('conversations')
    .select('id, started_at, messages, summary, analytics')
    .eq('user_id', userId)
    .order('started_at', { ascending: true });

  if (days > 0) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    query = query.gte('started_at', since.toISOString());
  }

  const { data: allConvos } = await query;
  if (!allConvos || allConvos.length === 0) {
    console.log('No conversations found.');
    return;
  }

  // Deduplicate — keep longest per first user message
  const deduped = new Map<string, typeof allConvos[0]>();
  for (const conv of allConvos) {
    if (!conv.messages || !Array.isArray(conv.messages) || conv.messages.length === 0) continue;
    const firstUser = (conv.messages as Array<{ role: string; content: string }>)
      .find(m => m.role === 'user')?.content?.slice(0, 50) || conv.id;
    const existing = deduped.get(firstUser);
    if (!existing || (conv.messages as unknown[]).length > (existing.messages as unknown[]).length) {
      deduped.set(firstUser, conv);
    }
  }

  const conversations = [...deduped.values()];

  // Get turn logs for this user (for analytics overlay)
  const { data: turnLogs } = await sb.from('turn_logs')
    .select('conversation_id, turn_number, intent, posture, policy_id, model_used, model_tier, prompt_tokens, recall_tier, recall_segments_returned, depth_score, depth_consumed, relational_connection_found, care_context_injected, distress_override, steer_latency_ms, valence, arousal, correction_detected, disclosure_depth, user_initiated_topic, wit_detected')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  // Index turn logs by conversation
  const logsByConv = new Map<string, Array<Record<string, unknown>>>();
  for (const log of (turnLogs || [])) {
    const convId = log.conversation_id as string;
    if (!logsByConv.has(convId)) logsByConv.set(convId, []);
    logsByConv.get(convId)!.push(log);
  }

  const period = days > 0 ? `last ${days} day(s)` : 'all time';
  const totalMsgs = conversations.reduce((s, c) => s + (c.messages as unknown[]).length, 0);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`${label} — ${conversations.length} conversations, ${totalMsgs} messages (${period})`);
  console.log(`${'='.repeat(70)}\n`);

  for (const conv of conversations) {
    const messages = conv.messages as Array<{ role: string; content: string }>;
    const logs = logsByConv.get(conv.id) || [];
    const analytics = conv.analytics as Record<string, unknown> | null;

    console.log(`${'─'.repeat(70)}`);
    console.log(`Session: ${(conv.started_at || '').slice(0, 16)} | ${messages.length} messages`);

    // Session analytics if available
    if (analytics) {
      const models = analytics.models_used as Record<string, number> | undefined;
      const intents = analytics.intents_distribution as Record<string, number> | undefined;
      if (models) console.log(`  Models: ${Object.entries(models).map(([m, n]) => `${m}(${n})`).join(', ')}`);
      if (intents) console.log(`  Intents: ${Object.entries(intents).map(([i, n]) => `${i}(${n})`).join(', ')}`);
      if (analytics.prompt_size_avg) console.log(`  Avg prompt: ${analytics.prompt_size_avg}t | Avg response: ${analytics.response_length_avg} chars`);
    }

    // Summary if available
    if (conv.summary) {
      const summaryPreview = (conv.summary as string).slice(0, 200);
      console.log(`  Summary: ${summaryPreview}${(conv.summary as string).length > 200 ? '...' : ''}`);
    }
    console.log();

    // Messages with inline analytics
    let logIndex = 0;
    let turnCount = 0;
    for (const m of messages) {
      const isUser = m.role === 'user';
      const prefix = isUser ? '\x1b[36mUser\x1b[0m' : '\x1b[32mJasper\x1b[0m';

      if (isUser) turnCount++;

      // Find matching turn log
      const turnLog = logs[logIndex];
      let analyticsLine = '';
      if (turnLog && isUser) {
        const parts: string[] = [];
        if (turnLog.intent) parts.push(`${turnLog.intent}`);
        if (turnLog.policy_id) parts.push(`→${turnLog.policy_id}`);
        if (turnLog.model_used) parts.push(`${turnLog.model_used}(${turnLog.model_tier})`);
        if (turnLog.valence != null) parts.push(`v:${(turnLog.valence as number).toFixed(1)}`);
        if (turnLog.arousal != null) parts.push(`a:${(turnLog.arousal as number).toFixed(1)}`);
        if (turnLog.recall_tier) parts.push(`recall:${turnLog.recall_tier}(${turnLog.recall_segments_returned})`);
        if (turnLog.depth_consumed) parts.push('depth-consumed');
        if (turnLog.relational_connection_found) parts.push('relational-hit');
        if (turnLog.care_context_injected) parts.push('CARE');
        if (turnLog.distress_override) parts.push('DISTRESS');
        if (turnLog.correction_detected) parts.push('CORRECTION');
        if (turnLog.wit_detected) parts.push('WIT');
        if (turnLog.user_initiated_topic) parts.push('initiated');
        if (turnLog.disclosure_depth) parts.push(`disc:${(turnLog.disclosure_depth as number).toFixed(1)}`);
        if (parts.length > 0) analyticsLine = `  \x1b[2m[${parts.join(' | ')}]\x1b[0m`;
        logIndex++;
      }

      console.log(`${prefix}: ${m.content}`);
      if (analyticsLine) console.log(analyticsLine);
      console.log();
    }
  }
}

main().catch(console.error);
