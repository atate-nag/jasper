// Test endpoint for corpus lookup and interpretive context — runs independently
// of the full pipeline. Useful for debugging search queries, citation extraction,
// and Haiku classification without waiting for a full analysis.
//
// POST /api/reasonqa/test-corpus
// Body (JSON):
//   { "citation": "s.901G Companies Act 2006" }                → test Layer A (statute lookup)
//   { "citation": "[2025] EWHC 2755 (Ch)" }                    → test Layer A (case law lookup)
//   { "authority": "Bedfordshire", "proposition": "...", "topicalTerms": "breach statutory duty" }
//                                                                → test Layer B (interpretive context)
//   { "authority": "Bedfordshire", "proposition": "...", "searchOnly": true }
//                                                                → Layer B search only (no Haiku)

import { createClient } from '@/lib/supabase/server';
import { parseCitation } from '@/lib/reasonqa/corpus/citation-parser';
import { fetchCaseLaw, fetchLegislation } from '@/lib/reasonqa/corpus/fetcher';
import { searchCaseLaw } from '@/lib/reasonqa/corpus/interpretive/atom-client';
import { extractCitationWindows } from '@/lib/reasonqa/corpus/interpretive/citation-extractor';
import { classifyCitationTreatment } from '@/lib/reasonqa/corpus/interpretive/classifier';
import type { ParsedCitation } from '@/lib/reasonqa/corpus/types';

export async function POST(req: Request): Promise<Response> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const body = await req.json();

    // ── Layer A: Direct citation lookup ──────────────────────
    if (body.citation) {
      const parsed = parseCitation(body.citation);
      let result;

      if (parsed.type === 'case' && parsed.uri) {
        result = await fetchCaseLaw(parsed);
      } else if (parsed.type === 'statute' && parsed.legislationUri) {
        result = await fetchLegislation(parsed);
      } else {
        return Response.json({
          parsed,
          error: 'Could not resolve citation to a fetchable URI',
        });
      }

      return Response.json({
        parsed,
        found: result.found,
        url: result.url,
        textLength: result.text?.length || 0,
        textPreview: result.text?.substring(0, 1000) || null,
        paragraphCount: result.paragraphs ? Object.keys(result.paragraphs).length : 0,
      });
    }

    // ── Layer B: Interpretive context ────────────────────────
    if (body.authority) {
      const authorityName = body.authority as string;
      const proposition = (body.proposition as string) || '';
      const topicalTerms = (body.topicalTerms as string) || '';
      const searchOnly = !!body.searchOnly;

      // Build query
      const queryParts = [`"${authorityName}"`];
      if (topicalTerms) {
        queryParts.push(...topicalTerms.split(/\s+/).filter((t: string) => t.length > 2).map((t: string) => `"${t}"`));
      }
      const query = queryParts.join(' ');

      // Search
      const hits = await searchCaseLaw(query, 10);

      if (searchOnly) {
        return Response.json({
          query,
          hits: hits.map(h => ({ title: h.title, uri: h.uri, date: h.date })),
          hitCount: hits.length,
        });
      }

      // Fetch citation windows and classify
      const results = [];
      for (const hit of hits.slice(0, 5)) {
        const windows = await extractCitationWindows(hit.uri, authorityName, hit.title, 2);
        for (const window of windows) {
          const classified = await classifyCitationTreatment(
            window, authorityName, proposition, user.id,
          );
          results.push({
            citingCase: classified.citingCase,
            treatment: classified.treatment,
            explanation: classified.explanation,
            paragraphPreview: classified.paragraphs.substring(0, 500),
          });
        }
      }

      const supports = results.filter(r => r.treatment === 'SUPPORTS').length;
      const undermines = results.filter(r => r.treatment === 'UNDERMINES').length;
      const distinguishes = results.filter(r => r.treatment === 'DISTINGUISHES').length;

      return Response.json({
        query,
        hitCount: hits.length,
        classificationsRun: results.length,
        supports,
        undermines,
        distinguishes,
        janusFaced: supports > 0 && undermines > 0,
        results,
      });
    }

    return Response.json({ error: 'Provide either "citation" or "authority" in the request body' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}
