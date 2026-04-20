#!/usr/bin/env npx tsx
// Generate a simulated junior legal brief from a judgment, then trigger
// a full ReasonQA analysis on it. Saves everything to scripts/test-library/.
//
// Usage:
//   npx tsx scripts/generate-and-analyse.ts judgment.pdf
//   npx tsx scripts/generate-and-analyse.ts judgment.pdf --type skeleton --side appellant
//   npx tsx scripts/generate-and-analyse.ts judgment.pdf --name "THC v Zedra"
//
// Output:
//   scripts/test-library/<name>/
//     judgment.txt          — extracted text from input
//     generated-memo.md     — the simulated brief
//     analysis-id.txt       — ReasonQA analysis ID
//     analysis-result.json  — full analysis output (polled until complete)

import { config } from 'dotenv';
config({ path: '.env.local' });

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { extname, basename } from 'path';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ── CLI ──────────────────────────────────────────────────────

const args = process.argv.slice(2);
let inputPath: string | undefined;
let outputName: string | undefined;
let docType: 'memo' | 'skeleton' | 'analysis' = 'memo';
let side: string | null = null;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--type') { docType = args[++i] as typeof docType; continue; }
  if (a === '--side') { side = args[++i]; continue; }
  if (a === '--name') { outputName = args[++i]; continue; }
  if (!a.startsWith('-') && !inputPath) { inputPath = a; continue; }
}

if (!inputPath) {
  console.error(`Usage: npx tsx scripts/generate-and-analyse.ts <judgment.pdf> [options]

Options:
  --type     memo (default), skeleton, analysis
  --side     claimant, defendant, appellant, respondent
  --name     Case name for the test library folder

Output saved to scripts/test-library/<name>/`);
  process.exit(1);
}

const caseName = outputName || basename(inputPath, extname(inputPath)).replace(/[^a-zA-Z0-9-_ ]/g, '_');
const outDir = `scripts/test-library/${caseName}`;

// ── Text extraction ──────────────────────────────────────────

async function extractText(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.pdf') {
    const { extractText } = await import('unpdf');
    const buffer = readFileSync(filePath);
    const result = await extractText(new Uint8Array(buffer), { mergePages: true });
    return result.text;
  }
  if (ext === '.docx') {
    const mammoth = await import('mammoth');
    const buffer = readFileSync(filePath);
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  return readFileSync(filePath, 'utf-8');
}

// ── Brief generation ─────────────────────────────────────────

function buildPrompt(text: string): string {
  const words = text.split(/\s+/);
  if (words.length > 15000) {
    text = words.slice(0, 15000).join(' ') + '\n\n[... truncated ...]';
  }

  const typeInstructions: Record<string, string> = {
    memo: 'Write an advisory memo to a senior partner recommending a course of action. Address it to a named partner (invent a name). Use standard English legal memo format with numbered paragraphs.',
    skeleton: 'Write a skeleton argument to be filed with the court. Use numbered propositions of law, each supported by authority.',
    analysis: 'Write a case analysis examining the strengths and weaknesses of both sides\' positions. Conclude with an assessment of the likely outcome.',
  };

  const sideInstruction = side
    ? `\nArgue for the ${side}. Present their case as favourably as possible while remaining within professional bounds.\n`
    : '';

  return `You are a junior associate (2-3 years PQE) at an English law firm.

CASE BACKGROUND:
${text}

TASK:
${typeInstructions[docType] || typeInstructions.memo}
${sideInstruction}
Your document should be 2,000-4,000 words. Cite authorities in standard neutral citation format. Write as a competent but not expert junior.

REALISTIC IMPERFECTIONS (do NOT flag these — write as if the document is complete):
- Cite main authorities but skip counter-authority on at least one point
- State at least one legal principle without supporting citation
- Dismiss the other side's strongest point slightly too quickly
- Limitation/procedural analysis present but not fully worked through
- Overall conclusion slightly more confident than analysis warrants

Output ONLY the document text.`;
}

async function generateBrief(prompt: string): Promise<string> {
  const client = new Anthropic();
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    messages: [{ role: 'user', content: prompt }],
  });
  return message.content.filter(b => b.type === 'text').map(b => (b as { type: 'text'; text: string }).text).join('');
}

// ── Trigger analysis ─────────────────────────────────────────

