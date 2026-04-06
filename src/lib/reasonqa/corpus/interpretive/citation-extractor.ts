// Fetch judgment XML and extract paragraphs mentioning a given authority.

import type { CitationWindow } from './types';

const BASE_URL = 'https://caselaw.nationalarchives.gov.uk';

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function extractCitationWindows(
  judgmentUri: string,
  authorityName: string,
  citingCaseTitle: string,
  maxWindows: number = 3,
): Promise<CitationWindow[]> {
  const url = `${BASE_URL}/${judgmentUri}/data.xml`;

  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/xml' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.log(`[interpretive]   Fetch: ${judgmentUri} FAILED (HTTP ${res.status})`);
      return [];
    }
    const xml = await res.text();
    console.log(`[interpretive]   Fetch: ${judgmentUri} OK (${xml.length} chars)`);
    const windows = findCitationParagraphs(xml, authorityName, citingCaseTitle, judgmentUri, maxWindows);
    if (windows.length > 0) {
      console.log(`[interpretive]   Extract: ${judgmentUri} → ${windows.length} windows`);
    } else {
      console.log(`[interpretive]   Extract: ${judgmentUri} → 0 windows (no mention of "${authorityName}" found)`);
    }
    return windows;
  } catch (err) {
    console.log(`[interpretive]   Fetch: ${judgmentUri} FAILED (${err instanceof Error ? err.message : err})`);
    return [];
  }
}

function findCitationParagraphs(
  xml: string,
  authorityName: string,
  citingCaseTitle: string,
  judgmentUri: string,
  maxWindows: number,
): CitationWindow[] {
  // Split XML into paragraphs
  const paragraphs: string[] = [];

  // Try <paragraph> blocks first (LegalDocML)
  const paraRegex = /<paragraph[^>]*>([\s\S]*?)<\/paragraph>/gi;
  let match;
  while ((match = paraRegex.exec(xml)) !== null) {
    const text = stripTags(match[1]);
    if (text.length > 20) paragraphs.push(text);
  }

  // Fallback to <p> blocks
  if (paragraphs.length === 0) {
    const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    while ((match = pRegex.exec(xml)) !== null) {
      const text = stripTags(match[1]);
      if (text.length > 20) paragraphs.push(text);
    }
  }

  if (paragraphs.length === 0) return [];

  // Search for paragraphs mentioning the authority
  // Try multiple patterns: full name, short name, ref tags with href
  const searchTerms = buildSearchTerms(authorityName);
  const hitIndices: number[] = [];

  for (let i = 0; i < paragraphs.length; i++) {
    const lc = paragraphs[i].toLowerCase();
    for (const term of searchTerms) {
      if (lc.includes(term.toLowerCase())) {
        hitIndices.push(i);
        break;
      }
    }
  }

  if (hitIndices.length === 0) return [];

  // Build 3-paragraph windows around each hit, dedup overlapping windows
  const windows: CitationWindow[] = [];
  const usedIndices = new Set<number>();

  for (const idx of hitIndices) {
    if (usedIndices.has(idx)) continue;
    if (windows.length >= maxWindows) break;

    const start = Math.max(0, idx - 1);
    const end = Math.min(paragraphs.length - 1, idx + 1);
    const windowText = paragraphs.slice(start, end + 1).join('\n\n');

    for (let i = start; i <= end; i++) usedIndices.add(i);

    windows.push({
      citingCase: citingCaseTitle,
      citingCaseUri: judgmentUri,
      paragraphs: windowText,
    });
  }

  return windows;
}

function buildSearchTerms(authorityName: string): string[] {
  const terms: string[] = [authorityName];

  // "X v Bedfordshire" → also search for just "Bedfordshire"
  const vMatch = authorityName.match(/\bv\s+(.+)/i);
  if (vMatch) terms.push(vMatch[1].trim());

  // First word of multi-word name
  const parts = authorityName.split(/\s+/);
  if (parts.length > 1 && parts[0].length > 3) {
    terms.push(parts[0]);
  }

  return terms;
}
