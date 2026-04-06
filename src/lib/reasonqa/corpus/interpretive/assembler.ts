// Orchestrate interpretive context retrieval: search → fetch → classify → assemble.

import type { ClaimNode, Edge } from '../../types';
import type { AuthorityContext, InterpretiveContext, InterpretiveFlags, ClassifiedCitation } from './types';
import { buildAuthorityRefs } from './query-builder';
import { searchCaseLaw } from './atom-client';
import { extractCitationWindows } from './citation-extractor';
import { classifyCitationTreatment } from './classifier';

const SEARCH_DELAY_MS = 300;
const CLASSIFY_DELAY_MS = 100;
const SEARCH_RESULTS_PER_AUTHORITY = 15; // over-fetch to allow for 404 backfill
const TARGET_FETCHED_PER_AUTHORITY = 10; // stop fetching once we have this many
const MAX_WINDOWS_PER_CASE = 2;

export async function retrieveInterpretiveContext(
  nodes: ClaimNode[],
  edges: Edge[],
  userId?: string,
  documentText?: string,
): Promise<InterpretiveContext> {
  const authorities = buildAuthorityRefs(nodes, edges);
  console.log(`[interpretive] ${authorities.length} authorities to investigate`);

  if (authorities.length === 0) {
    return { authorities: [], janusFacedCount: 0, totalCitingCases: 0, totalClassifications: 0 };
  }

  const results: AuthorityContext[] = [];
  let totalCitingCases = 0;
  let totalClassifications = 0;

  for (let authIdx = 0; authIdx < authorities.length; authIdx++) {
    const authority = authorities[authIdx];
    console.log(`[interpretive] ── Authority ${authIdx + 1}/${authorities.length}: ${authority.name} ──`);
    console.log(`[interpretive]   Citation: ${authority.citation}`);
    console.log(`[interpretive]   Proposition: "${authority.proposition.substring(0, 120)}"`);
    console.log(`[interpretive]   Nodes: [${authority.nodeIds.join(', ')}]`);
    console.log(`[interpretive]   Query: ${authority.searchQuery}`);

    // Step 1: Search for citing cases (over-fetch to allow for 404 backfill)
    const searchHits = await searchCaseLaw(authority.searchQuery, SEARCH_RESULTS_PER_AUTHORITY);
    await delay(SEARCH_DELAY_MS);

    console.log(`[interpretive]   Hits: ${searchHits.length} results, targeting top ${TARGET_FETCHED_PER_AUTHORITY} with backfill`);
    if (searchHits.length === 0) {
      console.log(`[interpretive]   Result: 0 hits — skipping`);
      results.push({ authority, supports: [], undermines: [], distinguishes: [], janusFaced: false, flags: { janusFaced: false, eroded: false, overreliedContested: false, uncitedCounterAuthorities: [], stale: false } });
      continue;
    }

    totalCitingCases += searchHits.length;
    // Log first 10 hit names for debugging search quality
    const logLimit = Math.min(searchHits.length, 10);
    for (let i = 0; i < logLimit; i++) {
      const hit = searchHits[i];
      console.log(`[interpretive]     ${i + 1}. ${hit.title} (${hit.uri}) ${hit.date}`);
    }
    if (searchHits.length > logLimit) {
      console.log(`[interpretive]     ...and ${searchHits.length - logLimit} more`);
    }

    // Step 2: Fetch citation paragraphs with 404 backfill
    // Try hits in order until we have TARGET_FETCHED_PER_AUTHORITY successful fetches
    let fetchOk = 0;
    let fetchFail = 0;
    const classified: ClassifiedCitation[] = [];
    const docLc = (documentText || '').toLowerCase();

    for (const hit of searchHits) {
      // Stop once we have enough successful fetches
      if (fetchOk >= TARGET_FETCHED_PER_AUTHORITY) {
        console.log(`[interpretive]   Reached ${TARGET_FETCHED_PER_AUTHORITY} successful fetches, stopping`);
        break;
      }

      const windows = await extractCitationWindows(
        hit.uri,
        authority.name,
        hit.title,
        MAX_WINDOWS_PER_CASE,
      );

      if (windows.length > 0) {
        fetchOk++;
        // Check if this citing case appears in the source document
        const inDocument = docLc.includes(hit.title.toLowerCase().replace(/&amp;/g, '&'));
        for (const window of windows) {
          const result = await classifyCitationTreatment(
            window,
            authority.name,
            authority.proposition,
            userId,
          );
          result.date = hit.date;
          result.inDocument = inDocument;
          classified.push(result);
          totalClassifications++;
          await delay(CLASSIFY_DELAY_MS);
        }
      } else {
        fetchFail++;
        console.log(`[interpretive]   ⚠ ${hit.uri} not fetchable or no mentions — backfilling from next hit`);
      }
      await delay(SEARCH_DELAY_MS);
    }

    if (fetchOk < TARGET_FETCHED_PER_AUTHORITY) {
      console.log(`[interpretive]   Exhausted all ${searchHits.length} hits, only ${fetchOk} fetched successfully (${fetchFail} failed)`);
    }

    // Step 3: Tally, compute flags, decide
    const supports = classified.filter(c => c.treatment === 'SUPPORTS');
    const undermines = classified.filter(c => c.treatment === 'UNDERMINES');
    const distinguishes = classified.filter(c => c.treatment === 'DISTINGUISHES');
    const neutral = classified.filter(c => c.treatment === 'NEUTRAL' || c.treatment === 'IRRELEVANT');
    const janusFaced = supports.length > 0 && undermines.length > 0;

    // Compute interpretive flags
    const substantive = supports.length + undermines.length + distinguishes.length;
    const contested = undermines.length + distinguishes.length;
    const flags = computeFlags(
      janusFaced, substantive, contested, distinguishes.length,
      authority.nodeIds.length, undermines, distinguishes, classified,
    );

    const verdict = janusFaced ? '⚠ JANUS-FACED' : 'NOT JANUS-FACED';
    const flagList = Object.entries(flags)
      .filter(([k, v]) => k !== 'uncitedCounterAuthorities' ? v : (v as string[]).length > 0)
      .map(([k]) => k)
      .join(', ');
    console.log(`[interpretive]   Result: ${supports.length} SUPPORTS, ${undermines.length} UNDERMINES, ${distinguishes.length} DISTINGUISHES, ${neutral.length} NEUTRAL/IRRELEVANT (${fetchOk} fetched, ${fetchFail} failed) → ${verdict}`);
    if (flagList) console.log(`[interpretive]   Flags: ${flagList}`);
    if (flags.uncitedCounterAuthorities.length > 0) {
      console.log(`[interpretive]   Uncited counter-authorities: ${flags.uncitedCounterAuthorities.join('; ')}`);
    }

    results.push({
      authority,
      supports,
      undermines,
      distinguishes,
      janusFaced,
      flags,
    });
  }

  // Assembly summary
  const janusFacedResults = results.filter(r => r.janusFaced);
  const singleSided = results.filter(r => !r.janusFaced && (r.supports.length > 0 || r.undermines.length > 0));
  const noData = results.filter(r => r.supports.length === 0 && r.undermines.length === 0 && r.distinguishes.length === 0);
  const janusFacedCount = janusFacedResults.length;

  console.log(`[interpretive] ── Assembly ──`);
  if (janusFacedResults.length > 0) {
    console.log(`[interpretive]   Janus-faced: ${janusFacedResults.length} authorities`);
    for (const r of janusFacedResults) {
      console.log(`[interpretive]     ${r.authority.name}: ${r.supports.length}S ${r.undermines.length}U`);
    }
  } else {
    console.log(`[interpretive]   Janus-faced: 0 authorities`);
  }
  if (singleSided.length > 0) {
    const allSupports = singleSided.every(r => r.undermines.length === 0);
    console.log(`[interpretive]   Single-sided: ${singleSided.length} authorities (${allSupports ? 'all SUPPORTS' : 'mixed'})`);
  }
  if (noData.length > 0) {
    console.log(`[interpretive]   No data: ${noData.length} authorities (${noData.map(r => r.authority.name).join(', ')})`);
  }

  // What's being passed to Pass 3
  const relevant = results.filter(r => r.janusFaced || r.undermines.length > 0);
  console.log(`[interpretive]   Passing to Pass 3: ${janusFacedResults.length} janus-faced, ${relevant.length - janusFacedResults.length} with undermining citations, ${results.length - relevant.length} omitted (supports-only or no data)`);
  console.log(`[interpretive]   Total: ${totalCitingCases} cases searched, ${totalClassifications} classifications`);

  return {
    authorities: results,
    janusFacedCount,
    totalCitingCases,
    totalClassifications,
  };
}

