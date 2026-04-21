// Inngest client + functions for ReasonQA background pipeline.

import { Inngest } from 'inngest';
import { getSupabaseAdmin } from '@/lib/supabase';
import { callModelWithTimeout, parseJsonResponse, OPUS_TIMEOUT_MS } from './pipeline-utils';
import { REASONQA_SONNET, REASONQA_OPUS } from './models';
import { buildPass1Prompt } from './prompts/pass1';
import { buildPass2Prompt } from './prompts/pass2';
import { buildPass3Prompt } from './prompts/pass3';
import { buildPass4Prompt } from './prompts/pass4';
import { buildPass5Prompt } from './prompts/pass5';
import { buildPass6Prompt } from './prompts/pass6';
import { buildPass7Prompt } from './prompts/pass7';
import { buildPass8Prompt } from './prompts/pass8';
import { buildPass9Prompt } from './prompts/pass9';
import { buildQuickPrompt } from './prompts/quick';
import { computeDAGMetrics } from './metrics';
import { extractCitations } from './corpus/citation-parser';
import { fetchAllSources, assembleSourceCorpus } from './corpus/fetcher';
import { retrieveInterpretiveContext, formatInterpretiveContext } from './corpus/interpretive/assembler';
import { logUsage } from '@/lib/usage';
import type { Pass1Output, Pass2Output, Pass3Output, Pass4Output, Pass5Output, Pass6Output, Pass7Output, Pass8Output, Pass9Output, PassStats, SourceReference, DAGMetrics, ClaimNode } from './types';
import { encryptText, decryptText } from './encryption';
import { splitIntoParagraphs, diffParagraphs, computeTextSimilarity } from './diff';
import {
  mapChangesToNodes, buildIncrementalPass1Prompt, mergePass1,
  buildIncrementalPass2Prompt, mergePass2,
  buildIncrementalPass3Prompt, mergePass3, computeIssueDelta,
} from './incremental';

export const inngest = new Inngest({ id: 'reasonqa' });

function updateAnalysis(id: string, fields: Record<string, unknown>) {
  return getSupabaseAdmin().from('reasonqa_analyses').update(fields).eq('id', id);
}

