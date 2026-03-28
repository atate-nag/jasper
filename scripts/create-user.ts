// Create a new user with password login and clone profile.
// Usage: npx tsx scripts/create-user.ts <email> [password]
// Default password: ilovejasper

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const email = process.argv[2];
const password = process.argv[3] || 'ilovejasper';

if (!email) {
  console.log('Usage: npx tsx scripts/create-user.ts <email> [password]');
  console.log('Default password: ilovejasper');
  process.exit(0);
}

async function main(): Promise<void> {
  // Check if user already exists
  const { data: { users } } = await sb.auth.admin.listUsers();
  const existing = users.find(u => u.email === email);
  if (existing) {
    console.log(`User ${email} already exists (${existing.id})`);
    process.exit(1);
  }

  // Create auth user
  const { data, error } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) {
    console.error('Failed:', error.message);
    process.exit(1);
  }

  console.log(`Created: ${email} | ID: ${data.user.id}`);

  // Create clone profile
  const { createCloneProfile } = await import('../src/lib/backbone/clone');
  await createCloneProfile(data.user.id);

  console.log(`Clone profile created.`);
  console.log(`\nLogin: ${email} / ${password}`);
  console.log(`URL: https://chat.chatwithj.online`);
}

main().catch(console.error);
