// Fetch source material from National Archives (case law) and legislation.gov.uk.

import { getSupabaseAdmin } from '@/lib/supabase';
import type { ParsedCitation, FetchedSource } from './types';
import {
  extractTextFromLegalDocML,
  extractParagraphsFromLegalDocML,
  extractTextFromCLML,
} from './xml-extract';

const CASE_LAW_BASE = 'https://caselaw.nationalarchives.gov.uk';
const LEGISLATION_BASE = 'https://www.legislation.gov.uk';
const FETCH_DELAY_MS = 300; // ~3 req/s — well within rate limits

async function checkCache(citationRaw: string): Promise<FetchedSource | null> {
  const { data } = await getSupabaseAdmin()
    .from('source_cache')
    .select('*')
    .eq('citation_raw', citationRaw)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (!data) return null;

  return {
    citation: { raw: citationRaw, type: data.citation_type as 'case' | 'statute' },
    found: data.found,
    text: data.text_content || undefined,
    paragraphs: data.paragraphs || undefined,
    url: data.source_url,
    fetchedAt: new Date(data.fetched_at),
  };
}

async function writeCache(
  citation: ParsedCitation,
  source: FetchedSource,
): Promise<void> {
  const expiryDays = citation.type === 'statute' ? 7 : 30;
  const expiresAt = new Date(Date.now() + expiryDays * 86400000).toISOString();

  await getSupabaseAdmin()
    .from('source_cache')
    .upsert({
      citation_raw: citation.raw,
      citation_type: citation.type,
      source_uri: citation.uri || citation.legislationUri || '',
      source_url: source.url,
      found: source.found,
      text_content: source.text || null,
      paragraphs: source.paragraphs || null,
      fetched_at: new Date().toISOString(),
      expires_at: expiresAt,
    }, { onConflict: 'citation_raw' });
}

async function fetchUrl(url: string): Promise<{ ok: boolean; text: string }> {
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/xml, text/xml, text/html' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { ok: false, text: '' };
    return { ok: true, text: await res.text() };
  } catch (err) {
    console.warn(`[corpus] Fetch failed for ${url}:`, err instanceof Error ? err.message : err);
    return { ok: false, text: '' };
  }
}

export async function fetchCaseLaw(citation: ParsedCitation): Promise<FetchedSource> {
  const url = `${CASE_LAW_BASE}/${citation.uri}/data.xml`;

  // Check cache
  const cached = await checkCache(citation.raw);
  if (cached) {
    console.log(`[corpus] Cache hit: ${citation.raw}`);
    return { ...cached, citation };
  }

  console.log(`[corpus] Fetching case: ${url}`);
  const { ok, text: xml } = await fetchUrl(url);

  if (ok && xml) {
    const text = extractTextFromLegalDocML(xml);
    const paragraphs = extractParagraphsFromLegalDocML(xml);
    const source: FetchedSource = {
      citation,
      found: true,
      text,
      paragraphs: Object.keys(paragraphs).length > 0 ? paragraphs : undefined,
      url: `${CASE_LAW_BASE}/${citation.uri}`,
      fetchedAt: new Date(),
    };
    await writeCache(citation, source);
    console.log(`[corpus] Case retrieved: ${citation.raw} (${Object.keys(paragraphs).length} paragraphs)`);
    return source;
  }

  const notFound: FetchedSource = {
    citation,
    found: false,
    url,
    fetchedAt: new Date(),
  };
  await writeCache(citation, notFound);
  console.log(`[corpus] Case not found: ${citation.raw}`);
  return notFound;
}

export async function fetchLegislation(citation: ParsedCitation): Promise<FetchedSource> {
  if (!citation.legislationUri) {
    return { citation, found: false, url: '', fetchedAt: new Date() };
  }

  const url = `${LEGISLATION_BASE}/${citation.legislationUri}/data.xml`;

  // Check cache
  const cached = await checkCache(citation.raw);
  if (cached) {
    console.log(`[corpus] Cache hit: ${citation.raw}`);
    return { ...cached, citation };
  }

  console.log(`[corpus] Fetching legislation: ${url}`);
  const { ok, text: xml } = await fetchUrl(url);

  if (ok && xml) {
    const text = extractTextFromCLML(xml);
    const source: FetchedSource = {
      citation,
      found: true,
      text,
      url: `${LEGISLATION_BASE}/${citation.legislationUri}`,
      fetchedAt: new Date(),
    };
    await writeCache(citation, source);
    console.log(`[corpus] Legislation retrieved: ${citation.raw}`);
    return source;
  }

  const notFound: FetchedSource = {
    citation,
    found: false,
    url,
    fetchedAt: new Date(),
  };
  await writeCache(citation, notFound);
  console.log(`[corpus] Legislation not found: ${citation.raw}`);
  return notFound;
}

