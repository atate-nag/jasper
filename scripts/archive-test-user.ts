// Archive all conversations from the test user before resetting.
// Saves to scripts/test-archives/archive-YYYY-MM-DD-HHMMSS.json
// Usage: npx tsx scripts/archive-test-user.ts

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const TEST_USER_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

async function main(): Promise<void> {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Fetch all data
  const { data: conversations } = await sb
    .from('conversations')
    .select('*')
    .eq('user_id', TEST_USER_ID)
    .order('started_at', { ascending: true });

  const { data: segments } = await sb
    .from('conversation_segments')
    .select('id, content, segment_type, importance_score, topic_labels, conversation_date')
    .eq('user_id', TEST_USER_ID)
    .order('created_at', { ascending: true });

  const { data: profile } = await sb
    .from('user_profiles')
    .select('*')
    .eq('user_id', TEST_USER_ID)
    .single();

  const { data: turnLogs } = await sb
    .from('turn_logs')
    .select('*')
    .eq('user_id', TEST_USER_ID)
    .order('created_at', { ascending: true });

  const convosWithMessages = (conversations || []).filter(
    c => c.messages && Array.isArray(c.messages) && c.messages.length > 0
  );

  if (convosWithMessages.length === 0) {
    console.log('No conversations to archive.');
    return;
  }

  // Build archive
  const archive = {
    archived_at: new Date().toISOString(),
    user_id: TEST_USER_ID,
    summary: {
      conversations: convosWithMessages.length,
      total_messages: convosWithMessages.reduce((sum, c) => sum + c.messages.length, 0),
      segments: segments?.length || 0,
      turn_logs: turnLogs?.length || 0,
    },
    profile,
    conversations: convosWithMessages,
    segments,
    turn_logs: turnLogs,
  };

  // Write to file
  const dir = join(process.cwd(), 'scripts', 'test-archives');
  mkdirSync(dir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `archive-${timestamp}.json`;
  const filepath = join(dir, filename);

  writeFileSync(filepath, JSON.stringify(archive, null, 2));

  console.log(`Archived to ${filepath}`);
  console.log(`  ${archive.summary.conversations} conversations, ${archive.summary.total_messages} messages, ${archive.summary.segments} segments`);

  // Also write a readable transcript
  const transcriptPath = join(dir, `transcript-${timestamp}.txt`);
  let transcript = `Test User Archive — ${new Date().toISOString()}\n${'='.repeat(60)}\n\n`;

  for (const conv of convosWithMessages) {
    transcript += `--- Conversation ${conv.id.slice(0, 8)} (${conv.started_at}) ---\n\n`;
    for (const m of conv.messages) {
      const label = m.role === 'user' ? 'User' : 'Jasper';
      transcript += `${label}: ${m.content}\n\n`;
    }
    transcript += '\n';
  }

  writeFileSync(transcriptPath, transcript);
  console.log(`  Transcript: ${transcriptPath}`);
}

main().catch(console.error);