export const analyseDocument = inngest.createFunction(
  {
    id: 'reasonqa-analyse',
    retries: 1,
    triggers: [{ event: 'reasonqa/analyse' }],
  },
  async ({ event, step }) => {
    const { analysisId, userId, mode } = event.data as {
      analysisId: string; userId: string; mode: string;
    };

    const { data: analysis } = await getSupabaseAdmin()
      .from('reasonqa_analyses').select('doc_text').eq('id', analysisId).single();
    if (!analysis?.doc_text) {
      await updateAnalysis(analysisId, { status: 'error', error_message: 'Document text not found' });
      return;
    }
    const documentText = analysis.doc_text as string;

    if (mode === 'quick') {
      await step.run('quick-analysis', async () => {
        await updateAnalysis(analysisId, { status: 'pass1' });
        const { systemPrompt, userMessage } = buildQuickPrompt(documentText);
        const result = await callModelWithTimeout(REASONQA_SONNET, systemPrompt, [{ role: 'user', content: userMessage }], 0.2, 'quick');
        logUsage(result.usage, 'reasonqa:quick', userId);
        const parsed = parseJsonResponse(result.text) as Record<string, unknown>;
        await updateAnalysis(analysisId, {
          status: 'complete',
          title: (parsed.documentTitle as string) || 'Untitled',
          pass1_output: { documentTitle: parsed.documentTitle || 'Untitled', documentType: parsed.documentType || 'other', nodes: parsed.nodes || [] },
          pass2_output: { edges: [], structuralIssues: parsed.issues || [] },
          pass3_output: { verifications: [], chainAssessments: [], assessment: parsed.assessment || { quality: 'MARGINAL', totalVerified: 0, totalPartial: 0, totalFailed: 0, totalUngrounded: 0, correctionsNeeded: [], summary: '' } },
          metrics_output: { totalNodes: 0, nodesByType: { F: 0, M: 0, V: 0, P: 0 }, totalEdges: 0, edgesByType: { S: 0, W: 0, J: 0, E: 0 }, reasoningPercent: 0, elaborationPercent: 0, maxChainDepth: 0, convergencePoints: [], orphanNodes: [], prescriptionReachabilityPercent: 0 },
          completed_at: new Date().toISOString(),
          doc_text: '[deleted after processing]',
        });
      });
      return;
    }

    // Step 1: Pass 1
    const pass1 = await step.run('pass1', async () => {
      await updateAnalysis(analysisId, { status: 'pass1' });
      console.log(`[reasonqa:inngest] Pass 1 for ${analysisId}`);
      const p1 = buildPass1Prompt(documentText);
      const start = Date.now();
      const result = await callModelWithTimeout(REASONQA_SONNET, p1.systemPrompt, [{ role: 'user', content: p1.userMessage }], 0.2, 'pass1');
      logUsage(result.usage, 'reasonqa:pass1', userId);
      const parsed: Pass1Output = parseJsonResponse(result.text) as Pass1Output;
      if (!parsed.nodes?.length) throw new Error('Pass 1: no nodes');
      await updateAnalysis(analysisId, {
        status: 'pass2', pass1_output: parsed, title: parsed.documentTitle || null,
        pass_stats: { pass1: { durationMs: Date.now() - start, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, model: REASONQA_SONNET.model } },
      });
      console.log(`[reasonqa:inngest] Pass 1 done: ${parsed.nodes.length} nodes`);
      return parsed;
    });

    // Step 2: Pass 2 + corpus + interpretive
    const phase2 = await step.run('pass2-corpus', async () => {
      console.log(`[reasonqa:inngest] Pass 2 + corpus for ${analysisId}`);
      const citations = extractCitations(pass1.nodes);
      const start = Date.now();
      const [pass2Result, fetchedSources, interpretiveCtx] = await Promise.all([
        (async () => {
          const p2 = buildPass2Prompt(documentText, pass1);
          return callModelWithTimeout(REASONQA_SONNET, p2.systemPrompt, [{ role: 'user', content: p2.userMessage }], 0.2, 'pass2');
        })(),
        citations.length > 0 ? fetchAllSources(citations) : Promise.resolve([]),
        retrieveInterpretiveContext(pass1.nodes, [], userId, documentText)
          .catch(() => ({ authorities: [], janusFacedCount: 0, totalCitingCases: 0, totalClassifications: 0 })),
      ]);
      logUsage(pass2Result.usage, 'reasonqa:pass2', userId);
      const pass2: Pass2Output = parseJsonResponse(pass2Result.text) as Pass2Output;
      if (!pass2.edges) throw new Error('Pass 2: no edges');

      // Validate edges — drop any referencing non-existent node IDs
      const nodeIds = new Set(pass1.nodes.map(n => n.id));
      const validEdges = pass2.edges.filter(e => nodeIds.has(e.fromId) && nodeIds.has(e.toId));
      const invalidCount = pass2.edges.length - validEdges.length;
      if (invalidCount > 0) {
        console.warn(`[reasonqa:inngest] ${invalidCount} invalid edges dropped (referenced non-existent nodes)`);
        pass2.edges = validEdges;
      }

      const metrics = computeDAGMetrics(pass1.nodes, pass2.edges);
      const sourceCorpus = assembleSourceCorpus(fetchedSources);
      const interpretiveText = formatInterpretiveContext(interpretiveCtx);
      const fullCorpus = [sourceCorpus, interpretiveText].filter(Boolean).join('\n\n');
      const sourceMap = new Map<string, SourceReference>();
      let rc = 1;
      for (const fs of fetchedSources) {
        if (!sourceMap.has(fs.citation.raw)) {
          sourceMap.set(fs.citation.raw, { refId: `S${rc++}`, citationRaw: fs.citation.raw, citationType: fs.citation.type, found: fs.found, url: fs.url, nodeIds: [], textPreview: fs.text?.substring(0, 500) });
        }
      }
      const { data: cur } = await getSupabaseAdmin().from('reasonqa_analyses').select('pass_stats').eq('id', analysisId).single();
      const prev = (cur?.pass_stats || {}) as PassStats;
      await updateAnalysis(analysisId, {
        status: 'pass3', pass2_output: pass2, metrics_output: metrics,
        sources: [...sourceMap.values()],
        pass_stats: { ...prev, pass2: { durationMs: Date.now() - start, inputTokens: pass2Result.usage.inputTokens, outputTokens: pass2Result.usage.outputTokens, model: REASONQA_SONNET.model }, ...(citations.length > 0 ? { corpus: { durationMs: Date.now() - start, fetched: fetchedSources.length, found: fetchedSources.filter(s => s.found).length } } : {}) },
      });
      console.log(`[reasonqa:inngest] Pass 2 done: ${pass2.edges.length} edges`);
      return { pass2, metrics, corpus: fullCorpus };
    });

    // Step 3: Pass 3 (Verification)
    const pass3 = await step.run('pass3', async () => {
      console.log(`[reasonqa:inngest] Pass 3 for ${analysisId}`);
      const p3 = buildPass3Prompt(documentText, pass1, phase2.pass2, phase2.metrics, phase2.corpus || undefined);
      const start = Date.now();
      const result = await callModelWithTimeout(REASONQA_OPUS, p3.systemPrompt, [{ role: 'user', content: p3.userMessage }], 0.2, 'pass3', OPUS_TIMEOUT_MS);
      logUsage(result.usage, 'reasonqa:pass3', userId);
      const parsed: Pass3Output = parseJsonResponse(result.text) as Pass3Output;
      if (!parsed.assessment) throw new Error('Pass 3: no assessment');
      const { data: cur } = await getSupabaseAdmin().from('reasonqa_analyses').select('pass_stats').eq('id', analysisId).single();
      const prev = (cur?.pass_stats || {}) as PassStats;
      await updateAnalysis(analysisId, {
        status: 'pass3', pass3_output: parsed,
        pass_stats: { ...prev, pass3: { durationMs: Date.now() - start, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, model: REASONQA_OPUS.model } },
      });
      console.log(`[reasonqa:inngest] Pass 3 done: ${parsed.assessment.quality}`);
      return parsed;
    });

    // Step 4: Argument Reconstruction
    const pass4 = await step.run('pass4-reconstruct', async () => {
      console.log(`[reasonqa:inngest] Pass 4 (Argument Reconstruction) for ${analysisId}`);
      const p4 = buildPass4Prompt(pass1, phase2.pass2, pass3, phase2.metrics);
      const start = Date.now();
      const result = await callModelWithTimeout(REASONQA_OPUS, p4.systemPrompt, [{ role: 'user', content: p4.userMessage }], 0.2, 'pass4', OPUS_TIMEOUT_MS);
      logUsage(result.usage, 'reasonqa:pass4', userId);
      const pass4: Pass4Output = parseJsonResponse(result.text) as Pass4Output;

      const { data: cur } = await getSupabaseAdmin().from('reasonqa_analyses').select('pass_stats').eq('id', analysisId).single();
      const prev = (cur?.pass_stats || {}) as PassStats;

      await updateAnalysis(analysisId, {
        pass4_output: pass4,
        pass_stats: { ...prev, pass4: { durationMs: Date.now() - start, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, model: REASONQA_OPUS.model } },
      });
      console.log(`[reasonqa:inngest] Pass 4 done: ${pass4.qualityAdjustment?.adjustedRating}, ${pass4.suppressionCount} suppressed`);
      return pass4;
    });

    // Steps 5-9: Dialectical synthesis (optional)
    const isDialectical = (event.data as Record<string, unknown>).dialectical === true;

    if (isDialectical) {
      // Step 5: Scheme classification
      const pass5 = await step.run('pass5-schemes', async () => {
        console.log(`[reasonqa:inngest] Pass 5 (schemes) for ${analysisId}`);
        const p5 = buildPass5Prompt(pass1);
        const result = await callModelWithTimeout(REASONQA_SONNET, p5.systemPrompt, [{ role: 'user', content: p5.userMessage }], 0.2, 'pass5');
        logUsage(result.usage, 'reasonqa:pass5', userId);
        const parsed: Pass5Output = parseJsonResponse(result.text) as Pass5Output;
        await updateAnalysis(analysisId, { pass5_output: parsed });
        console.log(`[reasonqa:inngest] Pass 5 done: ${parsed.nodeSchemes?.length} schemes classified`);
        return parsed;
      });

      // Step 6: Counter-argument (Document B)
      const pass6 = await step.run('pass6-counter', async () => {
        console.log(`[reasonqa:inngest] Pass 6 (counter-argument) for ${analysisId}`);
        // Get interpretive context from stored corpus if available
        const { data: stored } = await getSupabaseAdmin().from('reasonqa_analyses')
          .select('pass3_output').eq('id', analysisId).single();
        const summary = (stored?.pass3_output as Pass3Output)?.assessment?.summary || '';

        const p6 = buildPass6Prompt(pass1, pass4, pass5.nodeSchemes || [], '', summary);
        const result = await callModelWithTimeout(REASONQA_OPUS, p6.systemPrompt, [{ role: 'user', content: p6.userMessage }], 0.9, 'pass6', OPUS_TIMEOUT_MS);
        logUsage(result.usage, 'reasonqa:pass6', userId);
        const parsed: Pass6Output = parseJsonResponse(result.text) as Pass6Output;
        await updateAnalysis(analysisId, { pass6_output: parsed });
        console.log(`[reasonqa:inngest] Pass 6 done: ${parsed.counterPositions?.length} counter-positions`);
        return parsed;
      });

      // Step 7: Objective synthesis (Document C)
      const pass7 = await step.run('pass7-synthesis', async () => {
        console.log(`[reasonqa:inngest] Pass 7 (synthesis) for ${analysisId}`);
        const { data: stored } = await getSupabaseAdmin().from('reasonqa_analyses')
          .select('pass3_output').eq('id', analysisId).single();
        const summary = (stored?.pass3_output as Pass3Output)?.assessment?.summary || '';

        const p7 = buildPass7Prompt(pass1, pass6, summary);
        const result = await callModelWithTimeout(REASONQA_OPUS, p7.systemPrompt, [{ role: 'user', content: p7.userMessage }], 0.2, 'pass7', OPUS_TIMEOUT_MS);
        logUsage(result.usage, 'reasonqa:pass7', userId);
        const parsed: Pass7Output = parseJsonResponse(result.text) as Pass7Output;
        await updateAnalysis(analysisId, { pass7_output: parsed });
        console.log(`[reasonqa:inngest] Pass 7 done: accepted=${parsed.acceptedFromA?.length}, rejected=${parsed.rejectedFromA?.length}, contested=${parsed.contested?.length}`);
        return parsed;
      });

      // Step 8: Self-reflection (perturbation testing)
      const pass8 = await step.run('pass8-reflection', async () => {
        console.log(`[reasonqa:inngest] Pass 8 (reflection) for ${analysisId}`);
        const toTest = (pass7.rejectedFromA || [])
          .filter(nodeId => {
            const ca = pass4.criticalityAssessments?.find(a => a.issueIndex.toString() === nodeId || pass1.nodes.findIndex(n => n.id === nodeId) === a.issueIndex);
            return !ca || ca.criticality !== 'CONTEXTUAL';
          })
          .slice(0, 5);

        const perturbations = [];
        for (const nodeId of toTest) {
          const node = pass1.nodes.find(n => n.id === nodeId);
          if (!node) continue;
          const p8 = buildPass8Prompt(pass7, nodeId, node.text);
          const result = await callModelWithTimeout(REASONQA_OPUS, p8.systemPrompt, [{ role: 'user', content: p8.userMessage }], 0.7, `pass8:${nodeId}`, OPUS_TIMEOUT_MS);
          logUsage(result.usage, 'reasonqa:pass8', userId);
          const parsed = parseJsonResponse(result.text) as Record<string, unknown>;
          perturbations.push({
            proposition: nodeId,
            alternativeSynthesis: (parsed.alternativeSynthesis as string) || '',
            changesRequired: (parsed.changesRequired as string[]) || [],
            coherenceImpact: (parsed.coherenceImpact as 'minimal' | 'moderate' | 'fundamental') || 'minimal',
            isFascinationThreshold: !!parsed.isFascinationThreshold,
          });
        }

        const pass8Output: Pass8Output = { perturbations };
        await updateAnalysis(analysisId, { pass8_output: pass8Output });
        const fascCount = perturbations.filter(p => p.isFascinationThreshold).length;
        console.log(`[reasonqa:inngest] Pass 8 done: ${perturbations.length} perturbations, ${fascCount} fascination thresholds`);
        return pass8Output;
      });

      // Step 9: Final criticality mapping
      await step.run('pass9-mapping', async () => {
        console.log(`[reasonqa:inngest] Pass 9 (mapping) for ${analysisId}`);
        const p9 = buildPass9Prompt(pass1, pass6, pass7, pass8);
        const result = await callModelWithTimeout(REASONQA_OPUS, p9.systemPrompt, [{ role: 'user', content: p9.userMessage }], 0.2, 'pass9', OPUS_TIMEOUT_MS);
        logUsage(result.usage, 'reasonqa:pass9', userId);
        const parsed: Pass9Output = parseJsonResponse(result.text) as Pass9Output;
        await updateAnalysis(analysisId, {
          pass9_output: parsed,
          completed_at: new Date().toISOString(),
          doc_text: '[deleted after processing]',
        });
        console.log(`[reasonqa:inngest] Dialectical complete: ${parsed.scores?.length} nodes scored`);
      });
    } else {
      // Non-dialectical: encrypt doc text for incremental re-analysis, then finalize
      await step.run('finalize', async () => {
        // Encrypt original text for 30-day retention (enables incremental re-analysis)
        try {
          const { ciphertext, iv } = encryptText(documentText);
          await updateAnalysis(analysisId, {
            doc_text_encrypted: ciphertext,
            doc_text_enc_iv: iv,
            doc_text_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          });
        } catch (err) {
          console.warn('[reasonqa:inngest] Doc encryption skipped:', err instanceof Error ? err.message : err);
        }
        await updateAnalysis(analysisId, {
          completed_at: new Date().toISOString(),
          doc_text: '[deleted after processing]',
        });
        console.log(`[reasonqa:inngest] Complete (non-dialectical)`);
      });
    }
  },
);

