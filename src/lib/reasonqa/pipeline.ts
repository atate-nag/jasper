// Three-pass analysis pipeline orchestrator.

import { callModelZDR, type ModelResult } from './model-client';
import type { ProviderModelConfig } from '@/lib/config/models';
import { logUsage } from '@/lib/usage';
import { getSupabaseAdmin } from '@/lib/supabase';
import { REASONQA_SONNET, REASONQA_OPUS } from './models';
import { buildPass1Prompt } from './prompts/pass1';
import { buildPass2Prompt } from './prompts/pass2';
import { buildPass3Prompt } from './prompts/pass3';
import { buildQuickPrompt } from './prompts/quick';
import { computeDAGMetrics } from './metrics';
import { extractCitations } from './corpus/citation-parser';
import { fetchAllSources, assembleSourceCorpus } from './corpus/fetcher';
import { retrieveInterpretiveContext, formatInterpretiveContext } from './corpus/interpretive/assembler';
import type { AnalysisMode, DAGMetrics, Pass1Output, Pass2Output, Pass3Output, PassStats, SourceReference } from './types';

const SONNET_TIMEOUT_MS = 240_000; // 4 minutes for Sonnet passes
const OPUS_TIMEOUT_MS = 600_000;   // 10 minutes for Opus (Pass 3 — large input)

