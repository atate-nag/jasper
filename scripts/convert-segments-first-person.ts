// Convert existing third-person conversation segments to Jasper's first-person memories.
// Back up the segments table before running:
//   CREATE TABLE conversation_segments_backup AS SELECT * FROM conversation_segments;

import { config } from 'dotenv';
config({ path: '.env.local' });

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key);
const anthropic = new Anthropic();
const openai = new OpenAI();

const CONVERSION_PROMPT = `You are Jasper, converting an observation about a past conversation into your own first-person memory of it.

The original observation was written by an analyst. Rewrite it as YOUR memory — something you experienced, noticed, or learned.

Rules:
- Write as "I" or "we" — never "the user" or "the AI"
- Keep the same factual content
- Add emotional texture if the original is dry
- 1-3 sentences maximum
- If it says "the user did X" rewrite as what happened from your perspective
- If it says "the AI identified a pattern" rewrite as "I noticed..."
- If it references "Adrian" by name, keep the name

ORIGINAL OBSERVATION:
{original}

YOUR MEMORY (first person, 1-3 sentences, no quotes around it):`;

async function embed(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return response.data[0].embedding;
}

async function convertToFirstPerson(original: string): Promise<string> {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    temperature: 0.3,
    messages: [{ role: 'user', content: CONVERSION_PROMPT.replace('{original}', original) }],
  });

  const block = response.content[0];
  if (block.type !== 'text') return '';
  return block.text.trim();
}

async function main(): Promise<void> {
  const { data: segments, error } = await supabase
    .from('conversation_segments')
    .select('id, content')
    .order('created_at', { ascending: true });

  if (error || !segments) {
    console.error('Failed to load segments:', error?.message);
    return;
  }

  // Skip segments that already look first-person
  const toConvert = segments.filter(s => {
    const lower = s.content.toLowerCase();
    return lower.includes('the user') || lower.includes('the ai ') ||
           lower.startsWith('during a conversation') ||
           lower.startsWith('pattern observed') ||
           lower.startsWith('a pattern');
  });

  console.log(`${segments.length} total segments, ${toConvert.length} need conversion.\n`);

  let converted = 0;
  let failed = 0;

  for (const segment of toConvert) {
    try {
      const newContent = await convertToFirstPerson(segment.content);

      if (!newContent || newContent.length < 10) {
        console.log(`  SKIP ${segment.id.slice(0, 8)}: empty conversion`);
        failed++;
        continue;
      }

      // Regenerate embedding
      const newEmbedding = await embed(newContent);

      // Update in place
      const { error: updateError } = await supabase
        .from('conversation_segments')
        .update({
          content: newContent,
          embedding: `[${newEmbedding.join(',')}]`,
        })
        .eq('id', segment.id);

      if (updateError) {
        console.log(`  FAIL ${segment.id.slice(0, 8)}: ${updateError.message}`);
        failed++;
      } else {
        converted++;
        if (converted % 10 === 0) {
          console.log(`  ${converted}/${toConvert.length} converted...`);
        }
      }

      // Rate limiting
      await new Promise(r => setTimeout(r, 200));

    } catch (err) {
      console.log(`  ERROR ${segment.id.slice(0, 8)}: ${err}`);
      failed++;
    }
  }

  console.log(`\nDone. Converted: ${converted}, Failed: ${failed}, Skipped: ${segments.length - toConvert.length}`);
}

main().catch(console.error);