export const reverifyDocument = inngest.createFunction(
  {
    id: 'reasonqa-reverify',
    retries: 1,
    triggers: [{ event: 'reasonqa/reverify' }],
  },
  async ({ event, step }) => {
    const { analysisId, userId } = event.data as { analysisId: string; userId: string };
    const { data } = await getSupabaseAdmin().from('reasonqa_analyses')
      .select('doc_text, pass1_output, pass2_output, metrics_output').eq('id', analysisId).single();
    if (!data?.pass1_output || !data?.pass2_output) {
      await updateAnalysis(analysisId, { status: 'error', error_message: 'Missing pass data' });
      return;
    }
    const pass1 = data.pass1_output as Pass1Output;
    const pass2 = data.pass2_output as Pass2Output;
    const metrics = (data.metrics_output || computeDAGMetrics(pass1.nodes, pass2.edges)) as DAGMetrics;
    const documentText = data.doc_text as string;

    const corpus = await step.run('corpus', async () => {
      const citations = extractCitations(pass1.nodes);
      const [fetched, interp] = await Promise.all([
        citations.length > 0 ? fetchAllSources(citations) : Promise.resolve([]),
        retrieveInterpretiveContext(pass1.nodes, [], userId, documentText)
          .catch(() => ({ authorities: [], janusFacedCount: 0, totalCitingCases: 0, totalClassifications: 0 })),
      ]);
      return [assembleSourceCorpus(fetched), formatInterpretiveContext(interp)].filter(Boolean).join('\n\n');
    });

    const pass3 = await step.run('pass3', async () => {
      const p3 = buildPass3Prompt(documentText, pass1, pass2, metrics, corpus || undefined);
      const start = Date.now();
      const result = await callModelWithTimeout(REASONQA_OPUS, p3.systemPrompt, [{ role: 'user', content: p3.userMessage }], 0.2, 'reverify:pass3', OPUS_TIMEOUT_MS);
      logUsage(result.usage, 'reasonqa:reverify', userId);
      const parsed: Pass3Output = parseJsonResponse(result.text) as Pass3Output;
      if (!parsed.assessment) throw new Error('Pass 3: no assessment');
      await updateAnalysis(analysisId, {
        status: 'pass3', pass3_output: parsed,
        pass_stats: { pass3: { durationMs: Date.now() - start, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, model: REASONQA_OPUS.model } },
      });
      return parsed;
    });

    // Pass 4: Argument Reconstruction
    await step.run('pass4-reconstruct', async () => {
      console.log(`[reasonqa:inngest] Pass 4 (reverify) for ${analysisId}`);
      const p4 = buildPass4Prompt(pass1, pass2, pass3, metrics);
      const start = Date.now();
      const result = await callModelWithTimeout(REASONQA_OPUS, p4.systemPrompt, [{ role: 'user', content: p4.userMessage }], 0.2, 'reverify:pass4', OPUS_TIMEOUT_MS);
      logUsage(result.usage, 'reasonqa:pass4', userId);
      const pass4: Pass4Output = parseJsonResponse(result.text) as Pass4Output;
      await updateAnalysis(analysisId, {
        status: 'complete', pass4_output: pass4,
        completed_at: new Date().toISOString(), doc_text: '[deleted after processing]',
      });
      console.log(`[reasonqa:inngest] Reverify complete: ${pass4.qualityAdjustment?.adjustedRating}, ${pass4.suppressionCount} suppressed`);
    });
  },
);

