import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE env vars (need service role key for admin.inviteUserByEmail)');
  process.exit(1);
}

const supabase = createClient(url, key);

const REDIRECT_URL = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL}/welcome`
  : 'http://localhost:3000/welcome';

const emails = process.argv.slice(2);

if (emails.length === 0) {
  console.log('Usage: npx tsx scripts/invite-users.ts user1@example.com user2@example.com ...');
  process.exit(0);
}

async function main(): Promise<void> {
  console.log(`Inviting ${emails.length} user(s)...\n`);

  for (const email of emails) {
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo: REDIRECT_URL,
    });

    if (error) {
      console.error(`  FAILED: ${email} — ${error.message}`);
    } else {
      console.log(`  OK: ${email} (id: ${data.user.id})`);
    }
  }

  console.log('\nDone.');
}

main().catch(console.error);
