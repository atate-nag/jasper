// Test Layer B (full): Search for citing cases, extract citation paragraphs,
// and classify treatment with Haiku.
//
// Usage:
//   npx tsx scripts/test-corpus-classify.ts "Bedfordshire" "breach of statutory duty does not give rise to private law cause of action" "breach statutory duty"
//   npx tsx scripts/test-corpus-classify.ts "Energy Solutions" "Francovich damages are available" "Francovich damages"

import { config } from 'dotenv';
config({ path: '.env.local' });

import { searchCaseLaw } from '../src/lib/reasonqa/corpus/interpretive/atom-client';
import { extractCitationWindows } from '../src/lib/reasonqa/corpus/interpretive/citation-extractor';
import { classifyCitationTreatment } from '../src/lib/reasonqa/corpus/interpretive/classifier';

const authority = process.argv[2];
const proposition = process.argv[3] || '';
const topicalTerms = process.argv[4] || '';

if (!authority || !proposition) {
  console.error('Usage: npx tsx scripts/test-corpus-classify.ts "<authority>" "<proposition>" ["topical terms"]');
  console.error('Example:');
  console.error('  npx tsx scripts/test-corpus-classify.ts "Bedfordshire" "breach of statutory duty does not give rise to private law cause of action" "breach statutory duty"');
  process.exit(1);
}

async function main(): Promise<void> {
  // Build query
  const queryParts = [`"${authority}"`];
  if (topicalTerms) {
    queryParts.push(
      ...topicalTerms.split(/\s+/).filter(t => t.length > 2).map(t => `"${t}"`)
    );
  }
  const query = queryParts.join(' ');

  // Search
  console.log(`\nSearching: ${query}\n`);
  const hits = await searchCaseLaw(query, 10);
  console.log(`Found ${hits.length} citing cases\n`);

  if (hits.length === 0) {
    console.log('✗ No results. Try different search terms.');
    return;
  }

  // Extract and classify (limit to 5 cases for speed)
  const results: Array<{ case: string; treatment: string; explanation: string }> = [];
  let supports = 0;
  let undermines = 0;
  let distinguishes = 0;
  let neutral = 0;

  for (const hit of hits.slice(0, 5)) {
    console.log(`Fetching: ${hit.title} (${hit.uri})`);
    const windows = await extractCitationWindows(hit.uri, authority, hit.title, 2);

    if (windows.length === 0) {
      console.log(`  → no mention of "${authority}" found in paragraphs\n`);
      continue;
    }

    for (const window of windows) {
      console.log(`  Classifying citation window...`);
      const classified = await classifyCitationTreatment(window, authority, proposition);

      results.push({
        case: classified.citingCase,
        treatment: classified.treatment,
        explanation: classified.explanation,
      });

      const icon = classified.treatment === 'SUPPORTS' ? '✓'
        : classified.treatment === 'UNDERMINES' ? '✗'
        : classified.treatment === 'DISTINGUISHES' ? '~'
        : '·';
      console.log(`  ${icon} ${classified.treatment}: ${classified.explanation}\n`);

      if (classified.treatment === 'SUPPORTS') supports++;
      else if (classified.treatment === 'UNDERMINES') undermines++;
      else if (classified.treatment === 'DISTINGUISHES') distinguishes++;
      else neutral++;
    }
  }

  // Summary
  console.log('─'.repeat(60));
  console.log(`\nAuthority: ${authority}`);
  console.log(`Proposition: "${proposition}"`);
  console.log(`\nClassifications: ${results.length}`);
  console.log(`  SUPPORTS:      ${supports}`);
  console.log(`  UNDERMINES:    ${undermines}`);
  console.log(`  DISTINGUISHES: ${distinguishes}`);
  console.log(`  NEUTRAL:       ${neutral}`);

  const janusFaced = supports > 0 && undermines > 0;
  console.log(`\n  JANUS-FACED: ${janusFaced ? '⚠ YES — courts go both ways' : 'No'}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