// Standalone dialectical analysis — runs Passes 5-9 on existing Pass 1-4 data
export const runDialectical = inngest.createFunction(
  {
    id: 'reasonqa-dialectical',
    retries: 1,
    triggers: [{ event: 'reasonqa/dialectical' }],
  },
  async ({ event, step }) => {
    const { analysisId, userId } = event.data as { analysisId: string; userId: string };
    const { data } = await getSupabaseAdmin().from('reasonqa_analyses')
      .select('doc_text, pass1_output, pass2_output, pass3_output, pass4_output, metrics_output')
      .eq('id', analysisId).single();

    if (!data?.pass1_output || !data?.pass4_output) {
      await updateAnalysis(analysisId, { status: 'error', error_message: 'Missing pass 1-4 data for dialectical' });
      return;
    }

    const pass1 = data.pass1_output as Pass1Output;
    const pass3 = data.pass3_output as Pass3Output;
    const pass4 = data.pass4_output as Pass4Output;
    const metrics = data.metrics_output as DAGMetrics;

    // Pass 5: Scheme classification
    const pass5 = await step.run('pass5-schemes', async () => {
      await updateAnalysis(analysisId, { status: "pass5" });
      console.log(`[reasonqa:inngest] Dialectical Pass 5 for ${analysisId}`);
      const p5 = buildPass5Prompt(pass1);
      const result = await callModelWithTimeout(REASONQA_SONNET, p5.systemPrompt, [{ role: 'user', content: p5.userMessage }], 0.2, 'pass5');
      logUsage(result.usage, 'reasonqa:pass5', userId);
      const parsed: Pass5Output = parseJsonResponse(result.text) as Pass5Output;
      await updateAnalysis(analysisId, { pass5_output: parsed });
      console.log(`[reasonqa:inngest] Pass 5 done: ${parsed.nodeSchemes?.length} schemes`);
      return parsed;
    });

    // Pass 6: Counter-argument
    const pass6 = await step.run('pass6-counter', async () => {
      await updateAnalysis(analysisId, { status: "pass6" });
      console.log(`[reasonqa:inngest] Dialectical Pass 6 for ${analysisId}`);
      const summary = pass3?.assessment?.summary || '';
      const p6 = buildPass6Prompt(pass1, pass4, pass5.nodeSchemes || [], '', summary);
      const result = await callModelWithTimeout(REASONQA_OPUS, p6.systemPrompt, [{ role: 'user', content: p6.userMessage }], 0.9, 'pass6', OPUS_TIMEOUT_MS);
      logUsage(result.usage, 'reasonqa:pass6', userId);
      const parsed: Pass6Output = parseJsonResponse(result.text) as Pass6Output;
      await updateAnalysis(analysisId, { pass6_output: parsed });
      console.log(`[reasonqa:inngest] Pass 6 done: ${parsed.counterPositions?.length} counters`);
      return parsed;
    });

    // Pass 7: Synthesis
    const pass7 = await step.run('pass7-synthesis', async () => {
      await updateAnalysis(analysisId, { status: "pass7" });
      console.log(`[reasonqa:inngest] Dialectical Pass 7 for ${analysisId}`);
      const summary = pass3?.assessment?.summary || '';
      const p7 = buildPass7Prompt(pass1, pass6, summary);
      const result = await callModelWithTimeout(REASONQA_OPUS, p7.systemPrompt, [{ role: 'user', content: p7.userMessage }], 0.2, 'pass7', OPUS_TIMEOUT_MS);
      logUsage(result.usage, 'reasonqa:pass7', userId);
      const parsed: Pass7Output = parseJsonResponse(result.text) as Pass7Output;
      await updateAnalysis(analysisId, { pass7_output: parsed });
      console.log(`[reasonqa:inngest] Pass 7 done: accepted=${parsed.acceptedFromA?.length}, rejected=${parsed.rejectedFromA?.length}`);
      return parsed;
    });

    // Pass 8: Self-reflection
    const pass8 = await step.run('pass8-reflection', async () => {
      await updateAnalysis(analysisId, { status: "pass8" });
      console.log(`[reasonqa:inngest] Dialectical Pass 8 for ${analysisId}`);
      const toTest = (pass7.rejectedFromA || []).slice(0, 5);
      const perturbations = [];
      for (const nodeId of toTest) {
        const node = pass1.nodes.find(n => n.id === nodeId);
        if (!node) continue;
        const p8 = buildPass8Prompt(pass7, nodeId, node.text);
        const result = await callModelWithTimeout(REASONQA_OPUS, p8.systemPrompt, [{ role: 'user', content: p8.userMessage }], 0.7, `pass8:${nodeId}`, OPUS_TIMEOUT_MS);
        logUsage(result.usage, 'reasonqa:pass8', userId);
        const parsed = parseJsonResponse(result.text) as Record<string, unknown>;
        perturbations.push({
          proposition: nodeId,
          alternativeSynthesis: (parsed.alternativeSynthesis as string) || '',
          changesRequired: (parsed.changesRequired as string[]) || [],
          coherenceImpact: (parsed.coherenceImpact as 'minimal' | 'moderate' | 'fundamental') || 'minimal',
          isFascinationThreshold: !!parsed.isFascinationThreshold,
        });
      }
      const pass8Output: Pass8Output = { perturbations };
      await updateAnalysis(analysisId, { pass8_output: pass8Output });
      console.log(`[reasonqa:inngest] Pass 8 done: ${perturbations.length} perturbations`);
      return pass8Output;
    });

    // Pass 9: Final mapping
    await step.run('pass9-mapping', async () => {
      await updateAnalysis(analysisId, { status: "pass9" });
      console.log(`[reasonqa:inngest] Dialectical Pass 9 for ${analysisId}`);
      const p9 = buildPass9Prompt(pass1, pass6, pass7, pass8);
      const result = await callModelWithTimeout(REASONQA_OPUS, p9.systemPrompt, [{ role: 'user', content: p9.userMessage }], 0.2, 'pass9', OPUS_TIMEOUT_MS);
      logUsage(result.usage, 'reasonqa:pass9', userId);
      const parsed: Pass9Output = parseJsonResponse(result.text) as Pass9Output;
      await updateAnalysis(analysisId, { pass9_output: parsed, status: 'complete' });
      console.log(`[reasonqa:inngest] Dialectical complete: ${parsed.scores?.length} nodes scored`);
    });
  },
);

