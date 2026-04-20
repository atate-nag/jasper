#!/usr/bin/env npx tsx
// Run dialectical passes with decision frameworks on all calibrated cases.

import { config } from 'dotenv';
config({ path: '.env.local' });

import { readFileSync, existsSync } from 'fs';
import { getSupabaseAdmin } from '../src/lib/supabase';
import { callModelWithTimeout, parseJsonResponse, OPUS_TIMEOUT_MS } from '../src/lib/reasonqa/pipeline-utils';
import { REASONQA_SONNET, REASONQA_OPUS } from '../src/lib/reasonqa/models';
import { buildPass5Prompt } from '../src/lib/reasonqa/prompts/pass5';
import { buildPass8Prompt } from '../src/lib/reasonqa/prompts/pass8';
import { buildPass9Prompt } from '../src/lib/reasonqa/prompts/pass9';
import { CRITICAL_QUESTIONS } from '../src/lib/reasonqa/dialectical/critical-questions';
import { logUsage } from '../src/lib/usage';
import type { Pass1Output, Pass3Output, Pass4Output, Pass5Output, Pass6Output, Pass7Output, Pass8Output, Pass9Output } from '../src/lib/reasonqa/types';

const sb = getSupabaseAdmin();

const CASES = [
  { pattern: 'Poundland%Sanction', framework: 'docs/part-26a-cram-down-decision-framework.md', name: 'Poundland' },
  { pattern: 'Lexana', framework: 'docs/spa-warranty-fraud-decision-framework.md', name: 'Lexana' },
  { pattern: 'Hotel La Tour', framework: 'docs/vat-input-tax-deductibility-decision-framework.md', name: 'HMRC' },
  { pattern: 'Edge%Ofcom%Actionable', framework: 'docs/regulatory-breach-decision-framework.md', name: 'Edge' },
  { pattern: 'Zedra', framework: 'docs/limitation-decision-framework.md', name: 'THC' },
];

async function updateAnalysis(id: string, fields: Record<string, unknown>) {
  await sb.from('reasonqa_analyses').update(fields).eq('id', id);
}

function loadFramework(path: string): string {
  // Pass full framework — condensing removed per design team directive.
  // Full frameworks (~20K) need 900s timeout but produce better dialectical scores.
  return readFileSync(path, 'utf-8');
}