export async function fetchAllSources(
  citations: ParsedCitation[],
): Promise<FetchedSource[]> {
  // Deduplicate by resolved URL (not raw text) — s.8(1) and s.8(3) both
  // resolve to the same /section/8 endpoint, no need to fetch twice.
  const seenUrls = new Set<string>();
  const unique: ParsedCitation[] = [];
  const skipped: ParsedCitation[] = [];

  for (const c of citations) {
    const resolvedUrl = c.type === 'case' ? c.uri : c.legislationUri;
    if (!resolvedUrl) {
      skipped.push(c);
      continue;
    }
    if (seenUrls.has(resolvedUrl)) continue;
    // Skip whole-act fetches (no section) — the XML is huge and not useful
    if (c.type === 'statute' && !c.section) {
      console.log(`[corpus] Skipping whole-act fetch (no section): ${c.raw}`);
      skipped.push(c);
      continue;
    }
    seenUrls.add(resolvedUrl);
    unique.push(c);
  }

  console.log(`[corpus] Fetching ${unique.length} unique sources (${skipped.length} skipped, deduped from ${citations.length})`);
  const fetchedResults: FetchedSource[] = [];

  for (let i = 0; i < unique.length; i++) {
    const citation = unique[i];
    if (citation.type === 'case' && citation.uri) {
      fetchedResults.push(await fetchCaseLaw(citation));
    } else if (citation.type === 'statute' && citation.legislationUri) {
      fetchedResults.push(await fetchLegislation(citation));
    }
    // Rate limit delay between requests
    if (i < unique.length - 1) {
      await new Promise(resolve => setTimeout(resolve, FETCH_DELAY_MS));
    }
  }

  // Map deduplicated results back to all citations that share the same URL
  const urlToSource = new Map<string, FetchedSource>();
  for (const r of fetchedResults) {
    const url = r.citation.type === 'case' ? r.citation.uri : r.citation.legislationUri;
    if (url) urlToSource.set(url, r);
  }

  const allResults: FetchedSource[] = [];
  for (const c of citations) {
    const url = c.type === 'case' ? c.uri : c.legislationUri;
    if (url && urlToSource.has(url)) {
      allResults.push({ ...urlToSource.get(url)!, citation: c });
    } else {
      // Skipped or unresolvable — include as not-found so it shows in the report
      allResults.push({ citation: c, found: false, url: '', fetchedAt: new Date() });
    }
  }

  const found = allResults.filter(r => r.found).length;
  console.log(`[corpus] Result: ${found} found, ${allResults.length - found} not found, ${allResults.length} total`);
  return allResults;
}

const MAX_CORPUS_CHARS = 40_000; // ~10k tokens — keep Pass 3 input manageable

export function assembleSourceCorpus(fetchedSources: FetchedSource[]): string {
  if (fetchedSources.length === 0) return '';

  const parts: string[] = ['SOURCE MATERIALS FOR CITATION VERIFICATION:'];

  for (const source of fetchedSources) {
    if (source.found) {
      parts.push(`\n--- ${source.citation.raw} ---`);
      parts.push(`Source: ${source.url}`);
      parts.push('Status: RETRIEVED\n');

      // If a specific paragraph was cited and we have paragraph data, show it + context
      if (source.citation.paragraph && source.paragraphs) {
        const cited = source.citation.paragraph;
        const citedNum = parseInt(cited);

        if (source.paragraphs[cited]) {
          parts.push(`Cited paragraph [${cited}]:\n${source.paragraphs[cited]}`);
          // Include 2 paragraphs either side for context
          for (const offset of [-2, -1, 1, 2]) {
            const nearby = String(citedNum + offset);
            if (source.paragraphs[nearby]) {
              parts.push(`\nParagraph [${nearby}]:\n${source.paragraphs[nearby]}`);
            }
          }
        } else {
          // Paragraph not found — include truncated full text
          parts.push(source.text?.substring(0, 3000) || '[text extraction failed]');
        }
      } else {
        // No specific paragraph — include truncated full text
        parts.push(source.text?.substring(0, 3000) || '[text extraction failed]');
      }
    } else {
      parts.push(`\n--- ${source.citation.raw} ---`);
      parts.push('Status: NOT FOUND');
      parts.push('This citation could not be retrieved from National Archives or legislation.gov.uk.');
      parts.push('It may be too recent, from an uncovered court, or incorrectly cited.');
    }
  }

  let corpus = parts.join('\n');
  if (corpus.length > MAX_CORPUS_CHARS) {
    corpus = corpus.substring(0, MAX_CORPUS_CHARS) + '\n\n[Source corpus truncated to fit context window]';
  }
  return corpus;
}
