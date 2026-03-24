import { config } from 'dotenv';
config({ path: '.env.local' });

import { getAllMemories } from '../src/lib/backbone/memory';

const USER_ID = process.argv[2] || '00000000-0000-0000-0000-000000000001';

async function main(): Promise<void> {
  console.log(`Listing memories for user: ${USER_ID}`);

  const memories = await getAllMemories(USER_ID);
  if (memories.length === 0) {
    console.log('No memories found.');
    return;
  }

  console.log(`\n${memories.length} memories:\n`);
  for (const m of memories) {
    console.log(`  [${m.id}] ${m.memory}`);
  }

  console.log('\nTo delete a memory, use the Mem0 API directly.');
}

main().catch(console.error);
