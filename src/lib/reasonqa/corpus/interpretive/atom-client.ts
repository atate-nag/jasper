// Search Find Case Law Atom feed for cases citing a given authority.

import type { SearchHit } from './types';

const BASE_URL = 'https://caselaw.nationalarchives.gov.uk';

export async function searchCaseLaw(
  query: string,
  maxResults: number = 10,
): Promise<SearchHit[]> {
  const url = `${BASE_URL}/atom.xml?query=${encodeURIComponent(query)}&per_page=${maxResults}&order=-date`;
  console.log(`[interpretive] Searching: ${url}`);

  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/atom+xml, application/xml' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.warn(`[interpretive] Search returned ${res.status}`);
      return [];
    }
    const xml = await res.text();
    return parseAtomFeed(xml);
  } catch (err) {
    console.warn(`[interpretive] Search failed:`, err instanceof Error ? err.message : err);
    return [];
  }
}

function parseAtomFeed(xml: string): SearchHit[] {
  const results: SearchHit[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
  let match;

  while ((match = entryRegex.exec(xml)) !== null) {
    const entry = match[1];

    const titleMatch = entry.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    // URI extraction priority:
    // 1. <link rel="alternate" type="application/akn+xml" href="..."> — direct XML link with NCN path
    // 2. <link rel="alternate" href="..."> without type — NCN-based URL
    // 3. <id> tag — UUID-based (fallback, often 404s for data.xml)
    const aknMatch = entry.match(/<link[^>]*type="application\/akn\+xml"[^>]*href="([^"]+)"/i)
      || entry.match(/<link[^>]*href="([^"]+)"[^>]*type="application\/akn\+xml"/i);
    const plainAltMatch = entry.match(/<link\s+href="([^"]+)"\s+rel="alternate"\s*\/>/i);
    const idMatch = entry.match(/<id[^>]*>([\s\S]*?)<\/id>/i);

    const rawUri = aknMatch?.[1] || plainAltMatch?.[1] || idMatch?.[1] || '';
    // Normalise to relative URI, strip /data.xml if present
    const uri = rawUri
      .replace('https://caselaw.nationalarchives.gov.uk/', '')
      .replace(/\/data\.xml$/, '')
      .replace(/^id\//, '')
      .trim();

    const dateMatch = entry.match(/<published[^>]*>([\s\S]*?)<\/published>/i)
      || entry.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i);
    const date = dateMatch ? dateMatch[1].trim() : '';

    if (title && uri) {
      results.push({ title, uri, date });
    }
  }

  console.log(`[interpretive] Search returned ${results.length} results`);
  return results;
}
