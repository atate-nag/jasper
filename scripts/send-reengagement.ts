// Send approved re-engagement emails via Resend.
// Usage: npx tsx scripts/send-reengagement.ts
// Reads from reengagement-drafts.json (edit before running).
// Skips drafts with sendRecommendation: "skip".

import { config } from 'dotenv';
config({ path: '.env.local' });

import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const resend = new Resend(process.env.RESEND_API_KEY);
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

interface Draft {
  userId: string;
  userName: string;
  email: string;
  subject: string;
  body: string;
  threadIdentified: string;
  sensitive: boolean;
  sendRecommendation: string;
}

async function main(): Promise<void> {
  let drafts: Draft[];
  try {
    drafts = JSON.parse(readFileSync('reengagement-drafts.json', 'utf-8'));
  } catch {
    console.log('No reengagement-drafts.json found. Run generate-reengagement.ts first.');
    return;
  }

  let sent = 0;
  let skipped = 0;

  for (const draft of drafts) {
    if (draft.sendRecommendation === 'skip') {
      console.log(`SKIPPED: ${draft.userName} (${draft.email})`);
      skipped++;
      continue;
    }

    console.log(`Sending to ${draft.userName} (${draft.email})...`);

    try {
      const { data, error } = await resend.emails.send({
        from: 'Jasper <jasper@chatwithj.online>',
        to: draft.email,
        subject: draft.subject,
        text: draft.body + '\n\n—\nJasper\nchatwithj.online',
        replyTo: 'jasper@chatwithj.online',
      });

      if (error) {
        console.error(`  ERROR: ${error.message}`);
        continue;
      }

      console.log(`  SENT: ${data?.id}`);
      sent++;

      // Log to database
      await sb.from('reengagement_emails').insert({
        user_id: draft.userId,
        subject: draft.subject,
        thread_identified: draft.threadIdentified,
        sensitive: draft.sensitive,
      });

    } catch (err) {
      console.error(`  FAILED:`, err);
    }

    // Small delay between sends
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\nDone. Sent: ${sent}, Skipped: ${skipped}`);
  console.log('Check Resend dashboard for delivery status.');
}

main().catch(console.error);
