import { config } from 'dotenv';
config({ path: '.env.local' });

import { getProfile } from '../src/lib/backbone/profile';
import { dedupCandidates } from '../src/lib/backbone/classify';

const USER_ID = process.argv[2] || '00000000-0000-0000-0000-000000000001';

async function main(): Promise<void> {
  console.log(`Cleaning profile for user: ${USER_ID}`);

  const profile = await getProfile(USER_ID);
  if (!profile) {
    console.log('No profile found.');
    return;
  }

  const DEDUP_FIELDS = [
    'growth_edges', 'stress_responses', 'decision_patterns',
    'avoidance_patterns', 'active_concerns', 'recent_wins',
    'open_questions', 'key_dynamics',
  ];

  const sections = ['patterns', 'current_state', 'relationships'] as const;

  for (const section of sections) {
    const data = profile[section] as Record<string, unknown> | undefined;
    if (!data) continue;

    for (const field of Object.keys(data)) {
      if (!DEDUP_FIELDS.includes(field)) continue;
      const arr = data[field];
      if (!Array.isArray(arr) || arr.length < 2) continue;
      if (typeof arr[0] !== 'string') continue;

      console.log(`\n${section}.${field} (${arr.length} entries):`);
      arr.forEach((e: string, i: number) => console.log(`  [${i}] ${e}`));

      if (arr.length > 2) {
        const half = Math.floor(arr.length / 2);
        const kept = await dedupCandidates(
          arr.slice(half), arr.slice(0, half), `${section}.${field}`,
        );
        console.log(`  → ${kept.length} unique out of ${arr.length - half} candidates`);
      }
    }
  }

  console.log('\nDone. (Dry run — no changes saved. Edit script to apply.)');
}

main().catch(console.error);
