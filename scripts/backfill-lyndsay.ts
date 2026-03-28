// Backfill Lyndsay's conversations with Opus-quality summaries and segments.
// Then re-bootstrap relational threads.

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const LYNDSAY_USER_ID = '3c22b725-4709-4b47-9100-6e6bb62f8dc2';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main(): Promise<void> {
  const { summariseConversation } = await import('../src/lib/backbone/summarise');
  const { extractSegments } = await import('../src/lib/backbone/recall');
  const { getProfile } = await import('../src/lib/backbone/profile');
  const { identifyFoundationalThreads } = await import('../src/lib/intermediary/relational-threads');

  const profile = await getProfile(LYNDSAY_USER_ID);

  // Get all conversations — deduplicate by keeping longest per first message
  const { data: allConvos } = await sb
    .from('conversations')
    .select('id, messages, summary, started_at')
    .eq('user_id', LYNDSAY_USER_ID)
    .order('started_at', { ascending: true });

  if (!allConvos || allConvos.length === 0) {
    console.log('No conversations found for Lyndsay.');
    return;
  }

  const deduped = new Map<string, typeof allConvos[0]>();
  for (const conv of allConvos) {
    if (!conv.messages || !Array.isArray(conv.messages) || conv.messages.length < 4) continue;
    const firstUser = (conv.messages as Array<{ role: string; content: string }>)
      .find(m => m.role === 'user')?.content?.slice(0, 50) || '';
    const key = firstUser;
    const existing = deduped.get(key);
    if (!existing || (conv.messages as unknown[]).length > (existing.messages as unknown[]).length) {
      deduped.set(key, conv);
    }
  }

  const conversations = [...deduped.values()];
  console.log(`${allConvos.length} total conversations, ${conversations.length} unique with 4+ messages.\n`);

  // Get previous summaries for context
  const prevSummaries: string[] = [];

  // Step 1: Re-summarise with Opus
  console.log('=== RE-SUMMARISING WITH OPUS ===\n');

  for (const conv of conversations) {
    const messages = conv.messages as Array<{ role: string; content: string; timestamp?: string }>;
    console.log(`Conversation ${conv.id.slice(0, 8)} (${messages.length} msgs, ${conv.started_at?.slice(0, 16)}):`);
    console.log(`  Old: ${conv.summary?.slice(0, 80) || '(none)'}...`);

    const typedMessages = messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
      timestamp: m.timestamp || conv.started_at || new Date().toISOString(),
    }));

    const newSummary = await summariseConversation(typedMessages, profile, prevSummaries.slice(-3));

    if (newSummary) {
      await sb.from('conversations').update({ summary: newSummary }).eq('id', conv.id);
      prevSummaries.push(newSummary);
      console.log(`  New: ${newSummary.slice(0, 80)}...`);
    }

    await new Promise(r => setTimeout(r, 1000)); // rate limit
  }

  // Step 2: Re-extract segments with Opus
  console.log('\n=== RE-EXTRACTING SEGMENTS WITH OPUS ===\n');

  // Delete existing segments for Lyndsay
  const { count: deleted } = await sb
    .from('conversation_segments')
    .delete({ count: 'exact' })
    .eq('user_id', LYNDSAY_USER_ID);
  console.log(`Deleted ${deleted} existing segments.\n`);

  for (const conv of conversations) {
    const messages = conv.messages as Array<{ role: string; content: string; timestamp?: string }>;
    console.log(`Extracting from ${conv.id.slice(0, 8)} (${messages.length} msgs)...`);

    const typedMessages = messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
      timestamp: m.timestamp || conv.started_at || new Date().toISOString(),
    }));

    await extractSegments(conv.id, LYNDSAY_USER_ID, typedMessages, new Date(conv.started_at || Date.now()));
    await new Promise(r => setTimeout(r, 1000)); // rate limit
  }

  // Step 3: Re-bootstrap relational threads
  console.log('\n=== RE-BOOTSTRAPPING RELATIONAL THREADS ===\n');

  const { data: updatedConvos } = await sb
    .from('conversations')
    .select('summary')
    .eq('user_id', LYNDSAY_USER_ID)
    .not('summary', 'is', null)
    .order('started_at', { ascending: false })
    .limit(20);
  const summaries = (updatedConvos || []).map(c => c.summary).filter(Boolean) as string[];

  const { data: segments } = await sb
    .from('conversation_segments')
    .select('content')
    .eq('user_id', LYNDSAY_USER_ID)
    .gte('importance_score', 7)
    .order('importance_score', { ascending: false })
    .limit(20);
  const segmentTexts = (segments || []).map(s => s.content) as string[];

  const { count: sessionCount } = await sb
    .from('conversations')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', LYNDSAY_USER_ID);

  const name = profile?.identity?.name || 'Lyndsay';
  console.log(`${summaries.length} summaries, ${segmentTexts.length} high-importance segments`);

  const threads = await identifyFoundationalThreads(name, summaries, segmentTexts, sessionCount || 0);

  await sb.from('user_profiles')
    .update({ relational_threads: threads })
    .eq('user_id', LYNDSAY_USER_ID);

  console.log(`\nIdentified ${threads.length} foundational threads:`);
  threads.forEach(t => console.log(`  - ${t.thread}`));

  console.log('\nDone.');
}

main().catch(console.error);
