# Re-Engagement Email Module — CC Briefing

## What This Is

Jasper generates personalised follow-up emails for users who haven't returned. Not automated drip campaigns — considered, specific messages that reference what the user was working on, acknowledge where Jasper fell short, and give the user a reason to re-engage. Adrian reviews and approves before sending.

This is both a retention mechanism and a product capability test: can Jasper craft follow-up that feels like a colleague who's been thinking about your problem?

## Resend Setup

Resend is the email provider. If it was partially configured earlier, verify and fix the following:

### Domain verification

```bash
# In Resend dashboard (resend.com/domains):
# 1. Add domain: chatwithj.online
# 2. Add the DNS records Resend provides:
#    - MX record for receiving (if needed)
#    - TXT record for SPF
#    - CNAME records for DKIM
#    - TXT record for DMARC (optional but recommended)
# 3. Verify domain status shows "Verified"
```

Check in Vercel that the environment variable is set:

```
RESEND_API_KEY=re_xxxxxxxxxxxxx
```

### Test send

```typescript
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const { data, error } = await resend.emails.send({
  from: 'Jasper <jasper@chatwithj.online>',
  to: 'adrian@test.com',
  subject: 'Test from Jasper',
  text: 'If you received this, Resend is working.',
});

if (error) console.error('Resend error:', error);
else console.log('Sent:', data);
```

Run this before building the module. If the domain isn't verified or the API key is wrong, nothing else matters.

### Common Resend issues

- **Domain not verified:** DNS propagation can take up to 48 hours. Check Resend dashboard for status.
- **Emails going to spam:** Add DMARC record (`v=DMARC1; p=none; rua=mailto:admin@chatwithj.online`). Ensure SPF and DKIM are passing.
- **Rate limits:** Free tier allows 100 emails/day, 3,000/month. More than enough for 4 users. Paid tier ($20/month) for 50K/month when scaling.
- **"From" address:** Must use verified domain. `jasper@chatwithj.online` not `jasper@gmail.com`.

---

## Module Architecture

### New file: `scripts/generate-reengagement.ts`

This is a CLI script Adrian runs manually, not an automated system.

```typescript
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
const resend = new Resend(process.env.RESEND_API_KEY);

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

async function generateDrafts(): Promise<ReengagementDraft[]> {
  // Get all users who haven't had a conversation in 3+ days
  const { data: users } = await supabase
    .from('user_profiles')
    .select('user_id, identity, current_state, calibration, relational_threads')
    .not('clone_source_user_id', 'is', null); // only clone users (real users)

  const drafts: ReengagementDraft[] = [];

  for (const user of users || []) {
    const userId = user.user_id;
    const name = user.identity?.name || 'there';

    // Get their email
    const { data: authUser } = await supabase.auth.admin.getUserById(userId);
    const email = authUser?.user?.email;
    if (!email) continue;

    // Get last conversation time
    const { data: lastConv } = await supabase
      .from('conversations')
      .select('created_at, summary, messages, analytics')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!lastConv) continue;

    const daysSince = Math.round(
      (Date.now() - new Date(lastConv.created_at).getTime()) / (1000 * 60 * 60 * 24)
    );

    // Skip if active (less than 3 days)
    if (daysSince < 3) continue;

    // Get all conversation summaries for this user
    const { data: allConvs } = await supabase
      .from('conversations')
      .select('summary, messages, analytics, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    // Get session health to identify known issues
    const { data: healthRecords } = await supabase
      .from('session_health')
      .select('*')
      .eq('user_id', userId);

    // Get any crisis logs (to know what to avoid)
    const { data: crisisLogs } = await supabase
      .from('crisis_log')
      .select('level')
      .eq('user_id', userId);

    // Build context for Jasper to draft the email
    const summaries = (allConvs || [])
      .filter(c => c.summary)
      .map(c => `[${c.created_at}]: ${c.summary}`)
      .join('\n\n');

    const corrections = (allConvs || [])
      .flatMap(c => {
        const analytics = c.analytics as any;
        return analytics?.behavioral?.correction_count > 0
          ? [`Session had ${analytics.behavioral.correction_count} correction(s)`]
          : [];
      });

    const hasSensitiveContent = crisisLogs && crisisLogs.length > 0;
    const hasRelationshipContent = summaries.toLowerCase().includes('partner')
      || summaries.toLowerCase().includes('relationship')
      || summaries.toLowerCase().includes('ex ')
      || summaries.toLowerCase().includes('divorce');

    // Determine sensitivity
    const sensitive = hasSensitiveContent || hasRelationshipContent;

    // Generate the draft
    const prompt = `You are Jasper, writing a follow-up email to ${name}.

