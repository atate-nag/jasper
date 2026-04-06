// Build search queries for Find Case Law Atom feed from Pass 1/2 authority references.

import type { ClaimNode, Edge } from '../../types';
import type { AuthorityRef } from './types';

const MAX_AUTHORITIES = 5;

// Detect whether a citation is a statute (not case law).
// Statutes don't have citation networks — they're verified by Layer A, not Layer B.
const STATUTE_PATTERNS = [
  /^section\s/i,
  /^s\.\s?\d/i,
  /^part\s+\d/i,
  /\bAct\s+\d{4}\b/,
  /\bRegulations?\s+\d{4}\b/i,
  /\bDirective\s+\d{4}\b/i,
  /\bOrder\s+\d{4}\b/i,
  /\bSchedule\s+\d/i,
  /\bArticle\s+\d/i,
];

function isStatuteCitation(raw: string): boolean {
  // If it contains "v" it's a case, even if it also mentions an Act
  if (/\bv\s+/i.test(raw) || /\bRe\s+/i.test(raw)) return false;
  return STATUTE_PATTERNS.some(p => p.test(raw));
}

// Generic government defendants — drop these from search queries since
// they add noise without distinctiveness. "Recall v DCMS" → just "Recall".
const GENERIC_DEFENDANTS = [
  'dcms', 'hmrc', 'secretary of state', 'home department', 'the commissioners',
  'commissioner', 'information commissioner', 'the crown', 'united kingdom',
  'ministry of', 'department of', 'department for',
];

function cleanPartyName(name: string): string {
  return name
    .replace(/\s*(&\s*(Ors|Anor|Others))\s*/gi, '')
    .replace(/\s*(Ltd|Limited|Plc|Inc|LLP|EU)\s*/gi, '')
    .replace(/\s*(Re|In re)\s*/gi, '')
    .replace(/\s*\(.*?\)\s*/g, '')
    .trim()
    .split(/\s+/).slice(0, 3).join(' ');
}

// Extract the most distinctive search name from a case citation.
// Returns a single distinctive party name for search — NOT the full "X v Y".
function extractCaseName(raw: string): string | null {
  // Strip citation brackets first: [2013] EWHC 3091 (Ch), [1995] 2 AC 633
  const stripped = raw.replace(/\[?\d{4}\]?\s*\w+\s*\d+\s*(\(\w+\))?/g, '').trim();

  const vMatch = stripped.match(/([A-Z][\w\s&]*?)\s+v\.?\s+([A-Z][\w\s&]+?)$/);
  if (vMatch) {
    const p1 = cleanPartyName(vMatch[1]);
    const p2 = cleanPartyName(vMatch[2]);

    const p1Lc = p1.toLowerCase();
    const p2Lc = p2.toLowerCase();
    const p1Generic = GENERIC_DEFENDANTS.some(g => p1Lc.includes(g)) || p1.length <= 2;
    const p2Generic = GENERIC_DEFENDANTS.some(g => p2Lc.includes(g)) || p2.length <= 2;

    // Prefer the non-generic party; if neither generic, prefer the longer (more distinctive)
    if (p2Generic && !p1Generic) return p1;
    if (p1Generic && !p2Generic) return p2;
    return p1.length >= p2.length ? p1 : p2;
  }

  const reMatch = stripped.match(/\bRe\s+([A-Z][\w\s]+?)$/);
  if (reMatch) return cleanPartyName(reMatch[1]);

  // First capitalised multi-word
  const nameMatch = raw.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/);
  return nameMatch ? cleanPartyName(nameMatch[1]) : null;
}

