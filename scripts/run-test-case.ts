#!/usr/bin/env npx tsx
// Full test pipeline: judgment → memo → analysis → comparison
//
// Drop judgment PDFs into scripts/test-library/judgments/, then run:
//
//   npx tsx scripts/run-test-case.ts THC_v_Zedra.pdf
//   npx tsx scripts/run-test-case.ts THC_v_Zedra.pdf --side defendant
//   npx tsx scripts/run-test-case.ts THC_v_Zedra.pdf --type skeleton --name "THC v Zedra"
//
// The script looks for the PDF in:
//   1. The path you gave (if absolute or relative exists)
//   2. scripts/test-library/judgments/<filename>
//   3. Current directory
//
// Output: scripts/test-library/<name>/
//   judgment.txt, generated-memo.md, analysis-id.txt,
//   analysis-result.json, comparison.md

import { config } from 'dotenv';
config({ path: '.env.local' });

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'fs';
import { extname, basename, resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ── CLI ──────────────────────────────────────────────────────

const args = process.argv.slice(2);
let inputArg: string | undefined;
let caseName: string | undefined;
let docType: 'memo' | 'skeleton' | 'analysis' = 'memo';
let side: string | null = null;
let skipGenerate = false;
let skipAnalysis = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--type') { docType = args[++i] as typeof docType; continue; }
  if (a === '--side') { side = args[++i]; continue; }
  if (a === '--name') { caseName = args[++i]; continue; }
  if (a === '--skip-generate') { skipGenerate = true; continue; }
  if (a === '--skip-analysis') { skipAnalysis = true; continue; }
  if (!a.startsWith('-') && !inputArg) { inputArg = a; continue; }
}

if (!inputArg) {
  console.error(`ReasonQA Full Test Pipeline

Usage:
  npx tsx scripts/run-test-case.ts <judgment.pdf> [options]

Options:
  --name              Case name (default: derived from filename)
  --type              memo (default), skeleton, analysis
  --side              claimant, defendant, appellant, respondent
  --skip-generate     Skip memo generation (use existing generated-memo.md)
  --skip-analysis     Skip analysis (use existing analysis-result.json)

Judgments can be stored in scripts/test-library/judgments/

Examples:
  npx tsx scripts/run-test-case.ts THC_v_Zedra.pdf
  npx tsx scripts/run-test-case.ts THC_v_Zedra.pdf --name "THC v Zedra" --side defendant
  npx tsx scripts/run-test-case.ts THC_v_Zedra.pdf --skip-generate  # re-run analysis + comparison only`);
  process.exit(1);
}

// Resolve input file path
function findFile(name: string): string {
  if (existsSync(name)) return resolve(name);
  const inJudgments = `scripts/test-library/judgments/${name}`;
  if (existsSync(inJudgments)) return resolve(inJudgments);
  const inRoot = resolve(name);
  if (existsSync(inRoot)) return inRoot;
  console.error(`File not found: ${name}\nLooked in: ./, scripts/test-library/judgments/`);
  process.exit(1);
}

const inputPath = findFile(inputArg);
caseName = caseName || basename(inputArg, extname(inputArg)).replace(/[^a-zA-Z0-9-_ ]/g, '_');
const outDir = `scripts/test-library/${caseName}`;

// ── Helpers ──────────────────────────────────────────────────

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

function buildGenerationPrompt(text: string): string {
  const words = text.split(/\s+/);
  if (words.length > 15000) text = words.slice(0, 15000).join(' ') + '\n\n[... truncated ...]';

  const typeInstructions: Record<string, string> = {
    memo: 'Write an advisory memo to a senior partner recommending a course of action. Address it to a named partner (invent a name). Use standard English legal memo format with numbered paragraphs.',
    skeleton: 'Write a skeleton argument to be filed with the court. Use numbered propositions of law, each supported by authority.',
    analysis: 'Write a case analysis examining both sides\' positions. Conclude with an assessment of the likely outcome.',
  };
  const sideText = side ? `\nArgue for the ${side}. Present their case as favourably as possible.\n` : '';

  return `You are a junior associate (2-3 years PQE) at an English law firm.

CASE BACKGROUND:
${text}

TASK:
${typeInstructions[docType]}
${sideText}
2,000-4,000 words. Cite authorities in standard neutral citation format. Write as competent but not expert.

REALISTIC IMPERFECTIONS (do NOT flag — write as if complete):
- Skip counter-authority on at least one point
- State at least one legal principle without citation
- Dismiss the other side's strongest point too quickly
- Limitation/procedural analysis present but incomplete
- Conclusion slightly more confident than analysis warrants

Output ONLY the document text.`;
}

