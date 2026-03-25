import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import * as readline from 'readline';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE env vars (need service role key)');
  process.exit(1);
}

const supabase = createClient(url, key);

// ============================================================
// PROTECTED ACCOUNTS — can NEVER be deleted by this script
// ============================================================
const PROTECTED_USERS = new Set([
  '3a1272b1-577c-42a4-801e-e952fed68971', // Adrian's primary account
]);

const PROTECTED_EMAILS = new Set([
  'adrian@jasper.ai',     // add any emails that should never be deletable
]);

// Only accounts on the test domain can be deleted
const ALLOWED_TEST_DOMAINS = ['chatwithj.online'];

// ============================================================

const email = process.argv[2];
if (!email) {
  console.log('Usage: npx tsx scripts/reset-user.ts tester@chatwithj.online');
  console.log('');
  console.log('Safety rules:');
  console.log('  - Protected user IDs and emails can never be deleted');
  console.log(`  - Only emails on these domains are deletable: ${[...ALLOWED_TEST_DOMAINS].join(', ')}`);
  console.log('  - Requires confirmation before deletion');
  process.exit(0);
}

function isAllowedTestEmail(addr: string): boolean {
  if (PROTECTED_EMAILS.has(addr.toLowerCase())) return false;

  const [, domain] = addr.toLowerCase().split('@');
  if (!domain) return false;

  // Must be on an allowed test domain
  return ALLOWED_TEST_DOMAINS.includes(domain);
}

async function confirm(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(prompt, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'yes');
    });
  });
}

async function main(): Promise<void> {
  // Safety check: email format
  if (!isAllowedTestEmail(email)) {
    console.error(`BLOCKED: "${email}" is not a deletable test account.`);
    console.error(`Only emails on these domains can be deleted: ${[...ALLOWED_TEST_DOMAINS].join(', ')}`);
    console.error('Example: tester@chatwithj.online');
    process.exit(1);
  }

  // Find the user
  const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) {
    console.error('Failed to list users:', listError.message);
    return;
  }

  const user = users.find(u => u.email === email);
  if (!user) {
    console.log(`No user found with email: ${email}`);
    return;
  }

  const userId = user.id;

  // Safety check: protected user ID
  if (PROTECTED_USERS.has(userId)) {
    console.error(`BLOCKED: User ${userId} is a protected account and cannot be deleted.`);
    process.exit(1);
  }

  console.log(`Found test user: ${userId} (${email})`);
  console.log(`Created: ${user.created_at}`);

  // Check how much data exists
  const { count: convCount } = await supabase
    .from('conversations')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  console.log(`Data: ${convCount ?? 0} conversations`);

  // Require confirmation
  const confirmed = await confirm(`\nType "yes" to delete this test account and all its data: `);
  if (!confirmed) {
    console.log('Cancelled.');
    return;
  }

  // Delete data in order (foreign key constraints)
  const tables = [
    'turn_logs',
    'conversation_segments',
    'conversations',
    'bandit_state',
    'user_profiles',
  ];

  for (const table of tables) {
    const { error, count } = await supabase
      .from(table)
      .delete({ count: 'exact' })
      .eq('user_id', userId);

    if (error) {
      console.log(`  ${table}: error — ${error.message}`);
    } else {
      console.log(`  ${table}: deleted ${count ?? 0} rows`);
    }
  }

  // Delete the auth user
  const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);
  if (deleteError) {
    console.error(`  auth.users: error — ${deleteError.message}`);
  } else {
    console.log(`  auth.users: deleted`);
  }

  console.log(`\nDone. Re-invite: npx tsx scripts/invite-users.ts ${email}`);
}

main().catch(console.error);
