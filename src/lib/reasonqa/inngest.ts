// Inngest client + functions for ReasonQA background pipeline.

import { Inngest } from 'inngest';
import { getSupabaseAdmin } from '@/lib/supabase';
import { callModelWithTimeout, parseJsonResponse, OPUS_TIMEOUT_MS } from './pipeline-utils';
import { REASONQA_SONNET, REASONQA_OPUS } from './models';
import { buildPass1Prompt } from './prompts/pass1';
import { buildPass2Prompt } from './prompts/pass2';
import { buildPass3Prompt } from './prompts/pass3';
import { buildQuickPrompt } from './prompts/quick';
import { computeDAGMetrics } from './metrics';
import { extractCitations } from './corpus/citation-parser';
import { fetchAllSources, assembleSourceCorpus } from './corpus/fetcher';
import { retrieveInterpretiveContext, formatInterpretiveContext } from './corpus/interpretive/assembler';
import { logUsage } from '@/lib/usage';
import type { Pass1Output, Pass2Output, Pass3Output, PassStats, SourceReference, DAGMetrics } from './types';

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

    // Step 3: Pass 3
    await step.run('pass3', async () => {
      console.log(`[reasonqa:inngest] Pass 3 for ${analysisId}`);
      const p3 = buildPass3Prompt(documentText, pass1, phase2.pass2, phase2.metrics, phase2.corpus || undefined);
      const start = Date.now();
      const result = await callModelWithTimeout(REASONQA_OPUS, p3.systemPrompt, [{ role: 'user', content: p3.userMessage }], 0.2, 'pass3', OPUS_TIMEOUT_MS);
      logUsage(result.usage, 'reasonqa:pass3', userId);
      const pass3: Pass3Output = parseJsonResponse(result.text) as Pass3Output;
      if (!pass3.assessment) throw new Error('Pass 3: no assessment');
      const { data: cur } = await getSupabaseAdmin().from('reasonqa_analyses').select('pass_stats').eq('id', analysisId).single();
      const prev = (cur?.pass_stats || {}) as PassStats;
      await updateAnalysis(analysisId, {
        status: 'complete', pass3_output: pass3,
        pass_stats: { ...prev, pass3: { durationMs: Date.now() - start, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, model: REASONQA_OPUS.model } },
        completed_at: new Date().toISOString(), doc_text: '[deleted after processing]',
      });
      console.log(`[reasonqa:inngest] Complete: ${pass3.assessment.quality}`);
    });
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

    await step.run('pass3', async () => {
      const p3 = buildPass3Prompt(documentText, pass1, pass2, metrics, corpus || undefined);
      const start = Date.now();
      const result = await callModelWithTimeout(REASONQA_OPUS, p3.systemPrompt, [{ role: 'user', content: p3.userMessage }], 0.2, 'reverify:pass3', OPUS_TIMEOUT_MS);
      logUsage(result.usage, 'reasonqa:reverify', userId);
      const pass3: Pass3Output = parseJsonResponse(result.text) as Pass3Output;
      if (!pass3.assessment) throw new Error('Pass 3: no assessment');
      await updateAnalysis(analysisId, {
        status: 'complete', pass3_output: pass3,
        pass_stats: { pass3: { durationMs: Date.now() - start, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, model: REASONQA_OPUS.model } },
        completed_at: new Date().toISOString(), doc_text: '[deleted after processing]',
      });
    });
  },
);

export const functions = [analyseDocument, reverifyDocument];