// ── Incremental Re-Analysis ──────────────────────────────────────

export const incrementalAnalysis = inngest.createFunction(
  {
    id: 'reasonqa-incremental',
    retries: 1,
    triggers: [{ event: 'reasonqa/incremental' }],
  },
  async ({ event, step }) => {
    const { analysisId, parentAnalysisId, userId } = event.data as {
      analysisId: string; parentAnalysisId: string; userId: string;
    };

    // Load parent analysis + decrypt original doc text
    const { data: parent } = await getSupabaseAdmin().from('reasonqa_analyses')
      .select('doc_text_encrypted, doc_text_enc_iv, pass1_output, pass2_output, pass3_output, pass4_output, metrics_output, sources, title')
      .eq('id', parentAnalysisId).single();

    if (!parent?.pass1_output || !parent?.doc_text_encrypted) {
      await updateAnalysis(analysisId, { status: 'error', error_message: 'Parent analysis missing data or expired doc text' });
      return;
    }

    const parentDocText = decryptText(
      Buffer.from(parent.doc_text_encrypted),
      Buffer.from(parent.doc_text_enc_iv),
    );
    const parentPass1 = parent.pass1_output as Pass1Output;
    const parentPass2 = parent.pass2_output as Pass2Output;
    const parentPass3 = parent.pass3_output as Pass3Output;
    const parentMetrics = parent.metrics_output as DAGMetrics;

    // Load new doc text
    const { data: newAnalysis } = await getSupabaseAdmin().from('reasonqa_analyses')
      .select('doc_text').eq('id', analysisId).single();
    if (!newAnalysis?.doc_text) {
      await updateAnalysis(analysisId, { status: 'error', error_message: 'New document text not found' });
      return;
    }
    const newDocText = newAnalysis.doc_text as string;

    // Step 1: Paragraph diff
    const { diff, affected } = await step.run('diff', async () => {
      await updateAnalysis(analysisId, { status: 'pass1' });
      console.log(`[reasonqa:incremental] Diffing documents for ${analysisId}`);

      const oldParas = splitIntoParagraphs(parentDocText);
      const newParas = splitIntoParagraphs(newDocText);
      const diff = diffParagraphs(oldParas, newParas);

      console.log(`[reasonqa:incremental] Diff: ${diff.unchanged.length} unchanged, ${diff.modified.length} modified, ${diff.added.length} added, ${diff.removed.length} removed, ratio=${diff.changeRatio.toFixed(2)}`);

      if (diff.changeRatio > 0.6) {
        console.log('[reasonqa:incremental] Change ratio > 0.6 — falling back to full re-analysis');
        // Trigger a full analysis instead
        await updateAnalysis(analysisId, { analysis_type: 'full' });
        await inngest.send({ name: 'reasonqa/analyse', data: { analysisId, userId, mode: 'full' } });
        return { diff, affected: null, fallback: true };
      }

      const affected = mapChangesToNodes(parentPass1.nodes, parentPass2.edges, diff);
      console.log(`[reasonqa:incremental] Affected: ${affected.affectedNodeIds.length} nodes, unchanged: ${affected.unchangedNodeIds.length}, removed: ${affected.removedNodeIds.length}`);

      return { diff, affected, fallback: false };
    });

    if (!affected) return; // Fell back to full analysis

    const unchangedNodes = parentPass1.nodes.filter(n => affected.unchangedNodeIds.includes(n.id));
    const affectedParaIndices = [
      ...diff.modified.map(m => m[1]),  // new paragraph indices for modified
      ...diff.added,
    ];

    // Step 2: Incremental Pass 1
    const { mergedNodes, nodeIdMapping } = await step.run('incremental-pass1', async () => {
      console.log(`[reasonqa:incremental] Pass 1 (incremental) for ${analysisId}`);
      const prompt = buildIncrementalPass1Prompt(newDocText, unchangedNodes, affectedParaIndices);
      const result = await callModelWithTimeout(REASONQA_SONNET, prompt.systemPrompt, [{ role: 'user', content: prompt.userMessage }], 0.2, 'incr:pass1');
      logUsage(result.usage, 'reasonqa:incr-pass1', userId);
      const parsed = parseJsonResponse(result.text) as { newNodes: ClaimNode[]; modifiedNodeIds: string[] };
      const merged = mergePass1(
        parentPass1.nodes,
        affected.removedNodeIds,
        parsed.newNodes || [],
        parsed.modifiedNodeIds || [],
      );
      console.log(`[reasonqa:incremental] Pass 1: ${merged.mergedNodes.length} total nodes, ${(parsed.newNodes || []).length} new/modified`);
      return merged;
    });

    // Step 3: Incremental Pass 2 + corpus
    const { mergedEdges, mergedPass2, metrics, corpus } = await step.run('incremental-pass2-corpus', async () => {
      await updateAnalysis(analysisId, { status: 'pass2' });
      console.log(`[reasonqa:incremental] Pass 2 + corpus for ${analysisId}`);

      // Build edges
      const prompt = buildIncrementalPass2Prompt(newDocText, mergedNodes, parentPass2.edges, affected.affectedNodeIds);
      const result = await callModelWithTimeout(REASONQA_SONNET, prompt.systemPrompt, [{ role: 'user', content: prompt.userMessage }], 0.2, 'incr:pass2');
      logUsage(result.usage, 'reasonqa:incr-pass2', userId);
      const parsed = parseJsonResponse(result.text) as { edges: Pass2Output['edges']; structuralIssues: Pass2Output['structuralIssues'] };

      const mergedEdges = mergePass2(parentPass2.edges, parsed.edges || [], affected.affectedNodeIds, affected.removedNodeIds);
      const mergedPass2: Pass2Output = {
        edges: mergedEdges,
        structuralIssues: [...parentPass2.structuralIssues.filter(
          si => !si.nodeIds.some(id => affected.affectedNodeIds.includes(id) || affected.removedNodeIds.includes(id))
        ), ...(parsed.structuralIssues || [])],
      };

      const metrics = computeDAGMetrics(mergedNodes, mergedEdges);

      // Fetch corpus for affected citations only
      const affectedCitationNodes = mergedNodes.filter(n => affected.affectedNodeIds.includes(n.id) && n.citationStatus === 'Ext');
      const citations = extractCitations(affectedCitationNodes);
      let corpus = '';
      if (citations.length > 0) {
        const fetched = await fetchAllSources(citations);
        corpus = assembleSourceCorpus(fetched);
      }

      await updateAnalysis(analysisId, { pass1_output: { ...parentPass1, nodes: mergedNodes }, pass2_output: mergedPass2, metrics_output: metrics });

      return { mergedEdges, mergedPass2, metrics, corpus };
    });

    // Step 4: Incremental Pass 3
    const mergedPass3 = await step.run('incremental-pass3', async () => {
      await updateAnalysis(analysisId, { status: 'pass3' });
      console.log(`[reasonqa:incremental] Pass 3 (incremental) for ${analysisId}`);

      const prompt = buildIncrementalPass3Prompt(newDocText, mergedNodes, corpus, affected.affectedNodeIds, parentPass3.verifications);
      const result = await callModelWithTimeout(REASONQA_OPUS, prompt.systemPrompt, [{ role: 'user', content: prompt.userMessage }], 0.2, 'incr:pass3', OPUS_TIMEOUT_MS);
      logUsage(result.usage, 'reasonqa:incr-pass3', userId);
      const parsed = parseJsonResponse(result.text) as { verifications: Pass3Output['verifications'] };

      const merged = mergePass3(parentPass3, parsed.verifications || [], affected.affectedNodeIds, affected.removedNodeIds);
      await updateAnalysis(analysisId, { pass3_output: merged });
      return merged;
    });

    // Step 5: Full Pass 4 on merged data
    await step.run('pass4-reconstruct', async () => {
      console.log(`[reasonqa:incremental] Pass 4 (full) for ${analysisId}`);
      const mergedPass1: Pass1Output = { ...parentPass1, nodes: mergedNodes };
      const p4 = buildPass4Prompt(mergedPass1, mergedPass2, mergedPass3, metrics);
      const result = await callModelWithTimeout(REASONQA_OPUS, p4.systemPrompt, [{ role: 'user', content: p4.userMessage }], 0.2, 'incr:pass4', OPUS_TIMEOUT_MS);
      logUsage(result.usage, 'reasonqa:incr-pass4', userId);
      const pass4: Pass4Output = parseJsonResponse(result.text) as Pass4Output;

      // Compute issue delta
      const parentIssues = [
        ...(parentPass2.structuralIssues || []),
        ...(parentPass3.interpretiveIssues || []),
      ];
      const currentIssues = [
        ...(mergedPass2.structuralIssues || []),
        ...(mergedPass3.interpretiveIssues || []),
      ];
      const issueDelta = computeIssueDelta(parentIssues, currentIssues, nodeIdMapping);

      // Quality change
      const parentQuality = parent.pass4_output
        ? (parent.pass4_output as Pass4Output).qualityAdjustment?.adjustedRating
        : parentPass3.assessment?.quality;
      const newQuality = pass4.qualityAdjustment?.adjustedRating || mergedPass3.assessment?.quality;
      if (parentQuality && newQuality && parentQuality !== newQuality) {
        issueDelta.qualityChange = { from: parentQuality, to: newQuality };
      }

      // Encrypt new doc text
      try {
        const { ciphertext, iv } = encryptText(newDocText);
        await updateAnalysis(analysisId, {
          doc_text_encrypted: ciphertext,
          doc_text_enc_iv: iv,
          doc_text_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        });
      } catch (err) {
        console.warn('[reasonqa:incremental] Doc encryption skipped:', err instanceof Error ? err.message : err);
      }

      const incrementalMeta = {
        parentId: parentAnalysisId,
        diffSummary: {
          paragraphsModified: diff.modified.length,
          paragraphsAdded: diff.added.length,
          paragraphsRemoved: diff.removed.length,
          paragraphsUnchanged: diff.unchanged.length,
          changeRatio: diff.changeRatio,
        },
        affectedNodeIds: affected.affectedNodeIds,
        unchangedNodeIds: affected.unchangedNodeIds,
        newNodeIds: mergedNodes.filter(n => !parentPass1.nodes.some(pn => pn.id === n.id)).map(n => n.id),
        removedNodeIds: affected.removedNodeIds,
        nodeIdMapping,
        issueDelta,
      };

      await updateAnalysis(analysisId, {
        pass4_output: pass4,
        incremental_meta: incrementalMeta,
        status: 'complete',
        completed_at: new Date().toISOString(),
        doc_text: '[deleted after processing]',
      });
      console.log(`[reasonqa:incremental] Complete: ${issueDelta.resolved.length} resolved, ${issueDelta.new.length} new, ${issueDelta.unchanged.length} unchanged`);
    });
  },
);

export const functions = [analyseDocument, reverifyDocument, runDialectical, incrementalAnalysis];