// Extract 1-2 topical terms from the proposition, deduplicating against the case name.
function extractTopicalTerms(proposition: string, caseName: string | null): string[] {
  const lc = proposition.toLowerCase();
  const caseNameLc = (caseName || '').toLowerCase();

  // Legal domain keywords to prioritise
  const legalTerms = [
    'breach of statutory duty', 'Francovich', 'damages', 'negligence',
    'duty of care', 'judicial review', 'misfeasance', 'ultra vires',
    'legitimate expectation', 'proportionality', 'human rights',
    'discrimination', 'unfair dismissal', 'breach of contract',
    'fiduciary duty', 'unjust enrichment', 'limitation', 'estoppel',
    'misrepresentation', 'constructive trust', 'statutory interpretation',
    'private law', 'public law', 'tort', 'restitution',
    'procurement', 'state aid', 'competition', 'insolvency',
  ];

  const found: string[] = [];
  for (const term of legalTerms) {
    if (lc.includes(term.toLowerCase())) {
      // Skip if the term already appears in the case name (avoids duplication)
      if (caseNameLc.includes(term.toLowerCase())) continue;
      found.push(term);
      if (found.length >= 2) break;
    }
  }

  // If no legal terms found, extract distinctive noun phrases
  if (found.length === 0) {
    const words = proposition.split(/\s+/)
      .filter(w => w.length > 5 && /^[a-z]/i.test(w))
      // Exclude words that appear in the case name
      .filter(w => !caseNameLc.includes(w.toLowerCase()));
    words.sort((a, b) => b.length - a.length);
    found.push(...words.slice(0, 2).map(w => w.toLowerCase()));
  }

  return found;
}

export function buildAuthorityRefs(
  nodes: ClaimNode[],
  edges: Edge[],
): AuthorityRef[] {
  // Find nodes on reasoning chains (not orphans) with external citations
  // that support Value or Method nodes
  const reasoningTargets = new Set<string>();
  for (const e of edges) {
    if (e.type === 'E') continue;
    reasoningTargets.add(e.toId);
  }

  // Group nodes by citation source
  const authorityMap = new Map<string, {
    nodeIds: string[];
    propositions: string[];
    types: Set<string>;
    onChain: boolean;
  }>();

  for (const node of nodes) {
    if (node.citationStatus !== 'Ext' || !node.citationSource) continue;
    // Skip statutes — they don't have citation networks, Layer A handles them
    if (isStatuteCitation(node.citationSource)) continue;

    const key = node.citationSource;
    const existing = authorityMap.get(key) || {
      nodeIds: [],
      propositions: [],
      types: new Set(),
      onChain: false,
    };
    existing.nodeIds.push(node.id);
    existing.propositions.push(node.text);
    existing.types.add(node.type);
    if (reasoningTargets.has(node.id)) existing.onChain = true;
    authorityMap.set(key, existing);
  }

  // Filter: prefer authorities on chains supporting V/M nodes
  const allCandidates = [...authorityMap.entries()]
    .map(([raw, data]) => ({
      raw,
      ...data,
      score: (data.onChain ? 10 : 0) +
             (data.types.has('V') ? 5 : 0) +
             (data.types.has('M') ? 3 : 0) +
             data.nodeIds.length,
    }))
    .sort((a, b) => b.score - a.score);

  // Log selected authorities
  const candidates = allCandidates.slice(0, MAX_AUTHORITIES);
  console.log(`[interpretive] ── Selected authorities (${candidates.length}/${allCandidates.length}) ──`);
  for (const c of candidates) {
    console.log(`[interpretive]   ✓ score=${c.score} onChain=${c.onChain} types=[${[...c.types].join(',')}] nodes=[${c.nodeIds.join(',')}] "${c.raw}"`);
  }

  // Log filtered-out authorities
  const filtered = allCandidates.slice(MAX_AUTHORITIES);
  if (filtered.length > 0) {
    console.log(`[interpretive] ── Filtered authorities (below threshold) ──`);
    for (const c of filtered) {
      const reasons = [];
      if (!c.onChain) reasons.push('not on chain');
      if (!c.types.has('V') && !c.types.has('M')) reasons.push(`${[...c.types].join(',')}-type only`);
      console.log(`[interpretive]   score=${c.score} "${c.raw}" (${reasons.join(', ') || 'lower score'})`);
    }
  }

  return candidates.map(c => {
    const caseName = extractCaseName(c.raw);
    const topical = extractTopicalTerms(c.propositions[0], caseName);
    const queryParts = [
      caseName ? `"${caseName}"` : null,
      ...topical.map(t => `"${t}"`),
    ].filter(Boolean);

    const query = queryParts.join(' ');
    console.log(`[interpretive]   "${c.raw}" → query=${query}`);

    return {
      name: caseName || c.raw,
      citation: c.raw,
      proposition: c.propositions[0],
      nodeIds: c.nodeIds,
      searchQuery: query,
    };
  }).filter(a => a.searchQuery.length > 0);
}