async function callModelWithTimeout(
  config: ProviderModelConfig,
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  temperature: number,
  label: string = 'unknown',
  timeoutMs?: number,
): Promise<ModelResult> {
  const timeout = timeoutMs ?? SONNET_TIMEOUT_MS;
  console.log(`[reasonqa] Calling ${config.model} for ${label} (timeout: ${timeout / 1000}s)...`);
  try {
    const result = await Promise.race([
      callModelZDR(config, systemPrompt, messages, temperature),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Model call timed out after ${timeout / 1000}s (${label})`)), timeout),
      ),
    ]);
    console.log(`[reasonqa] ${label} returned: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out`);
    return result;
  } catch (err) {
    console.error(`[reasonqa] ${label} failed:`, err instanceof Error ? err.message : err);
    throw err;
  }
}

function parseJsonResponse(text: string): unknown {
  // Strip markdown fences
  let cleaned = text
    .replace(/^\s*```(?:json)?\s*\n?/i, '')
    .replace(/\n?\s*```\s*$/i, '')
    .trim();

  // Try direct parse first
  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall through to repair
  }

  // Repair common LLM JSON issues:
  // 1. Trailing commas before } or ]
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
  // 2. Unescaped newlines inside string values
  cleaned = cleaned.replace(/(?<=:\s*"[^"]*)\n(?=[^"]*")/g, '\\n');
  // 3. Unescaped control characters
  cleaned = cleaned.replace(/[\x00-\x1f]/g, (ch) => {
    if (ch === '\n' || ch === '\r' || ch === '\t') return ch;
    return '';
  });
  // 4. Single-line // comments (rare but happens)
  cleaned = cleaned.replace(/\/\/[^\n]*/g, '');

  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall through
  }

  // Last resort: extract the outermost { ... } or [ ... ]
  const braceStart = cleaned.indexOf('{');
  const bracketStart = cleaned.indexOf('[');
  let start: number;
  let open: string;
  let close: string;

  if (braceStart === -1 && bracketStart === -1) {
    throw new Error(`No JSON object or array found in LLM response (${cleaned.length} chars)`);
  } else if (bracketStart === -1 || (braceStart !== -1 && braceStart < bracketStart)) {
    start = braceStart;
    open = '{';
    close = '}';
  } else {
    start = bracketStart;
    open = '[';
    close = ']';
  }

  // Find matching closing bracket
  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === open) depth++;
    if (ch === close) { depth--; if (depth === 0) { end = i; break; } }
  }

  if (end === -1) {
    // Truncated response — repair by closing open structures
    console.warn('[reasonqa] JSON truncated — attempting repair');
    const repaired = repairTruncatedJson(cleaned.slice(start));
    return JSON.parse(repaired);
  }

  let extracted = cleaned.slice(start, end + 1);
  extracted = extracted.replace(/,\s*([}\]])/g, '$1');

  return JSON.parse(extracted);
}

/**
 * Repair truncated JSON by closing any open strings, arrays, and objects.
 * The model hit maxTokens and the output was cut mid-JSON.
 */
function repairTruncatedJson(partial: string): string {
  let result = partial;

  // Track nesting to know what needs closing
  const stack: string[] = [];
  let inString = false;
  let escape = false;

  for (let i = 0; i < result.length; i++) {
    const ch = result[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') {
      if (inString) {
        inString = false;
      } else {
        inString = true;
      }
      continue;
    }
    if (inString) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }

  // Close open string
  if (inString) {
    result += '"';
  }

  // Remove any trailing partial key/value (dangling comma, colon, partial key)
  result = result.replace(/,\s*"[^"]*$/, '');  // trailing partial key
  result = result.replace(/,\s*$/, '');          // trailing comma
  result = result.replace(/:\s*$/, ': null');    // trailing colon with no value

  // Close all open brackets/braces in reverse order
  while (stack.length > 0) {
    result += stack.pop();
  }

  // Final cleanup of trailing commas before closers
  result = result.replace(/,\s*([}\]])/g, '$1');

  return result;
}

async function updateAnalysis(
  id: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('reasonqa_analyses')
    .update(fields)
    .eq('id', id);

  if (error) {
    // If the update failed because of an unknown column (migration not run),
    // retry with only the columns that are guaranteed to exist.
    if (error.message.includes('schema cache') || error.message.includes('column')) {
      console.warn(`[reasonqa] DB update failed (${error.message}), retrying with core fields only`);
      const coreFields: Record<string, unknown> = {};
      const CORE_COLUMNS = ['status', 'title', 'pass1_output', 'pass2_output', 'metrics_output', 'pass3_output', 'error_message', 'completed_at', 'doc_type', 'doc_text', 'doc_size_bytes'];
      for (const key of CORE_COLUMNS) {
        if (key in fields) coreFields[key] = fields[key];
      }
      if (Object.keys(coreFields).length > 0) {
        const { error: retryError } = await getSupabaseAdmin()
          .from('reasonqa_analyses')
          .update(coreFields)
          .eq('id', id);
        if (retryError) {
          console.error('[reasonqa] DB retry also failed:', retryError.message);
        } else {
          console.log('[reasonqa] DB retry succeeded with core fields');
        }
      }
    } else {
      console.error('[reasonqa] DB update failed:', error.message);
    }
  }
}

async function logEvent(
  userId: string,
  analysisId: string,
  event: string,
  model?: string,
  inputTokens?: number,
  outputTokens?: number,
): Promise<void> {
  await getSupabaseAdmin().from('reasonqa_usage_log').insert({
    user_id: userId,
    analysis_id: analysisId,
    event,
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
  });
}

/**
 * Phased pipeline runner — executes ONE step based on current status.
 * Called repeatedly by the poller. Each call fits within Vercel's 300s limit.
 */
export async function runPipelinePhase(
  analysisId: string,
  data: Record<string, unknown>,
  userId: string,
  mode: AnalysisMode,
): Promise<{ status: string; next?: string }> {
  const currentStatus = data.status as string;
  const documentText = data.doc_text as string;

  if (mode === 'quick' && currentStatus === 'pending') {
    await runQuickPipeline(analysisId, documentText, userId);
    return { status: 'complete' };
  }

  try {
    switch (currentStatus) {
      case 'pending': {
        // Phase 1: Run Pass 1
        await updateAnalysis(analysisId, { status: 'pass1' });
        console.log(`[reasonqa] Phase: Pass 1 for ${analysisId}`);
        const p1 = buildPass1Prompt(documentText);
        const pass1Start = Date.now();
        const pass1Result = await callModelWithTimeout(
          REASONQA_SONNET, p1.systemPrompt,
          [{ role: 'user', content: p1.userMessage }], 0.2, 'pass1',
        );
        const stats: PassStats = {
          pass1: {
            durationMs: Date.now() - pass1Start,
            inputTokens: pass1Result.usage.inputTokens,
            outputTokens: pass1Result.usage.outputTokens,
            model: REASONQA_SONNET.model,
          },
        };
        logUsage(pass1Result.usage, 'reasonqa:pass1', userId);

        const pass1: Pass1Output = parseJsonResponse(pass1Result.text) as Pass1Output;
        if (!pass1.nodes || !Array.isArray(pass1.nodes)) {
          throw new Error('Pass 1 returned invalid structure');
        }
        await updateAnalysis(analysisId, {
          status: 'pass2',
          pass1_output: pass1,
          title: pass1.documentTitle || null,
          pass_stats: stats,
        });
        console.log(`[reasonqa] Phase: Pass 1 complete (${pass1.nodes.length} nodes)`);
        return { status: 'pass2', next: 'pass2' };
      }

      case 'pass2': {
        // Phase 2: Run Pass 2 + corpus + interpretive context in parallel
        const pass1 = data.pass1_output as Pass1Output;
        const existingStats = (data.pass_stats || {}) as PassStats;
        console.log(`[reasonqa] Phase: Pass 2 + corpus for ${analysisId}`);

        const citations = extractCitations(pass1.nodes);
        const pass2Start = Date.now();

        const pass2Promise = (async () => {
          const p2 = buildPass2Prompt(documentText, pass1);
          return callModelWithTimeout(
            REASONQA_SONNET, p2.systemPrompt,
            [{ role: 'user', content: p2.userMessage }], 0.2, 'pass2',
          );
        })();

        const corpusPromise = citations.length > 0
          ? fetchAllSources(citations) : Promise.resolve([]);

        const interpretivePromise = retrieveInterpretiveContext(
          pass1.nodes, [], userId, documentText,
        ).catch(() => ({ authorities: [], janusFacedCount: 0, totalCitingCases: 0, totalClassifications: 0 }));

        const [pass2Result, fetchedSources, interpretiveContext] = await Promise.all([
          pass2Promise, corpusPromise, interpretivePromise,
        ]);

        const stats: PassStats = {
          ...existingStats,
          pass2: {
            durationMs: Date.now() - pass2Start,
            inputTokens: pass2Result.usage.inputTokens,
            outputTokens: pass2Result.usage.outputTokens,
            model: REASONQA_SONNET.model,
          },
        };
        if (citations.length > 0) {
          stats.corpus = {
            durationMs: Date.now() - pass2Start,
            fetched: fetchedSources.length,
            found: fetchedSources.filter(s => s.found).length,
          };
        }
        logUsage(pass2Result.usage, 'reasonqa:pass2', userId);

        const pass2: Pass2Output = parseJsonResponse(pass2Result.text) as Pass2Output;
        if (!pass2.edges || !Array.isArray(pass2.edges)) {
          throw new Error('Pass 2 returned invalid structure');
        }

        // Compute metrics
        const metrics = computeDAGMetrics(pass1.nodes, pass2.edges);

        // Build sources
        const sourceMap = new Map<string, SourceReference>();
        let refCounter = 1;
        for (const fs of fetchedSources) {
          const key = fs.citation.raw;
          if (!sourceMap.has(key)) {
            sourceMap.set(key, {
              refId: `S${refCounter++}`, citationRaw: fs.citation.raw,
              citationType: fs.citation.type, found: fs.found, url: fs.url,
              nodeIds: [], textPreview: fs.text?.substring(0, 500) || undefined,
            });
          }
          const ref = sourceMap.get(key)!;
          for (const node of pass1.nodes) {
            if (node.citationSource && node.citationSource === fs.citation.raw && !ref.nodeIds.includes(node.id)) {
              ref.nodeIds.push(node.id);
            }
          }
        }
        for (const node of pass1.nodes) {
          if (node.citationStatus !== 'Ext' || !node.citationSource) continue;
          for (const [key, ref] of sourceMap) {
            if (node.citationSource.includes(key) || key.includes(node.citationSource)) {
              if (!ref.nodeIds.includes(node.id)) ref.nodeIds.push(node.id);
            }
          }
        }

        // Store corpus and interpretive context for Pass 3
        const sourceCorpus = assembleSourceCorpus(fetchedSources);
        const interpretiveText = formatInterpretiveContext(interpretiveContext);
        const fullCorpus = [sourceCorpus, interpretiveText].filter(Boolean).join('\n\n');

        await updateAnalysis(analysisId, {
          status: 'pass3',
          pass2_output: pass2,
          metrics_output: metrics,
          sources: [...sourceMap.values()],
          pass_stats: stats,
          // Store corpus in doc_text temporarily for Pass 3 to pick up
          // (doc_text gets cleared on completion anyway)
          doc_text: JSON.stringify({ originalText: documentText, corpus: fullCorpus }),
        });
        console.log(`[reasonqa] Phase: Pass 2 complete (${pass2.edges.length} edges, ${metrics.reasoningPercent}% reasoning)`);
        return { status: 'pass3', next: 'pass3' };
      }

      case 'pass3': {
        // Phase 3: Run Pass 3 (Opus verification)
        const pass1 = data.pass1_output as Pass1Output;
        const pass2 = data.pass2_output as Pass2Output;
        const metrics = data.metrics_output as DAGMetrics;
        const existingStats = (data.pass_stats || {}) as PassStats;
        console.log(`[reasonqa] Phase: Pass 3 for ${analysisId}`);

        // Recover corpus from doc_text (stored by Phase 2)
        let docText = documentText;
        let corpus: string | undefined;
        try {
          const stored = JSON.parse(documentText);
          if (stored.originalText) {
            docText = stored.originalText;
            corpus = stored.corpus;
          }
        } catch { /* doc_text is plain text, no corpus stored */ }

        const p3 = buildPass3Prompt(docText, pass1, pass2, metrics, corpus);
        const pass3Start = Date.now();
        const pass3Result = await callModelWithTimeout(
          REASONQA_OPUS, p3.systemPrompt,
          [{ role: 'user', content: p3.userMessage }], 0.2, 'pass3', OPUS_TIMEOUT_MS,
        );

        const stats: PassStats = {
          ...existingStats,
          pass3: {
            durationMs: Date.now() - pass3Start,
            inputTokens: pass3Result.usage.inputTokens,
            outputTokens: pass3Result.usage.outputTokens,
            model: REASONQA_OPUS.model,
          },
        };
        logUsage(pass3Result.usage, 'reasonqa:pass3', userId);

        const pass3: Pass3Output = parseJsonResponse(pass3Result.text) as Pass3Output;
        if (!pass3.assessment) {
          throw new Error('Pass 3 returned invalid structure');
        }

        await updateAnalysis(analysisId, {
          status: 'complete',
          pass3_output: pass3,
          pass_stats: stats,
          completed_at: new Date().toISOString(),
          doc_text: '[deleted after processing]',
        });
        console.log(`[reasonqa] Phase: Pass 3 complete — quality: ${pass3.assessment.quality}`);
        return { status: 'complete' };
      }

      default:
        return { status: currentStatus };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[reasonqa] Phase failed for ${analysisId}:`, message);
    await updateAnalysis(analysisId, { status: 'error', error_message: message });
    return { status: 'error' };
  }
}

export async function runPipeline(
  analysisId: string,
  documentText: string,
  userId: string,
  mode: AnalysisMode = 'full',
): Promise<void> {
  if (mode === 'quick') {
    return runQuickPipeline(analysisId, documentText, userId);
  }
  const startTime = Date.now();

  try {
    const stats: PassStats = {};

    // ── Pass 1: Node Extraction (Sonnet) ──────────────────────
    await updateAnalysis(analysisId, { status: 'pass1' });
    console.log(`[reasonqa] Starting Pass 1 for ${analysisId} (${documentText.length} chars)`);
    const p1 = buildPass1Prompt(documentText);

    const pass1Start = Date.now();
    const pass1Result = await callModelWithTimeout(
      REASONQA_SONNET,
      p1.systemPrompt,
      [{ role: 'user', content: p1.userMessage }],
      0.2,
      'pass1',
    );
    stats.pass1 = {
      durationMs: Date.now() - pass1Start,
      inputTokens: pass1Result.usage.inputTokens,
      outputTokens: pass1Result.usage.outputTokens,
      model: REASONQA_SONNET.model,
    };
    logUsage(pass1Result.usage, 'reasonqa:pass1', userId);
    await logEvent(userId, analysisId, 'pass1', REASONQA_SONNET.model,
      pass1Result.usage.inputTokens, pass1Result.usage.outputTokens);

    const pass1: Pass1Output = parseJsonResponse(pass1Result.text) as Pass1Output;
    if (!pass1.nodes || !Array.isArray(pass1.nodes)) {
      throw new Error('Pass 1 returned invalid structure — missing nodes array');
    }

    await updateAnalysis(analysisId, {
      status: 'pass2',
      pass1_output: pass1,
      title: pass1.documentTitle || null,
      pass_stats: stats,
    });
    console.log(`[reasonqa] Pass 1 complete: ${pass1.nodes.length} nodes in ${stats.pass1.durationMs}ms`);

    // ── Pass 2 + Corpus Lookup (parallel) ──────────────────────
    const citations = extractCitations(pass1.nodes);
    console.log(`[reasonqa] Found ${citations.length} external citations to look up`);

    const pass2Start = Date.now();
    const pass2Promise = (async () => {
      const p2 = buildPass2Prompt(documentText, pass1);
      const pass2Result = await callModelWithTimeout(
        REASONQA_SONNET,
        p2.systemPrompt,
        [{ role: 'user', content: p2.userMessage }],
        0.2,
        'pass2',
      );
      logUsage(pass2Result.usage, 'reasonqa:pass2', userId);
      await logEvent(userId, analysisId, 'pass2', REASONQA_SONNET.model,
        pass2Result.usage.inputTokens, pass2Result.usage.outputTokens);
      return pass2Result;
    })();

    const corpusStart = Date.now();
    const corpusPromise = citations.length > 0
      ? fetchAllSources(citations)
      : Promise.resolve([]);

    // Layer B: Interpretive context — search for cases citing the same authorities
    // Runs from Pass 1 nodes only (edges=[]) — authority selection uses citation
    // importance, not graph position, since Pass 2 edges aren't ready yet.
    const interpretivePromise = retrieveInterpretiveContext(
      pass1.nodes, [], userId, documentText,
    ).catch(err => {
      console.error('[interpretive] Failed:', err instanceof Error ? err.message : err);
      return { authorities: [], janusFacedCount: 0, totalCitingCases: 0, totalClassifications: 0 };
    });

    const [pass2Result, fetchedSources, interpretiveContext] = await Promise.all([
      pass2Promise, corpusPromise, interpretivePromise,
    ]);

    stats.pass2 = {
      durationMs: Date.now() - pass2Start,
      inputTokens: pass2Result.usage.inputTokens,
      outputTokens: pass2Result.usage.outputTokens,
      model: REASONQA_SONNET.model,
    };
    if (citations.length > 0) {
      stats.corpus = {
        durationMs: Date.now() - corpusStart,
        fetched: fetchedSources.length,
        found: fetchedSources.filter(s => s.found).length,
      };
    }

    const pass2: Pass2Output = parseJsonResponse(pass2Result.text) as Pass2Output;
    if (!pass2.edges || !Array.isArray(pass2.edges)) {
      throw new Error('Pass 2 returned invalid structure — missing edges array');
    }

    await updateAnalysis(analysisId, { status: 'metrics', pass2_output: pass2, pass_stats: stats });
    console.log(`[reasonqa] Pass 2 complete: ${pass2.edges.length} edges in ${stats.pass2.durationMs}ms`);

    // ── Deterministic Metrics (code) ──────────────────────────
    const metrics = computeDAGMetrics(pass1.nodes, pass2.edges);
    await updateAnalysis(analysisId, { status: 'pass3', metrics_output: metrics, pass_stats: stats });
    console.log(`[reasonqa] Metrics computed: depth ${metrics.maxChainDepth}, ${metrics.reasoningPercent}% reasoning`);

    // ── Build source references + corpus for Pass 3 ─────────
    // Dedupe sources by citation text and assign ref IDs
    const sourceMap = new Map<string, SourceReference>();
    let refCounter = 1;
    for (const fs of fetchedSources) {
      const key = fs.citation.raw;
      if (!sourceMap.has(key)) {
        sourceMap.set(key, {
          refId: `S${refCounter++}`,
          citationRaw: fs.citation.raw,
          citationType: fs.citation.type,
          found: fs.found,
          url: fs.url,
          nodeIds: [],
          textPreview: fs.text?.substring(0, 500) || undefined,
        });
      }
      // Map nodes to their source reference
      const ref = sourceMap.get(key)!;
      for (const node of pass1.nodes) {
        if (node.citationSource && node.citationSource === fs.citation.raw && !ref.nodeIds.includes(node.id)) {
          ref.nodeIds.push(node.id);
        }
      }
    }
    // Also map nodes by substring match for citations that aren't exact
    for (const node of pass1.nodes) {
      if (node.citationStatus !== 'Ext' || !node.citationSource) continue;
      for (const [key, ref] of sourceMap) {
        if (node.citationSource.includes(key) || key.includes(node.citationSource)) {
          if (!ref.nodeIds.includes(node.id)) ref.nodeIds.push(node.id);
        }
      }
    }
    const sources = [...sourceMap.values()];

    const sourceCorpus = assembleSourceCorpus(fetchedSources);
    if (sourceCorpus) {
      console.log(`[reasonqa] Source corpus: ${sources.filter(s => s.found).length}/${sources.length} unique sources`);
    }

    // Assemble interpretive context (Layer B)
    const interpretiveText = formatInterpretiveContext(interpretiveContext);
    if (interpretiveText) {
      console.log(`[reasonqa] Interpretive context: ${interpretiveContext.janusFacedCount} Janus-faced, ${interpretiveContext.totalClassifications} classifications`);
    }

    // Combine both layers for Pass 3
    const fullCorpus = [sourceCorpus, interpretiveText].filter(Boolean).join('\n\n');

    // Store sources immediately so the UI can show them during Pass 3
    await updateAnalysis(analysisId, { sources });

    // ── Pass 3: Verification (Opus) ──────────────────────────
    const p3 = buildPass3Prompt(documentText, pass1, pass2, metrics, fullCorpus || undefined);

    const pass3Start = Date.now();
    const pass3Result = await callModelWithTimeout(
      REASONQA_OPUS,
      p3.systemPrompt,
      [{ role: 'user', content: p3.userMessage }],
      0.2,
      'pass3',
      OPUS_TIMEOUT_MS,
    );
    stats.pass3 = {
      durationMs: Date.now() - pass3Start,
      inputTokens: pass3Result.usage.inputTokens,
      outputTokens: pass3Result.usage.outputTokens,
      model: REASONQA_OPUS.model,
    };
    logUsage(pass3Result.usage, 'reasonqa:pass3', userId);
    await logEvent(userId, analysisId, 'pass3', REASONQA_OPUS.model,
      pass3Result.usage.inputTokens, pass3Result.usage.outputTokens);

    const pass3: Pass3Output = parseJsonResponse(pass3Result.text) as Pass3Output;
    if (!pass3.assessment) {
      throw new Error('Pass 3 returned invalid structure — missing assessment');
    }

    const elapsed = Date.now() - startTime;
    await updateAnalysis(analysisId, {
      status: 'complete',
      pass3_output: pass3,
      pass_stats: stats,
      completed_at: new Date().toISOString(),
      doc_text: '[deleted after processing]',
    });
    console.log(`[reasonqa] Complete in ${elapsed}ms — quality: ${pass3.assessment.quality}`);

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[reasonqa] Pipeline failed for ${analysisId}:`, message);
    await updateAnalysis(analysisId, { status: 'error', error_message: message });
  }
}

export async function runReverify(
  analysisId: string,
  documentText: string,
  userId: string,
  pass1: Pass1Output,
  pass2: Pass2Output,
  existingMetrics: DAGMetrics | null,
): Promise<void> {
  const startTime = Date.now();
  console.log(`[reasonqa] Re-verify starting for ${analysisId} (reusing ${pass1.nodes.length} nodes, ${pass2.edges.length} edges)`);

  try {
    const stats: PassStats = {};

    // Recompute metrics if missing
    const metrics = existingMetrics || computeDAGMetrics(pass1.nodes, pass2.edges);

    // ── Corpus lookup (Layer A) ─────────────────────────────
    const citations = extractCitations(pass1.nodes);
    console.log(`[reasonqa] Re-verify: ${citations.length} external citations`);

    const corpusStart = Date.now();
    const corpusPromise = citations.length > 0
      ? fetchAllSources(citations)
      : Promise.resolve([]);

    // ── Interpretive context (Layer B) ──────────────────────
    const interpretivePromise = retrieveInterpretiveContext(
      pass1.nodes, [], userId, documentText,
    ).catch(err => {
      console.error('[interpretive] Failed:', err instanceof Error ? err.message : err);
      return { authorities: [], janusFacedCount: 0, totalCitingCases: 0, totalClassifications: 0 };
    });

    const [fetchedSources, interpretiveContext] = await Promise.all([corpusPromise, interpretivePromise]);

    if (citations.length > 0) {
      stats.corpus = {
        durationMs: Date.now() - corpusStart,
        fetched: fetchedSources.length,
        found: fetchedSources.filter(s => s.found).length,
      };
    }

    // Build source references
    const sourceMap = new Map<string, SourceReference>();
    let refCounter = 1;
    for (const fs of fetchedSources) {
      const key = fs.citation.raw;
      if (!sourceMap.has(key)) {
        sourceMap.set(key, {
          refId: `S${refCounter++}`,
          citationRaw: fs.citation.raw,
          citationType: fs.citation.type,
          found: fs.found,
          url: fs.url,
          nodeIds: [],
          textPreview: fs.text?.substring(0, 500) || undefined,
        });
      }
      const ref = sourceMap.get(key)!;
      for (const node of pass1.nodes) {
        if (node.citationSource && node.citationSource === fs.citation.raw && !ref.nodeIds.includes(node.id)) {
          ref.nodeIds.push(node.id);
        }
      }
    }
    for (const node of pass1.nodes) {
      if (node.citationStatus !== 'Ext' || !node.citationSource) continue;
      for (const [key, ref] of sourceMap) {
        if (node.citationSource.includes(key) || key.includes(node.citationSource)) {
          if (!ref.nodeIds.includes(node.id)) ref.nodeIds.push(node.id);
        }
      }
    }
    const sources = [...sourceMap.values()];

    // Assemble corpus
    const sourceCorpus = assembleSourceCorpus(fetchedSources);
    const interpretiveText = formatInterpretiveContext(interpretiveContext);
    const fullCorpus = [sourceCorpus, interpretiveText].filter(Boolean).join('\n\n');

    await updateAnalysis(analysisId, { sources, pass_stats: stats });

    // ── Pass 3: Verification (Opus) ──────────────────────────
    console.log(`[reasonqa] Re-verify: starting Pass 3`);
    const p3 = buildPass3Prompt(documentText, pass1, pass2, metrics, fullCorpus || undefined);

    const pass3Start = Date.now();
    const pass3Result = await callModelWithTimeout(
      REASONQA_OPUS,
      p3.systemPrompt,
      [{ role: 'user', content: p3.userMessage }],
      0.2,
      'reverify:pass3',
      OPUS_TIMEOUT_MS,
    );
    stats.pass3 = {
      durationMs: Date.now() - pass3Start,
      inputTokens: pass3Result.usage.inputTokens,
      outputTokens: pass3Result.usage.outputTokens,
      model: REASONQA_OPUS.model,
    };
    logUsage(pass3Result.usage, 'reasonqa:reverify', userId);
    await logEvent(userId, analysisId, 'reverify', REASONQA_OPUS.model,
      pass3Result.usage.inputTokens, pass3Result.usage.outputTokens);

    const pass3: Pass3Output = parseJsonResponse(pass3Result.text) as Pass3Output;
    if (!pass3.assessment) {
      throw new Error('Pass 3 returned invalid structure — missing assessment');
    }

    const elapsed = Date.now() - startTime;
    await updateAnalysis(analysisId, {
      status: 'complete',
      pass3_output: pass3,
      pass_stats: stats,
      completed_at: new Date().toISOString(),
      doc_text: '[deleted after processing]',
    });
    console.log(`[reasonqa] Re-verify complete in ${elapsed}ms — quality: ${pass3.assessment.quality}`);

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[reasonqa] Re-verify failed for ${analysisId}:`, message);
    await updateAnalysis(analysisId, { status: 'error', error_message: message });
  }
}