async function runDialecticalWithFramework(caseName: string, analysisId: string, pass1: Pass1Output, pass3: Pass3Output, pass4: Pass4Output, userId: string, framework: string) {
  console.log(`\n${'━'.repeat(60)}`);
  console.log(`${caseName}: running dialectical with framework`);
  console.log(`${'━'.repeat(60)}`);

  const summary = pass3?.assessment?.summary || '';

  // Pass 5
  console.log('  Pass 5: schemes...');
  const p5 = buildPass5Prompt(pass1);
  const r5 = await callModelWithTimeout(REASONQA_SONNET, p5.systemPrompt, [{ role: 'user', content: p5.userMessage }], 0.2, 'pass5');
  logUsage(r5.usage, 'reasonqa:pass5', userId);
  const pass5: Pass5Output = parseJsonResponse(r5.text) as Pass5Output;
  await updateAnalysis(analysisId, { pass5_output: pass5 });
  console.log(`  → ${pass5.nodeSchemes?.length} schemes`);

  // Pass 6 with framework
  console.log('  Pass 6: counter-argument (with framework)...');
  const schemeMap = new Map((pass5.nodeSchemes || []).map(s => [s.nodeId, s.scheme]));
  const targetIds = new Set<string>();
  for (const id of pass4.ultimateConclusions || []) targetIds.add(id);
  for (const sc of pass4.necessarySubConclusions || []) targetIds.add(sc.nodeId);
  for (const ca of pass4.criticalityAssessments || []) {
    if (ca.criticality === 'CRITICAL' || ca.criticality === 'SIGNIFICANT') {
      const node = pass1.nodes[ca.issueIndex];
      if (node) targetIds.add(node.id);
    }
  }

  const targetNodes = pass1.nodes.filter(n => targetIds.has(n.id)).map(n => {
    const scheme = schemeMap.get(n.id) || 'other';
    const cqs = CRITICAL_QUESTIONS[scheme] || [];
    return `[${n.id}] (${scheme}) ${n.text.substring(0, 200)}\n  CQs: ${cqs.map(q => q.id + ': ' + q.text).join('; ')}`;
  });

  const p6Prompt = `You are constructing the strongest possible counter-argument to Document A.

DECISION FRAMEWORK:
${framework}

Using the framework, construct counter-arguments focused on where courts direct the most analytical energy in this type of case. Be aggressive. Do not hedge.

Return raw JSON:
{ "counterPositions": [{ "nodeId": "string", "counterText": "string", "criticalQuestionsAnswered": [{ "cqId": "string", "answer": "string", "strength": "strong|moderate|weak" }], "overallStrength": "strong|moderate|weak" }] }
Return raw JSON only.`;

  const FRAMEWORK_TIMEOUT_MS = 900_000; // 15min — full frameworks produce larger prompts
  const r6 = await callModelWithTimeout(REASONQA_OPUS, p6Prompt, [{ role: 'user', content: `DOCUMENT A: ${summary}\n\nLOAD-BEARING NODES (${targetNodes.length}):\n${targetNodes.join('\n\n')}` }], 0.9, 'pass6', FRAMEWORK_TIMEOUT_MS);
  logUsage(r6.usage, 'reasonqa:pass6', userId);
  const pass6: Pass6Output = parseJsonResponse(r6.text) as Pass6Output;
  await updateAnalysis(analysisId, { pass6_output: pass6 });
  console.log(`  → ${pass6.counterPositions?.length} counters`);

  // Pass 7 with framework
  console.log('  Pass 7: synthesis (with framework)...');
  const nodesA = pass1.nodes.map(n => `[${n.id}] ${n.text.substring(0, 150)}`).join('\n');
  const countersB = pass6.counterPositions.map(cp => `Counter to ${cp.nodeId}: ${cp.counterText.substring(0, 200)} (${cp.overallStrength})`).join('\n\n');

  const p7Prompt = `You are a detached, competent decision-maker.

DECISION FRAMEWORK:
${framework}

Using the framework, construct the objective synthesis weighted by where courts actually decide these cases. If the document's analysis is misdirected relative to the framework, that mismatch is a critical finding.

RULES: When A and B conflict, CHOOSE ONE. Prefer positions with greater evidential coverage. Prefer fewer contradictions.

Return raw JSON:
{ "synthesis": "string", "acceptedFromA": ["IDs"], "rejectedFromA": ["IDs"], "acceptedFromB": ["strings"], "contested": ["IDs"], "loadBearingNodes": [{ "nodeId": "string", "reason": "string", "resolution": "string", "confidence": 0.0 }] }
Return raw JSON only.`;

  const r7 = await callModelWithTimeout(REASONQA_OPUS, p7Prompt, [{ role: 'user', content: `DOCUMENT A: ${summary}\n\nPROPOSITIONS (${pass1.nodes.length}):\n${nodesA}\n\nCOUNTERS (${pass6.counterPositions.length}):\n${countersB}` }], 0.2, 'pass7', FRAMEWORK_TIMEOUT_MS);
  logUsage(r7.usage, 'reasonqa:pass7', userId);
  const pass7: Pass7Output = parseJsonResponse(r7.text) as Pass7Output;
  await updateAnalysis(analysisId, { pass7_output: pass7 });
  console.log(`  → accepted=${pass7.acceptedFromA?.length} rejected=${pass7.rejectedFromA?.length} contested=${pass7.contested?.length}`);

  // Pass 8
  console.log('  Pass 8: perturbation...');
  const toTest = (pass7.rejectedFromA || []).slice(0, 5);
  const perturbations = [];
  for (const nodeId of toTest) {
    const node = pass1.nodes.find(n => n.id === nodeId);
    if (!node) continue;
    const p8 = buildPass8Prompt(pass7, nodeId, node.text);
    const r8 = await callModelWithTimeout(REASONQA_OPUS, p8.systemPrompt, [{ role: 'user', content: p8.userMessage }], 0.7, `pass8:${nodeId}`, OPUS_TIMEOUT_MS);
    logUsage(r8.usage, 'reasonqa:pass8', userId);
    const parsed = parseJsonResponse(r8.text) as Record<string, unknown>;
    perturbations.push({
      proposition: nodeId,
      alternativeSynthesis: (parsed.alternativeSynthesis as string) || '',
      changesRequired: (parsed.changesRequired as string[]) || [],
      coherenceImpact: (parsed.coherenceImpact as 'minimal' | 'moderate' | 'fundamental') || 'minimal',
      isFascinationThreshold: !!parsed.isFascinationThreshold,
    });
  }
  const pass8: Pass8Output = { perturbations };
  await updateAnalysis(analysisId, { pass8_output: pass8 });
  console.log(`  → ${perturbations.length} perturbations, ${perturbations.filter(p => p.isFascinationThreshold).length} fascination`);

  // Pass 9
  console.log('  Pass 9: mapping...');
  const p9 = buildPass9Prompt(pass1, pass6, pass7, pass8);
  const r9 = await callModelWithTimeout(REASONQA_OPUS, p9.systemPrompt, [{ role: 'user', content: p9.userMessage }], 0.2, 'pass9', OPUS_TIMEOUT_MS);
  logUsage(r9.usage, 'reasonqa:pass9', userId);
  const pass9: Pass9Output = parseJsonResponse(r9.text) as Pass9Output;
  await updateAnalysis(analysisId, { pass9_output: pass9, dialectical: true, status: 'complete' });

  const critNodes = (pass9.scores || []).filter(s => s.criticality > 0.7);
  console.log(`  → ${pass9.scores?.length} scored, ${critNodes.length} high-criticality, ${pass7.loadBearingNodes?.length} load-bearing`);
  console.log(`  Summary: ${pass9.summary?.substring(0, 200)}`);
}

async function main() {
  for (const c of CASES) {
    if (!existsSync(c.framework)) { console.log(`SKIP ${c.name}: framework not found at ${c.framework}`); continue; }

    const { data } = await sb.from('reasonqa_analyses')
      .select('*').ilike('title', `%${c.pattern}%`)
      .eq('status', 'complete').not('pass4_output', 'is', null)
      .order('created_at', { ascending: false }).limit(1).single();

    if (!data) { console.log(`SKIP ${c.name}: no analysis found`); continue; }

    const framework = loadFramework(c.framework);
    await runDialecticalWithFramework(
      c.name, data.id,
      data.pass1_output as Pass1Output,
      data.pass3_output as Pass3Output,
      data.pass4_output as Pass4Output,
      data.user_id, framework,
    );
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log('All dialectical runs complete');
  console.log(`${'═'.repeat(60)}`);
}

main().catch(err => { console.error(err); process.exit(1); });
