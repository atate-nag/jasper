// Generate re-engagement email drafts for inactive users.
// Usage: npx tsx scripts/generate-reengagement.ts [days-threshold]
// Default threshold: 3 days since last conversation.
// Outputs drafts to console and saves to reengagement-drafts.json for review.

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { callModel, WEB_SEARCH_TOOL } from '../src/lib/model-client';
import { logUsage } from '../src/lib/usage';
import { getModelRouting } from '../src/lib/config/models';
import { writeFileSync } from 'fs';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const daysThreshold = parseInt(process.argv[2] || '3');

interface ReengagementDraft {
  userId: string;
  userName: string;
  email: string;
  subject: string;
  body: string;
  threadIdentified: string;
  knownIssues: string[];
  sensitive: boolean;
  sendRecommendation: 'send' | 'review_carefully' | 'skip';
}

async function main(): Promise<void> {
  console.log(`Generating re-engagement drafts (threshold: ${daysThreshold} days)...\n`);

  // Get all clone users (real users have clone_source_user_id)
  const { data: profiles } = await sb
    .from('user_profiles')
    .select('user_id, identity, current_state, calibration')
    .not('clone_source_user_id', 'is', null);

  const drafts: ReengagementDraft[] = [];

  for (const profile of profiles || []) {
    const userId = profile.user_id;
    const name = (profile.identity as Record<string, unknown>)?.name as string || 'there';

    // Get email
    const { data: authData } = await sb.auth.admin.getUserById(userId);
    const email = authData?.user?.email;
    if (!email) continue;

    // Only real users — skip master, test accounts, and demo accounts
    const realUsers = ['lyndskhan09@hotmail.co.uk', 'ctc@human-dynamics.io', 'partner@sandramolies.com', 'wesmol2024@hotmail.com'];
    if (!realUsers.includes(email)) continue;

    // Get last conversation
    const { data: lastConv } = await sb
      .from('conversations')
      .select('started_at, summary, messages, analytics')
      .eq('user_id', userId)
      .not('summary', 'is', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!lastConv) continue;

    const daysSince = Math.round(
      (Date.now() - new Date(lastConv.started_at).getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysSince < daysThreshold) {
      console.log(`SKIP: ${name} (${email}) — active ${daysSince} days ago`);
      continue;
    }

    // Get all conversation summaries
    const { data: allConvs } = await sb
      .from('conversations')
      .select('summary, analytics, started_at')
      .eq('user_id', userId)
      .not('summary', 'is', null)
      .order('started_at', { ascending: true });

    const summaries = (allConvs || [])
      .map(c => `[${(c.started_at as string).slice(0, 10)}]: ${c.summary}`)
      .join('\n\n');

    // Identify corrections
    const corrections: string[] = [];
    for (const c of allConvs || []) {
      const b = (c.analytics as Record<string, unknown>)?.behavioral as Record<string, unknown> | undefined;
      if (b && (b.correction_count as number) > 0) {
        corrections.push(`Session ${(c.started_at as string).slice(0, 10)} had ${b.correction_count} correction(s)`);
      }
    }

    // Detect sensitive content
    const hasSensitive = summaries.toLowerCase().match(/partner|relationship|ex |divorce|abuse|distress|crisis/);
    const sensitive = !!hasSensitive;

    // Generate draft with Opus + web search
    const prompt = `You are Jasper, writing a follow-up email to ${name}.

You last spoke ${daysSince} days ago. Here are your conversation summaries:

${summaries}

${corrections.length > 0 ? `KNOWN ISSUES IN YOUR CONVERSATIONS:\n${corrections.join('\n')}\nIf relevant, acknowledge these honestly in the email.` : ''}

${sensitive ? `SENSITIVE CONTENT FLAG: This person discussed relationship difficulties or emotional content. Do NOT reference specific relationship details, partners, or emotional situations. Keep the follow-up warm but general about their wellbeing. Let THEM decide what to bring back.` : ''}

WEB SEARCH: You have access to web search. If the conversation summaries reference specific books, quotes, articles, events, or topics you're unsure about, SEARCH for them to enrich your follow-up with accurate, specific references. Don't guess — look it up.

NEW FEATURES: Since ${name} last used Jasper, Adrian has added several improvements they might find relevant. Mention 1-2 that connect to how they used the product — don't list them all, just the ones that matter for this person:
- Conversation history now persists — you can see your previous conversation when you return
- Jasper can now search the web during conversations to look things up, verify quotes, find references
- Improved recall — Jasper is better at remembering recent conversations (recency boost for last 48h)
- Markdown formatting in responses — better readability for longer responses
- Voice input improvements — faster transcription via native browser speech recognition

Frame these naturally as "by the way, I can now..." not as a feature announcement.

TASK: Write a follow-up email that:

1. References the specific thing they were working on (not generically)
2. Shows you've been thinking about it (not just remembering)
3. If you had any failures (bad recall, premature depth, corrections they made), acknowledge one honestly
4. Gives them a specific reason to come back — a question, an observation, something that continues the thread
5. Is 3-5 paragraphs, warm but not sycophantic
6. Reads like a colleague who's been mulling over your problem, not a CRM drip
7. Ends with a low-pressure invitation to continue
8. Naturally mentions 1-2 new features relevant to this person

${sensitive ? 'For this person, keep it lighter. Ask how they are doing generally. Do not reopen specific emotional topics.' : ''}

ALSO generate:
- A subject line (short, specific, not clickbait)
- A one-sentence summary of what thread you identified as most important
- Whether you recommend sending this (send / review_carefully / skip)

Format your response as:
SUBJECT: [subject line]
THREAD: [one-sentence thread identification]
RECOMMENDATION: [send / review_carefully / skip]
BODY:
[the email body]`;

    try {
      const routing = getModelRouting();
      const result = await callModel(
        routing.summary, // Opus
        '',
        [{ role: 'user', content: prompt }],
        0.5,
        WEB_SEARCH_TOOL,
      );

      logUsage(result.usage, 'reengagement_draft', userId);

      const text = result.text;
      const subjectMatch = text.match(/SUBJECT:\s*(.+)/);
      const threadMatch = text.match(/THREAD:\s*(.+)/);
      const recMatch = text.match(/RECOMMENDATION:\s*(.+)/);
      const bodyMatch = text.match(/BODY:\s*([\s\S]+)/);

      const draft: ReengagementDraft = {
        userId,
        userName: name,
        email,
        subject: subjectMatch?.[1]?.trim() || `${name} — following up`,
        body: bodyMatch?.[1]?.trim() || '',
        threadIdentified: threadMatch?.[1]?.trim() || 'unknown',
        knownIssues: corrections,
        sensitive,
        sendRecommendation: (recMatch?.[1]?.trim().toLowerCase() as ReengagementDraft['sendRecommendation']) || 'review_carefully',
      };

      drafts.push(draft);

      console.log('='.repeat(60));
      console.log(`USER: ${draft.userName} (${draft.email})`);
      console.log(`DAYS SINCE LAST: ${daysSince}`);
      console.log(`THREAD: ${draft.threadIdentified}`);
      console.log(`SENSITIVE: ${draft.sensitive}`);
      console.log(`KNOWN ISSUES: ${draft.knownIssues.join(', ') || 'none'}`);
      console.log(`RECOMMENDATION: ${draft.sendRecommendation}`);
      console.log(`SUBJECT: ${draft.subject}`);
      console.log('-'.repeat(60));
      console.log(draft.body);
      console.log('='.repeat(60));
      console.log();
    } catch (err) {
      console.error(`ERROR generating draft for ${name}:`, err);
    }
  }

  if (drafts.length === 0) {
    console.log('No users need re-engagement right now.');
    return;
  }

  writeFileSync('reengagement-drafts.json', JSON.stringify(drafts, null, 2));
  console.log(`\n${drafts.length} drafts saved to reengagement-drafts.json`);
  console.log('Review and edit, then run: npx tsx scripts/send-reengagement.ts');
}

main().catch(console.error);
