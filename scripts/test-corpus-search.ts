// Test Layer B (search only): Find cases citing a given authority.
// No Haiku calls — just shows what the Atom feed returns.
//
// Usage:
//   npx tsx scripts/test-corpus-search.ts "Bedfordshire" "breach statutory duty"
//   npx tsx scripts/test-corpus-search.ts "Energy Solutions" "Francovich damages"
//   npx tsx scripts/test-corpus-search.ts "Recall" "Francovich Authorisation Directive"

import { searchCaseLaw } from '../src/lib/reasonqa/corpus/interpretive/atom-client';

const authority = process.argv[2];
const topicalTerms = process.argv[3] || '';

if (!authority) {
  console.error('Usage: npx tsx scripts/test-corpus-search.ts "<authority>" ["topical terms"]');
  console.error('Examples:');
  console.error('  npx tsx scripts/test-corpus-search.ts "Bedfordshire" "breach statutory duty"');
  console.error('  npx tsx scripts/test-corpus-search.ts "Energy Solutions" "Francovich"');
  process.exit(1);
}

async function main(): Promise<void> {
  const queryParts = [`"${authority}"`];
  if (topicalTerms) {
    queryParts.push(
      ...topicalTerms.split(/\s+/).filter(t => t.length > 2).map(t => `"${t}"`)
    );
  }
  const query = queryParts.join(' ');

  console.log(`\nSearching Find Case Law: ${query}\n`);
  const hits = await searchCaseLaw(query, 15);

  if (hits.length === 0) {
    console.log('✗ No results found. Try different search terms.');
    return;
  }

  console.log(`Found ${hits.length} cases:\n`);
  for (const hit of hits) {
    console.log(`  ${hit.title}`);
    console.log(`    URI: ${hit.uri}`);
    console.log(`    Date: ${hit.date}`);
    console.log();
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