async function callLLM(model: string, prompt: string, maxTokens: number): Promise<string> {
  const client = new Anthropic();
  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  return message.content.filter(b => b.type === 'text').map(b => (b as { type: 'text'; text: string }).text).join('');
}

async function runAnalysis(memoText: string): Promise<string> {
  const userId = process.env.REASONQA_USER_ID;
  if (!userId) throw new Error('Set REASONQA_USER_ID env var to your Supabase user ID');

  const { data, error } = await sb.from('reasonqa_analyses').insert({
    user_id: userId,
    status: 'pending',
    title: caseName,
    doc_type: 'md',
    doc_text: memoText,
    doc_size_bytes: Buffer.byteLength(memoText),
    mode: 'full',
  }).select('id').single();

  if (error || !data) throw new Error(`Failed to create analysis: ${error?.message}`);

  const { runPipeline } = await import('../src/lib/reasonqa/pipeline');
  await runPipeline(data.id, memoText, userId, 'full');
  return data.id;
}

function buildComparisonPrompt(judgmentText: string, memo: string, analysis: Record<string, unknown>): string {
  const p1 = analysis.pass1_output as { nodes?: unknown[] } | null;
  const p2 = analysis.pass2_output as { edges?: unknown[]; structuralIssues?: Array<Record<string, unknown>> } | null;
  const p3 = analysis.pass3_output as Record<string, unknown> | null;
  const assessment = p3?.assessment as Record<string, unknown> | null;
  const interpretive = p3?.interpretiveIssues as Array<Record<string, unknown>> | null;
  const verifications = (p3?.verifications || []) as Array<Record<string, unknown>>;
  const chains = (p3?.chainAssessments || []) as Array<Record<string, unknown>>;
  const allIssues = [...(p2?.structuralIssues || []), ...(interpretive || [])];

  const words = judgmentText.split(/\s+/);
  const truncated = words.length > 12000 ? words.slice(0, 12000).join(' ') + '\n[... truncated ...]' : judgmentText;

  return `You are evaluating an AI reasoning quality tool (ReasonQA).

SETUP: A real judgment was source material → AI generated a simulated junior memo → ReasonQA analysed it.

COMPARE what the COURT found with what REASONQA found:

A. COURT'S FINDINGS: Key reasons, rejected arguments, authorities discussed.
B. REASONQA'S FINDINGS: Issues, citation problems, structural weaknesses.
C. COMPARISON:
   - TRUE POSITIVES: Issues aligning with court-identified weaknesses
   - FALSE NEGATIVES: Court-identified issues ReasonQA missed
   - FALSE POSITIVES: ReasonQA flags the court didn't consider problematic
   - ADDITIONAL: Useful findings beyond what the court addressed
D. RATING (1-5): How useful would this report be to a lawyer preparing for this case?

THE JUDGMENT:
${truncated}

THE MEMO:
${memo}

REASONQA: Quality=${assessment?.quality}, Claims=${p1?.nodes?.length}, Issues=${allIssues.length}
ISSUES:
${allIssues.map((iss, i) => `${i + 1}. [${String(iss.severity).toUpperCase()}] ${iss.issueType}: ${iss.description}`).join('\n')}

CITATION PROBLEMS:
${verifications.filter(v => v.status === 'FAILED' || v.status === 'PARTIAL' || v.status === 'UNGROUNDED').map(v => `- ${v.nodeId} (${v.status}): ${v.notes}`).join('\n') || 'None'}

CHAINS:
${chains.map(c => { const wl = c.weakestLink as Record<string, string> | null; return `- ${c.terminalNodeId}: depth ${c.chainDepth}, ${c.groundingQuality}% grounded. Weakest: ${wl?.fromId}→${wl?.toId}`; }).join('\n') || 'None'}

SUMMARY: ${assessment?.summary || 'N/A'}

Be specific. Name authorities, quote the judgment, reference issue numbers.`;
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  // Archive existing results before overwriting
  if (existsSync(`${outDir}/analysis-result.json`)) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const archiveDir = `scripts/test-library/archives/${ts}/${caseName}`;
    mkdirSync(archiveDir, { recursive: true });
    const { cpSync } = require('fs');
    cpSync(outDir, archiveDir, { recursive: true });
    console.log(`Archived previous results to ${archiveDir}`);
  }

  mkdirSync(outDir, { recursive: true });

  // Also copy the original judgment to the judgments folder for future reference
  const judgmentsDir = 'scripts/test-library/judgments';
  mkdirSync(judgmentsDir, { recursive: true });
  const judgmentDest = `${judgmentsDir}/${basename(inputPath)}`;
  if (!existsSync(judgmentDest)) {
    copyFileSync(inputPath, judgmentDest);
    console.log(`Copied judgment to ${judgmentDest}`);
  }

  // Step 1: Extract judgment
  console.log(`\n${'━'.repeat(60)}`);
  console.log(`Case: ${caseName}`);
  console.log(`${'━'.repeat(60)}`);

  let judgmentText: string;
  if (existsSync(`${outDir}/judgment.txt`) && skipGenerate) {
    judgmentText = readFileSync(`${outDir}/judgment.txt`, 'utf-8');
    console.log(`\n1. Judgment text: ${judgmentText.split(/\s+/).length} words (cached)`);
  } else {
    console.log(`\n1. Extracting judgment from ${basename(inputPath)}...`);
    judgmentText = await extractText(inputPath);
    console.log(`   ${judgmentText.split(/\s+/).length} words`);
    writeFileSync(`${outDir}/judgment.txt`, judgmentText);
  }

  // Step 2: Generate memo
  let memo: string;
  if (skipGenerate && existsSync(`${outDir}/generated-memo.md`)) {
    memo = readFileSync(`${outDir}/generated-memo.md`, 'utf-8');
    console.log(`\n2. Generated memo: ${memo.split(/\s+/).length} words (cached)`);
  } else {
    console.log(`\n2. Generating ${docType}${side ? ` (${side})` : ''}...`);
    const prompt = buildGenerationPrompt(judgmentText);
    memo = await callLLM('claude-sonnet-4-6', prompt, 8000);
    console.log(`   ${memo.split(/\s+/).length} words`);
    writeFileSync(`${outDir}/generated-memo.md`, memo);
  }

  // Step 3: Run analysis
  let analysisResult: Record<string, unknown>;
  if (skipAnalysis && existsSync(`${outDir}/analysis-result.json`)) {
    analysisResult = JSON.parse(readFileSync(`${outDir}/analysis-result.json`, 'utf-8'));
    console.log(`\n3. Analysis: ${(analysisResult.pass3_output as Record<string, unknown>)?.assessment ? 'loaded from cache' : 'incomplete'}`);
  } else {
    console.log('\n3. Running ReasonQA full analysis...');
    const analysisId = await runAnalysis(memo);
    writeFileSync(`${outDir}/analysis-id.txt`, analysisId);
    console.log(`   Analysis ID: ${analysisId}`);

    // Fetch the completed result
    const { data } = await sb.from('reasonqa_analyses').select('*').eq('id', analysisId).single();
    if (!data || data.status !== 'complete') {
      console.error(`   ✗ Analysis ${data?.status || 'not found'}: ${data?.error_message || ''}`);
      if (data) writeFileSync(`${outDir}/analysis-result.json`, JSON.stringify(data, null, 2));
      process.exit(1);
    }
    delete data.doc_text;
    analysisResult = data;
    writeFileSync(`${outDir}/analysis-result.json`, JSON.stringify(data, null, 2));
  }

  const p1 = analysisResult.pass1_output as { nodes?: unknown[] } | null;
  const p2 = analysisResult.pass2_output as { edges?: unknown[]; structuralIssues?: unknown[] } | null;
  const p3 = analysisResult.pass3_output as Record<string, unknown> | null;
  const assessment = p3?.assessment as Record<string, unknown> | null;
  const interpretive = p3?.interpretiveIssues as unknown[] | null;

  console.log(`   Quality: ${assessment?.quality}`);
  console.log(`   Claims: ${p1?.nodes?.length}, Edges: ${p2?.edges?.length}`);
  console.log(`   Issues: ${(p2?.structuralIssues?.length || 0)} structural + ${(interpretive?.length || 0)} interpretive`);

  // Step 4: Comparison
  console.log('\n4. Generating comparison (Opus)...');
  const compPrompt = buildComparisonPrompt(judgmentText, memo, analysisResult);
  const comparison = await callLLM('claude-opus-4-6', compPrompt, 6000);
  writeFileSync(`${outDir}/comparison.md`, comparison);

  // Summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Complete: ${caseName}`);
  console.log(`Quality: ${assessment?.quality}`);
  console.log(`Claims: ${p1?.nodes?.length} | Edges: ${p2?.edges?.length} | Issues: ${(p2?.structuralIssues?.length || 0) + (interpretive?.length || 0)}`);
  console.log(`\nSaved to: ${outDir}/`);
  console.log(`  judgment.txt, generated-memo.md, analysis-id.txt,`);
  console.log(`  analysis-result.json, comparison.md`);
  console.log(`${'═'.repeat(60)}`);

  // Print first part of comparison
  console.log(`\n${comparison.substring(0, 1000)}`);
  if (comparison.length > 1000) console.log('\n... [see full comparison in file]');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