async function runQuickPipeline(
  analysisId: string,
  documentText: string,
  userId: string,
): Promise<void> {
  const startTime = Date.now();

  try {
    await updateAnalysis(analysisId, { status: 'pass1' });
    const { systemPrompt, userMessage } = buildQuickPrompt(documentText);

    const result = await callModelWithTimeout(
      REASONQA_SONNET,
      systemPrompt,
      [{ role: 'user', content: userMessage }],
      0.2,
      'quick',
    );
    logUsage(result.usage, 'reasonqa:quick', userId);
    await logEvent(userId, analysisId, 'quick', REASONQA_SONNET.model,
      result.usage.inputTokens, result.usage.outputTokens);

    const parsed = parseJsonResponse(result.text) as {
      documentTitle?: string;
      documentType?: string;
      nodes?: Array<{ id: string; text: string; type: string; citationStatus: string; citationSource?: string; qualifier: string; verificationNote?: string }>;
      issues?: Array<{ nodeIds: string[]; issueType: string; description: string; severity: string; suggestedFix?: string }>;
      assessment?: { quality: string; summary: string; keyStrengths?: string[]; keyWeaknesses?: string[]; correctionsNeeded: string[] };
    };

    // Map quick output into the standard analysis shape
    const pass1Output: Pass1Output = {
      documentTitle: parsed.documentTitle || 'Untitled',
      documentType: parsed.documentType || 'other',
      nodes: (parsed.nodes || []).map(n => ({
        id: n.id,
        text: n.text,
        type: n.type as 'F' | 'M' | 'V' | 'P',
        citationStatus: n.citationStatus as 'Ext' | 'Int' | 'None',
        citationSource: n.citationSource,
        qualifier: n.qualifier as 'Q0' | 'Q1' | 'Q2',
        edgeDrafts: [],
        codingNotes: n.verificationNote,
      })),
    };

    const pass2Output: Pass2Output = {
      edges: [],
      structuralIssues: (parsed.issues || []).map(i => ({
        nodeIds: i.nodeIds,
        issueType: i.issueType,
        description: i.description,
        severity: i.severity as 'high' | 'medium' | 'low',
        suggestedFix: i.suggestedFix,
      })),
    };

    const pass3Output: Pass3Output = {
      verifications: [],
      chainAssessments: [],
      assessment: {
        quality: (parsed.assessment?.quality as 'STRONG' | 'ADEQUATE' | 'MARGINAL' | 'WEAK') || 'MARGINAL',
        totalVerified: 0,
        totalPartial: 0,
        totalFailed: 0,
        totalUngrounded: 0,
        correctionsNeeded: parsed.assessment?.correctionsNeeded || [],
        summary: parsed.assessment?.summary || '',
      },
    };

    const elapsed = Date.now() - startTime;
    const stats: PassStats = {
      pass1: {
        durationMs: elapsed,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        model: REASONQA_SONNET.model,
      },
    };

    await updateAnalysis(analysisId, {
      status: 'complete',
      title: pass1Output.documentTitle || null,
      pass1_output: pass1Output,
      pass2_output: pass2Output,
      pass3_output: pass3Output,
      metrics_output: { totalNodes: pass1Output.nodes.length, nodesByType: { F: 0, M: 0, V: 0, P: 0 }, totalEdges: 0, edgesByType: { S: 0, W: 0, J: 0, E: 0 }, reasoningPercent: 0, elaborationPercent: 0, maxChainDepth: 0, convergencePoints: [], orphanNodes: [] },
      pass_stats: stats,
      completed_at: new Date().toISOString(),
      doc_text: '[deleted after processing]',
    });
    console.log(`[reasonqa] Quick analysis complete in ${elapsed}ms — quality: ${pass3Output.assessment.quality}`);

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[reasonqa] Quick pipeline failed for ${analysisId}:`, message);
    await updateAnalysis(analysisId, { status: 'error', error_message: message });
  }
}
