import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE env vars');
  process.exit(1);
}

const supabase = createClient(url, key);

async function main(): Promise<void> {
  // Dynamic import to avoid mem0ai bundling issues
  const { extractSegments } = await import('../src/lib/backbone/recall');

  const { data: conversations, error } = await supabase
    .from('conversations')
    .select('id, user_id, messages, started_at')
    .order('started_at', { ascending: true });

  if (error) {
    console.error('Failed to fetch conversations:', error.message);
    process.exit(1);
  }

  if (!conversations || conversations.length === 0) {
    console.log('No conversations found.');
    return;
  }

  console.log(`Found ${conversations.length} conversations to process.\n`);

  let processed = 0;
  let skipped = 0;

  for (const conv of conversations) {
    const messages = conv.messages as { role: string; content: string; timestamp?: string }[];
    if (!messages || messages.length < 4) {
      console.log(`  SKIP: ${conv.id} (${messages?.length ?? 0} messages — too short)`);
      skipped++;
      continue;
    }

    console.log(`  Processing: ${conv.id} (${messages.length} messages, ${conv.started_at})`);

    try {
      await extractSegments(
        conv.id,
        conv.user_id,
        messages.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
          timestamp: m.timestamp || conv.started_at,
        })),
        new Date(conv.started_at),
      );
      processed++;
    } catch (err) {
      console.error(`  ERROR: ${conv.id} — ${err instanceof Error ? err.message : err}`);
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(`\nDone. Processed: ${processed}, Skipped: ${skipped}`);
}

main().catch(console.error);
