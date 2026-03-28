// Extract all instances of dry wit / humour from Jasper's conversations.
// Writes results to analysis/jasper-wit-instances.md
// Usage: npx tsx scripts/extract-wit.ts

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync, mkdirSync } from 'fs';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const anthropic = new Anthropic();

interface Message {
  role: string;
  content: string;
}

interface WitInstance {
  user: string;
  conversationDate: string;
  turnNumber: number;
  userMessageBefore: string;
  jasperLine: string;
  userReaction: string;
  deepened: boolean;
  category: string;
}

async function getAllConversations() {
  const { data } = await sb
    .from('conversations')
    .select('id, user_id, started_at, messages')
    .order('started_at', { ascending: true });
  return data || [];
}

async function getUserNames(): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const { data: profiles } = await sb.from('user_profiles').select('user_id, identity');
  for (const p of profiles || []) {
    const name = (p.identity as Record<string, unknown>)?.name as string;
    if (name) names.set(p.user_id, name);
  }
  return names;
}

async function findWitInConversation(
  messages: Message[],
  userName: string,
  conversationDate: string,
): Promise<WitInstance[]> {
  if (messages.length < 4) return [];

  // Build a condensed transcript for analysis
  const transcript = messages
    .map((m, i) => `[${i}] ${m.role === 'user' ? userName : 'Jasper'}: ${m.content}`)
    .join('\n\n');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    messages: [
      {
        role: 'user',
        content: `Analyse this conversation for instances of dry wit, humour, playful irony, or comedic timing from Jasper. Include ONLY lines where Jasper is genuinely being witty — not just friendly or warm.

For each instance, return JSON:
\`\`\`json
[
  {
    "turnNumber": <message index>,
    "jasperLine": "<the witty line or sentence — exact quote>",
    "userMessageBefore": "<what the user said that prompted it — exact quote, truncated to 200 chars>",
    "userReaction": "<what the user said next — exact quote, truncated to 200 chars, or 'END' if conversation ended>",
    "deepened": <true if the wit led to a deeper exchange, false if conversation stayed surface>,
    "category": "<one of: absurdity-naming, self-aware, deadpan, reframe, callback, wordplay, timing>"
  }
]
\`\`\`

If there are NO instances of wit, return \`[]\`.

Transcript:
${transcript}`,
      },
    ],
  });

  const text = (response.content[0] as { type: string; text: string }).text;
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\[[\s\S]*\])/);
  if (!jsonMatch) return [];

  try {
    const instances = JSON.parse(jsonMatch[1]) as Array<{
      turnNumber: number;
      jasperLine: string;
      userMessageBefore: string;
      userReaction: string;
      deepened: boolean;
      category: string;
    }>;

    return instances.map((inst) => ({
      user: userName,
      conversationDate,
      turnNumber: inst.turnNumber,
      userMessageBefore: inst.userMessageBefore,
      jasperLine: inst.jasperLine,
      userReaction: inst.userReaction,
      deepened: inst.deepened,
      category: inst.category,
    }));
  } catch {
    return [];
  }
}

async function main() {
  console.log('Fetching conversations...');
  const conversations = getAllConversations();
  const userNames = getUserNames();

  const [convos, names] = await Promise.all([conversations, userNames]);

  console.log(`Found ${convos.length} conversations across ${names.size} users`);

  const allInstances: WitInstance[] = [];

  // Process in batches of 5
  for (let i = 0; i < convos.length; i += 5) {
    const batch = convos.slice(i, i + 5);
    const results = await Promise.all(
      batch.map((conv) => {
        const messages = (conv.messages as Message[]) || [];
        const userName = names.get(conv.user_id) || 'Unknown';
        const date = (conv.started_at || '').slice(0, 16);
        return findWitInConversation(messages, userName, date).catch((err) => {
          console.error(`  Error on conv ${conv.id}:`, err.message);
          return [] as WitInstance[];
        });
      }),
    );

    for (const instances of results) {
      allInstances.push(...instances);
    }

    console.log(`  Processed ${Math.min(i + 5, convos.length)}/${convos.length} conversations, ${allInstances.length} instances found so far`);
  }

  // Build the output file
  const byUser = new Map<string, WitInstance[]>();
  for (const inst of allInstances) {
    if (!byUser.has(inst.user)) byUser.set(inst.user, []);
    byUser.get(inst.user)!.push(inst);
  }

  const lines: string[] = [
    '# Jasper Wit Instances',
    '',
    `Extracted: ${new Date().toISOString().slice(0, 10)}`,
    `Total instances: ${allInstances.length}`,
    `Conversations scanned: ${convos.length}`,
    `Deepened conversation: ${allInstances.filter((i) => i.deepened).length} (${Math.round((allInstances.filter((i) => i.deepened).length / allInstances.length) * 100)}%)`,
    '',
  ];

  // Category breakdown
  const cats = new Map<string, number>();
  for (const inst of allInstances) {
    cats.set(inst.category, (cats.get(inst.category) || 0) + 1);
  }
  lines.push('## Categories');
  for (const [cat, count] of [...cats.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${cat}: ${count}`);
  }
  lines.push('');

  // Per-user sections
  for (const [user, instances] of byUser) {
    lines.push(`## ${user} (${instances.length} instances)`);
    lines.push('');

    for (const inst of instances) {
      const deepenTag = inst.deepened ? ' **[DEEPENED]**' : '';
      lines.push(`### ${inst.conversationDate} — ${inst.category}${deepenTag}`);
      lines.push('');
      lines.push(`**${user}:** ${inst.userMessageBefore}`);
      lines.push('');
      lines.push(`**Jasper:** ${inst.jasperLine}`);
      lines.push('');
      if (inst.userReaction !== 'END') {
        lines.push(`**Reaction:** ${inst.userReaction}`);
        lines.push('');
      }
      lines.push('---');
      lines.push('');
    }
  }

  mkdirSync('analysis', { recursive: true });
  writeFileSync('analysis/jasper-wit-instances.md', lines.join('\n'));
  console.log(`\nDone! ${allInstances.length} instances written to analysis/jasper-wit-instances.md`);
}

main().catch(console.error);