export function formatInterpretiveContext(ctx: InterpretiveContext): string {
  if (ctx.authorities.length === 0) return '';

  // Include authorities with any non-trivial flags or contested citations
  const relevant = ctx.authorities.filter(
    a => a.janusFaced || a.undermines.length > 0 || a.distinguishes.length > 0 ||
         a.flags.eroded || a.flags.overreliedContested || a.flags.stale ||
         a.flags.uncitedCounterAuthorities.length > 0
  );

  if (relevant.length === 0) return '';

  const parts: string[] = [];
  parts.push('INTERPRETIVE CONTEXT — CITATION TREATMENT ANALYSIS:');
  parts.push('The following authorities have been analysed by searching for cases that cite them');
  parts.push('and classifying how those cases apply the authority.\n');

  for (const auth of relevant) {
    const f = auth.flags;
    parts.push(`--- AUTHORITY: ${auth.authority.citation || auth.authority.name} ---`);
    parts.push(`CITED FOR: "${auth.authority.proposition}"`);
    parts.push(`NODES: ${auth.authority.nodeIds.join(', ')}`);

    // Flags section — tells Pass 3 exactly what issues to create
    const activeFlags: string[] = [];
    if (f.overreliedContested) activeFlags.push('overrelied_contested');
    else if (f.janusFaced) activeFlags.push('janus_faced');
    else if (f.eroded) activeFlags.push('eroded');
    if (f.stale && !f.janusFaced && !f.overreliedContested) activeFlags.push('stale');
    if (f.uncitedCounterAuthorities.length > 0) activeFlags.push('uncited_counter_authority');

    parts.push(`FLAGS: ${activeFlags.length > 0 ? activeFlags.join(', ') : 'none'}`);

    if (f.janusFaced) {
      parts.push('⚠ JANUS-FACED: Courts have applied this authority on BOTH sides.');
    }
    if (f.eroded) {
      const substantive = auth.supports.length + auth.undermines.length + auth.distinguishes.length;
      parts.push(`⚠ ERODED: ${auth.distinguishes.length} of ${substantive} substantive citations distinguish this authority.`);
    }
    if (f.overreliedContested) {
      parts.push(`⚠ OVERRELIED + CONTESTED: ${auth.authority.nodeIds.length} nodes depend on this authority, and it is interpretively contested.`);
    }
    if (f.stale) {
      parts.push('⚠ STALE: Older cases support this authority but recent cases increasingly distinguish or undermine it.');
    }
    if (f.uncitedCounterAuthorities.length > 0) {
      parts.push(`⚠ UNCITED COUNTER-AUTHORITIES (not mentioned in the document):`);
      for (const name of f.uncitedCounterAuthorities) {
        parts.push(`  - ${name}`);
      }
    }
    parts.push('');

    if (auth.supports.length > 0) {
      parts.push('SUPPORTING:');
      for (const s of auth.supports.slice(0, 3)) {
        parts.push(`  ${s.citingCase}${s.date ? ` (${s.date.substring(0, 4)})` : ''}: ${s.explanation}`);
      }
    }

    if (auth.undermines.length > 0) {
      parts.push('UNDERMINING:');
      for (const u of auth.undermines.slice(0, 3)) {
        parts.push(`  ${u.citingCase}${u.date ? ` (${u.date.substring(0, 4)})` : ''}: ${u.explanation}`);
      }
    }

    if (auth.distinguishes.length > 0) {
      parts.push('DISTINGUISHED:');
      for (const d of auth.distinguishes.slice(0, 3)) {
        parts.push(`  ${d.citingCase}${d.date ? ` (${d.date.substring(0, 4)})` : ''}: ${d.explanation}`);
      }
    }

    parts.push('');
  }

  return parts.join('\n');
}

