// Re-extract wit segments from existing conversations.
// Runs a targeted extraction looking only for witty exchanges.
// Usage: npx tsx scripts/extract-wit-segments.ts [email]
// If no email, runs for all users with conversations.

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { callModel, WEB_SEARCH_TOOL } from '../src/lib/model-client';
import { logUsage } from '../src/lib/usage';
import { getModelRouting } from '../src/lib/config/models';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const targetEmail = process.argv[2];

interface WitSegment {
  content: string;
  importance_score: number;
  topic_labels: string[];
  turn_range: [number, number];
}

async function main(): Promise<void> {
  const { data: { users } } = await sb.auth.admin.listUsers();

  let targetUsers = users;
  if (targetEmail) {
    targetUsers = users.filter(u => u.email === targetEmail);
    if (targetUsers.length === 0) {
      console.log(`User ${targetEmail} not found`);
      return;
    }
  }

  const { data: profiles } = await sb.from('user_profiles').select('user_id, identity');
  const nameMap: Record<string, string> = {};
  for (const p of (profiles || [])) {
    nameMap[p.user_id] = ((p.identity as Record<string, unknown>)?.name as string) || '';
  }

  let totalExtracted = 0;

  for (const user of targetUsers) {
    const name = nameMap[user.id] || user.email || user.id.slice(0, 8);

    // Get conversations with enough messages
    const { data: convos } = await sb
      .from('conversations')
      .select('id, started_at, messages')
      .eq('user_id', user.id)
      .order('started_at', { ascending: true });

    const substantive = (convos || []).filter(c =>
      Array.isArray(c.messages) && (c.messages as unknown[]).length >= 6
    );

    if (substantive.length === 0) continue;

    console.log(`\n=== ${name} (${user.email}) — ${substantive.length} conversations ===`);

    for (const conv of substantive) {
      const messages = conv.messages as Array<{ role: string; content: string }>;
      const formatted = messages.map((m, i) =>
        `[turn ${i}] [${m.role}]: ${m.content}`
      ).join('\n');

      const prompt = `Review this conversation for moments of genuine wit, humour, dry observation, playful banter, or comedic timing.

ONLY extract moments where humour LANDED — where the other person laughed, responded with warmth, or the exchange clearly deepened the connection. Skip attempts at humour that fell flat or weren't acknowledged.

For each moment, QUOTE THE ACTUAL EXCHANGE — what they said, what you said, how they responded. Not a summary. The actual lines.

CONVERSATION:
${formatted}

If there are NO genuine wit moments, return [].

Return ONLY a valid JSON array:
[
  {
    "content": "string — quote the exchange: what they said, what I said, how they responded. 2-4 sentences preserving the actual words.",
    "importance_score": number (7-8 for wit that deepened connection, 5-6 for lighter moments),
    "topic_labels": ["humour", "callback", "deadpan", etc],
    "turn_range": [start_turn, end_turn]
  }
]`;

      try {
        const routing = getModelRouting();
        const result = await callModel(
          routing.summary, // Opus for quality
          '',
          [{ role: 'user', content: prompt }],
          0.3,
        );

        logUsage(result.usage, 'wit_extraction', user.id, conv.id);

        const cleaned = result.text
          .replace(/^\s*```(?:json)?\s*\n?/i, '')
          .replace(/\n?\s*```\s*$/i, '')
          .trim();

        const segments = JSON.parse(cleaned) as WitSegment[];

        if (segments.length === 0) {
          console.log(`  ${conv.started_at?.slice(0, 16)} — no wit found`);
          continue;
        }

        // Insert segments
        for (const seg of segments) {
          const { error } = await sb.from('conversation_segments').insert({
            conversation_id: conv.id,
            user_id: user.id,
            content: seg.content,
            segment_type: 'wit',
            importance_score: seg.importance_score,
            topic_labels: seg.topic_labels,
            conversation_date: conv.started_at,
          });

          if (error) {
            console.error(`    Insert error: ${error.message}`);
          } else {
            totalExtracted++;
            console.log(`  ${conv.started_at?.slice(0, 16)} — "${seg.content.slice(0, 80)}..."`);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ${conv.started_at?.slice(0, 16)} — error: ${msg}`);
      }
    }
  }

  console.log(`\nDone. ${totalExtracted} wit segments extracted.`);
}

main().catch(console.error);
