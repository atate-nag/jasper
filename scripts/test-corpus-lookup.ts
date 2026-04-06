// Test Layer A: Direct citation lookup against National Archives / legislation.gov.uk
//
// Usage:
//   npx tsx scripts/test-corpus-lookup.ts "s.901G Companies Act 2006"
//   npx tsx scripts/test-corpus-lookup.ts "[2025] EWHC 2755 (Ch)"
//   npx tsx scripts/test-corpus-lookup.ts "Limitation Act 1980 s.2"

import { config } from 'dotenv';
config({ path: '.env.local' });

import { parseCitation } from '../src/lib/reasonqa/corpus/citation-parser';
import { fetchCaseLaw, fetchLegislation } from '../src/lib/reasonqa/corpus/fetcher';

const raw = process.argv.slice(2).join(' ');
if (!raw) {
  console.error('Usage: npx tsx scripts/test-corpus-lookup.ts "<citation>"');
  console.error('Examples:');
  console.error('  npx tsx scripts/test-corpus-lookup.ts "s.901G Companies Act 2006"');
  console.error('  npx tsx scripts/test-corpus-lookup.ts "[2025] EWHC 2755 (Ch)"');
  process.exit(1);
}

async function main(): Promise<void> {
  console.log(`\nParsing: "${raw}"\n`);
  const parsed = parseCitation(raw);
  console.log('Parsed citation:', JSON.stringify(parsed, null, 2));

  if (parsed.type === 'unknown') {
    console.log('\n✗ Could not parse citation — type is unknown');
    return;
  }

  let result;
  if (parsed.type === 'case' && parsed.uri) {
    console.log(`\nFetching case: ${parsed.uri}`);
    result = await fetchCaseLaw(parsed);
  } else if (parsed.type === 'statute' && parsed.legislationUri) {
    console.log(`\nFetching legislation: ${parsed.legislationUri}`);
    result = await fetchLegislation(parsed);
  } else {
    console.log('\n✗ Citation parsed but no fetchable URI resolved');
    return;
  }

  console.log(`\nFound: ${result.found}`);
  console.log(`URL: ${result.url}`);
  if (result.text) {
    console.log(`Text length: ${result.text.length} chars`);
    console.log(`\n--- Preview (first 1000 chars) ---\n`);
    console.log(result.text.substring(0, 1000));
  }
  if (result.paragraphs) {
    const keys = Object.keys(result.paragraphs);
    console.log(`\nParagraphs: ${keys.length}`);
    if (keys.length > 0) {
      console.log(`First paragraph [${keys[0]}]: ${result.paragraphs[keys[0]].substring(0, 200)}...`);
    }
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