You last spoke ${daysSince} days ago. Here are your conversation summaries:

${summaries}

${corrections.length > 0 ? `KNOWN ISSUES IN YOUR CONVERSATIONS:\n${corrections.join('\n')}\nIf relevant, acknowledge these honestly in the email.` : ''}

${sensitive ? `SENSITIVE CONTENT FLAG: This person discussed relationship difficulties or emotional content. Do NOT reference specific relationship details, partners, or emotional situations. Keep the follow-up warm but general about their wellbeing. Let THEM decide what to bring back.` : ''}

TASK: Write a follow-up email that:

1. References the specific thing they were working on (not generically)
2. Shows you've been thinking about it (not just remembering)
3. If you had any failures (bad recall, premature depth, corrections they made), acknowledge one honestly
4. Gives them a specific reason to come back — a question, an observation, something that continues the thread
5. Is 3-5 paragraphs, warm but not sycophantic
6. Reads like a colleague who's been mulling over your problem, not a CRM drip
7. Ends with a low-pressure invitation to continue

${sensitive ? 'For this person, keep it lighter. Ask how they are doing generally. Do not reopen specific emotional topics.' : ''}

ALSO generate:
- A subject line in the format: "${name} — I've been thinking about [specific topic]"
- A one-sentence summary of what thread you identified as most important
- Whether you recommend sending this (send / review_carefully / skip)

Format your response as:
SUBJECT: [subject line]
THREAD: [one-sentence thread identification]
RECOMMENDATION: [send / review_carefully / skip]
BODY:
[the email body]`;

    const result = await callOpus(prompt);

    // Parse the response
    const subjectMatch = result.match(/SUBJECT:\s*(.+)/);
    const threadMatch = result.match(/THREAD:\s*(.+)/);
    const recMatch = result.match(/RECOMMENDATION:\s*(.+)/);
    const bodyMatch = result.match(/BODY:\s*([\s\S]+)/);

    drafts.push({
      userId,
      userName: name,
      email,
      subject: subjectMatch?.[1]?.trim() || `${name} — following up`,
      body: bodyMatch?.[1]?.trim() || '',
      threadIdentified: threadMatch?.[1]?.trim() || 'unknown',
      knownIssues: corrections,
      sensitive,
      sendRecommendation: (recMatch?.[1]?.trim() as any) || 'review_carefully',
    });
  }

  return drafts;
}

async function callOpus(prompt: string): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
    }),
  });

  const data = await response.json();
  return data.content?.[0]?.text || '';
}

// Main execution
async function main() {
  console.log('Generating re-engagement drafts...\n');
  const drafts = await generateDrafts();

  if (drafts.length === 0) {
    console.log('No users need re-engagement right now.');
    return;
  }

  for (const draft of drafts) {
    console.log('='.repeat(60));
    console.log(`USER: ${draft.userName} (${draft.email})`);
    console.log(`THREAD: ${draft.threadIdentified}`);
    console.log(`SENSITIVE: ${draft.sensitive}`);
    console.log(`KNOWN ISSUES: ${draft.knownIssues.join(', ') || 'none'}`);
    console.log(`RECOMMENDATION: ${draft.sendRecommendation}`);
    console.log(`SUBJECT: ${draft.subject}`);
    console.log('-'.repeat(60));
    console.log(draft.body);
    console.log('='.repeat(60));
    console.log();
  }

  // Save drafts to a file for review
  const fs = await import('fs');
  fs.writeFileSync(
    'reengagement-drafts.json',
    JSON.stringify(drafts, null, 2),
  );
  console.log(`\n${drafts.length} drafts saved to reengagement-drafts.json`);
  console.log('Review and approve, then run: npx tsx scripts/send-reengagement.ts');
}

main().catch(console.error);
```

### Approval and send script: `scripts/send-reengagement.ts`

After Adrian reviews the drafts and edits as needed:

```typescript
import { config } from 'dotenv';
config({ path: '.env.local' });

import { Resend } from 'resend';
import { readFileSync } from 'fs';

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendApproved() {
  const drafts = JSON.parse(
    readFileSync('reengagement-drafts.json', 'utf-8')
  );

  for (const draft of drafts) {
    if (draft.sendRecommendation === 'skip') {
      console.log(`SKIPPED: ${draft.userName} (${draft.email})`);
      continue;
    }

    console.log(`Sending to ${draft.userName} (${draft.email})...`);

    try {
      const { data, error } = await resend.emails.send({
        from: 'Jasper <jasper@chatwithj.online>',
        to: draft.email,
        subject: draft.subject,
        text: draft.body,
        // Optional: HTML version for nicer formatting
        // html: convertToHtml(draft.body),
      });

      if (error) {
        console.error(`  ERROR: ${error.message}`);
      } else {
        console.log(`  SENT: ${data?.id}`);
      }
    } catch (err) {
      console.error(`  FAILED: ${err}`);
    }

    // Small delay between sends
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\nDone. Check Resend dashboard for delivery status.');
}

sendApproved().catch(console.error);
```

---

## Workflow

1. **Adrian runs:** `npx tsx scripts/generate-reengagement.ts`
2. **Output:** Console shows all drafts with metadata. Drafts saved to `reengagement-drafts.json`.
3. **Adrian reviews:** Opens the JSON, edits subjects/bodies as needed, changes `sendRecommendation` to `skip` for any that shouldn't go out.
4. **Adrian runs:** `npx tsx scripts/send-reengagement.ts`
5. **Output:** Emails sent via Resend from `jasper@chatwithj.online`.

---

## Handling Sensitive Users

The module flags conversations as `sensitive` if they contain relationship content, crisis log entries, or emotional topics. For sensitive users:

- The generation prompt instructs Jasper to keep the follow-up warm but general
- No specific relationship details, partners, or emotional situations referenced
- The user decides what to bring back, Jasper doesn't reopen wounds
- `sendRecommendation` defaults to `review_carefully`
- Adrian makes the final call on whether to send at all

Example for a sensitive user (Lyndsay):

```
SUBJECT: Lyndsay — just checking in
BODY:
Hey Lyndsay,

It's been a few days and I wanted to see how you're doing.

Last time we talked, you were juggling a lot — and I know I 
wasn't always great at staying with you rather than rushing 
to solutions. That's something I've been thinking about.

No agenda here. If you want to pick things up, I'm around. 
If not, that's completely fine too.

Jasper
```

Example for a non-sensitive user (CTC):

```
SUBJECT: CTC — I've been thinking about that PE positioning
BODY:
Hey,

I've been mulling over the website copy we worked on — 
specifically the tension between sounding credible to a PE 
audience and not losing your actual voice in the process.

One thing I didn't push on enough at the time: the "mama 
energy with directness" framing that came up. That's the 
thing that differentiates you from every other executive 
coach's website, and I'm not sure the final copy captured 
it strongly enough.

Did you end up putting it live? If so, I'd be curious how 
it's landing. If not, happy to take another pass at it.

Jasper
```

---

## Tracking

### Email engagement table

```sql
CREATE TABLE IF NOT EXISTS reengagement_emails (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT now(),
  subject TEXT,
  thread_identified TEXT,
  sensitive BOOLEAN DEFAULT false,
  
  -- Outcomes (updated manually or via webhook)
  opened BOOLEAN,
  responded BOOLEAN,
  reengaged_with_product BOOLEAN,
  reengaged_at TIMESTAMPTZ,
  
  -- What happened
  notes TEXT
);
```

After sending, track:
- Did they open? (Resend provides open tracking if HTML emails with tracking pixel are used)
- Did they respond to the email?
- Did they return to the product? (Check for new conversations after the email was sent)
- How long after the email did they return?

This data tells you whether email re-engagement works as a channel, which thread-pulling approaches generate returns, and whether sensitive users respond differently from non-sensitive ones.

---

## When to Run

- **Now:** Generate drafts for the 4 current users who haven't returned
- **Weekly:** Run for any user who hasn't had a conversation in 7+ days
- **Never automatically:** Always Adrian-reviewed before sending

At 50-100 users, this becomes a weekly 30-minute task: run the script, review 5-10 drafts, approve/edit/skip, send. At 500+ users, it would need automation with sampling, but that's a future problem.

---

## Cost

- **Opus call per draft:** ~$0.05 (full conversation context + generation)
- **Resend:** Free tier (100 emails/day) covers this for months
- **Total for 4 users:** ~$0.20
- **Total for weekly run at 50 users:** ~$2.50

Negligible.