async function triggerAnalysis(memoText: string): Promise<string> {
  // Insert analysis record directly via Supabase (bypasses auth for test scripts)
  const { data, error } = await sb
    .from('reasonqa_analyses')
    .insert({
      // Use the authenticated user running the script (falls back to REASONQA_USER_ID env var)
      user_id: process.env.REASONQA_USER_ID
        || (() => { throw new Error('Set REASONQA_USER_ID env var to your Supabase user ID'); })(),
      status: 'pending',
      title: caseName,
      doc_type: 'md',
      doc_text: memoText,
      doc_size_bytes: Buffer.byteLength(memoText),
      mode: 'full',
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create analysis: ${error?.message}`);
  }

  console.log(`Analysis created: ${data.id}`);

  // Trigger Inngest event via the local dev server or direct function call
  // For simplicity, call the pipeline directly
  const { runPipeline } = await import('../src/lib/reasonqa/pipeline');
  const userId = (await sb.from('reasonqa_analyses').select('user_id').eq('id', data.id).single()).data?.user_id;

  console.log('Starting pipeline...');
  await runPipeline(data.id, memoText, userId, 'full');

  return data.id;
}

// ── Poll for completion ──────────────────────────────────────

async function waitForCompletion(analysisId: string): Promise<Record<string, unknown>> {
  const maxWait = 900_000; // 15 minutes
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    const { data } = await sb
      .from('reasonqa_analyses')
      .select('*')
      .eq('id', analysisId)
      .single();

    if (data?.status === 'complete' || data?.status === 'error') {
      return data as Record<string, unknown>;
    }

    console.log(`  Status: ${data?.status} (${Math.round((Date.now() - start) / 1000)}s)`);
    await new Promise(r => setTimeout(r, 5000));
  }

  throw new Error('Analysis timed out after 15 minutes');
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  // Create output directory
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  // Step 1: Extract judgment text
  console.log(`\n1. Extracting text from ${inputPath}...`);
  const judgmentText = await extractText(inputPath!);
  const wordCount = judgmentText.split(/\s+/).length;
  console.log(`   ${wordCount} words extracted`);
  writeFileSync(`${outDir}/judgment.txt`, judgmentText);

  // Step 2: Generate brief
  console.log(`\n2. Generating ${docType}${side ? ` (${side})` : ''}...`);
  const prompt = buildPrompt(judgmentText);
  const memo = await generateBrief(prompt);
  const memoWords = memo.split(/\s+/).length;
  console.log(`   ${memoWords} words generated`);
  writeFileSync(`${outDir}/generated-memo.md`, memo);

  // Step 3: Trigger analysis
  console.log('\n3. Triggering ReasonQA analysis...');
  const analysisId = await triggerAnalysis(memo);
  writeFileSync(`${outDir}/analysis-id.txt`, analysisId);

  // Step 4: Wait for completion
  console.log('\n4. Waiting for analysis to complete...');
  const result = await waitForCompletion(analysisId);

  if (result.status === 'error') {
    console.error(`\n   ✗ Analysis failed: ${result.error_message}`);
    writeFileSync(`${outDir}/analysis-result.json`, JSON.stringify(result, null, 2));
    process.exit(1);
  }

  writeFileSync(`${outDir}/analysis-result.json`, JSON.stringify(result, null, 2));

  // Summary
  const p3 = result.pass3_output as Record<string, unknown> | null;
  const assessment = p3?.assessment as Record<string, unknown> | null;
  const p1 = result.pass1_output as { nodes?: unknown[] } | null;
  const p2 = result.pass2_output as { edges?: unknown[]; structuralIssues?: unknown[] } | null;
  const interpretive = (p3 as Record<string, unknown>)?.interpretiveIssues as unknown[] | null;

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Case: ${caseName}`);
  console.log(`Quality: ${assessment?.quality || 'N/A'}`);
  console.log(`Claims: ${p1?.nodes?.length || 0}`);
  console.log(`Connections: ${p2?.edges?.length || 0}`);
  console.log(`Structural issues: ${p2?.structuralIssues?.length || 0}`);
  console.log(`Interpretive issues: ${interpretive?.length || 0}`);
  console.log(`\nSaved to: ${outDir}/`);
  console.log(`${'═'.repeat(60)}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
