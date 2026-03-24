import { config } from 'dotenv';
config({ path: '.env.local' });

import { getProfile, compressProfile } from '../src/lib/backbone/profile';

const USER_ID = process.argv[2] || '00000000-0000-0000-0000-000000000001';

async function main(): Promise<void> {
  console.log(`Compressing profile for user: ${USER_ID}\n`);

  const before = await getProfile(USER_ID);
  if (!before) {
    console.log('No profile found.');
    return;
  }

  // Show before state — all sections
  const sections = ['patterns', 'current_state', 'interaction_prefs', 'relationships'] as const;
  console.log('Before:');
  for (const section of sections) {
    const data = before[section] as Record<string, unknown> | undefined;
    if (!data) continue;
    console.log(`\n  ${section}:`);
    for (const [k, v] of Object.entries(data)) {
      if (Array.isArray(v)) {
        console.log(`    ${k}: ${v.length} entries`);
      } else if (typeof v === 'string') {
        console.log(`    ${k}: "${v.slice(0, 60)}${v.length > 60 ? '...' : ''}"`);
      }
    }
  }

  console.log('\nCompressing...\n');
  await compressProfile(USER_ID);

  // Show after state — all sections
  const after = await getProfile(USER_ID);
  if (after) {
    console.log('\nAfter:');
    for (const section of sections) {
      const data = after[section] as Record<string, unknown> | undefined;
      if (!data) continue;
      console.log(`\n  ${section}:`);
      for (const [k, v] of Object.entries(data)) {
        if (Array.isArray(v)) {
          console.log(`    ${k}: ${v.length} entries`);
          for (const e of v) {
            console.log(`      - ${String(e).slice(0, 100)}${String(e).length > 100 ? '...' : ''}`);
          }
        } else if (typeof v === 'string') {
          console.log(`    ${k}: "${v.slice(0, 80)}${v.length > 80 ? '...' : ''}"`);
        }
      }
    }
  }

  console.log('\nDone.');
}

main().catch(console.error);