function computeFlags(
  janusFaced: boolean,
  substantiveCount: number,
  contestedCount: number,
  distinguishCount: number,
  nodeCount: number,
  undermines: ClassifiedCitation[],
  distinguishes: ClassifiedCitation[],
  allClassified: ClassifiedCitation[],
): InterpretiveFlags {
  // Eroded: ≥30% DISTINGUISHES among substantive citations
  const eroded = substantiveCount > 0 && (distinguishCount / substantiveCount) >= 0.3;

  // Overrelied + contested: ≥3 dependent nodes AND ≥25% contested
  const overreliedContested = nodeCount >= 3 && substantiveCount > 0 &&
    (contestedCount / substantiveCount) >= 0.25;

  // Uncited counter-authorities: cases that UNDERMINE or DISTINGUISH and aren't in the document
  const uncitedCounterAuthorities: string[] = [];
  const seen = new Set<string>();
  for (const c of [...undermines, ...distinguishes]) {
    if (c.inDocument === false && !seen.has(c.citingCase)) {
      seen.add(c.citingCase);
      uncitedCounterAuthorities.push(c.citingCase);
    }
  }

  // Stale: pre-2020 mostly SUPPORTS, post-2020 mostly DISTINGUISHES/UNDERMINES
  let stale = false;
  const pre2020 = allClassified.filter(c => c.date && new Date(c.date).getFullYear() < 2020);
  const post2020 = allClassified.filter(c => c.date && new Date(c.date).getFullYear() >= 2020);
  if (post2020.length >= 2) {
    const pre2020Supports = pre2020.filter(c => c.treatment === 'SUPPORTS').length;
    const post2020Contrary = post2020.filter(c => c.treatment === 'UNDERMINES' || c.treatment === 'DISTINGUISHES').length;
    stale = pre2020.length > 0 && pre2020Supports > pre2020.length / 2 &&
            post2020Contrary > post2020.length / 2;
  }

  return { janusFaced, eroded, overreliedContested, uncitedCounterAuthorities, stale };
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
