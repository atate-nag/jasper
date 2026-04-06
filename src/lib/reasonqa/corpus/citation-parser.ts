// Parse legal citations from node citation sources into structured lookup targets.

import type { ParsedCitation } from './types';

// ── NCN regex ────────────────────────────────────────────────
// Matches: [2025] EWHC 2755 (Ch), [2024] EWCA Civ 24, [2023] UKSC 10
const NCN_RE = /\[(\d{4})\]\s+(UKSC|UKPC|UKHL|EWCA\s+(?:Civ|Crim)|EWHC|EWCC|UKUT|UKFTT)\s+(\d+)(?:\s+\((\w+)\))?/i;

// Court code mapping: NCN court string → National Archives URI segment
const COURT_MAP: Record<string, string> = {
  'uksc': 'uksc',
  'ukpc': 'ukpc',
  'ukhl': 'ukhl',
  'ewca civ': 'ewca/civ',
  'ewca crim': 'ewca/crim',
  'ewhc': 'ewhc',
  'ewcc': 'ewcc',
  'ukut': 'ukut',
  'ukftt': 'ukftt',
};

// EWHC division mapping: parenthetical → URI segment
const EWHC_DIV_MAP: Record<string, string> = {
  'ch': 'ewhc/ch',
  'kb': 'ewhc/kb',
  'qb': 'ewhc/kb',  // Queen's Bench → King's Bench
  'fam': 'ewhc/fam',
  'admin': 'ewhc/admin',
  'comm': 'ewhc/comm',
  'tcc': 'ewhc/tcc',
  'pat': 'ewhc/pat',
  'admlty': 'ewhc/admlty',
  'ipec': 'ewhc/ipec',
  'scco': 'ewhc/scco',
};

// ── Statute lookup ───────────────────────────────────────────
const STATUTE_LOOKUP: Record<string, { type: string; year: number; chapter: number }> = {
  'companies act 2006': { type: 'ukpga', year: 2006, chapter: 46 },
  'insolvency act 1986': { type: 'ukpga', year: 1986, chapter: 45 },
  'limitation act 1980': { type: 'ukpga', year: 1980, chapter: 58 },
  'senior courts act 1981': { type: 'ukpga', year: 1981, chapter: 54 },
  'supreme court act 1981': { type: 'ukpga', year: 1981, chapter: 54 },
  'human rights act 1998': { type: 'ukpga', year: 1998, chapter: 42 },
  'equality act 2010': { type: 'ukpga', year: 2010, chapter: 15 },
  'employment rights act 1996': { type: 'ukpga', year: 1996, chapter: 18 },
  'communications act 2003': { type: 'ukpga', year: 2003, chapter: 21 },
  'wireless telegraphy act 2006': { type: 'ukpga', year: 2006, chapter: 36 },
  'european union (withdrawal) act 2018': { type: 'ukpga', year: 2018, chapter: 16 },
  'data protection act 2018': { type: 'ukpga', year: 2018, chapter: 12 },
  'consumer rights act 2015': { type: 'ukpga', year: 2015, chapter: 15 },
  'sale of goods act 1979': { type: 'ukpga', year: 1979, chapter: 54 },
  'partnership act 1890': { type: 'ukpga', year: 1890, chapter: 39 },
  'law of property act 1925': { type: 'ukpga', year: 1925, chapter: 20 },
  'theft act 1968': { type: 'ukpga', year: 1968, chapter: 60 },
  'fraud act 2006': { type: 'ukpga', year: 2006, chapter: 35 },
  'misrepresentation act 1967': { type: 'ukpga', year: 1967, chapter: 7 },
  'unfair contract terms act 1977': { type: 'ukpga', year: 1977, chapter: 50 },
  'arbitration act 1996': { type: 'ukpga', year: 1996, chapter: 23 },
  'civil procedure rules 1998': { type: 'uksi', year: 1998, chapter: 3132 },
  'financial services and markets act 2000': { type: 'ukpga', year: 2000, chapter: 8 },
  'competition act 1998': { type: 'ukpga', year: 1998, chapter: 41 },
  'enterprise act 2002': { type: 'ukpga', year: 2002, chapter: 40 },
  'landlord and tenant act 1954': { type: 'ukpga', year: 1954, chapter: 56 },
  'housing act 1988': { type: 'ukpga', year: 1988, chapter: 50 },
  'town and country planning act 1990': { type: 'ukpga', year: 1990, chapter: 8 },
  'children act 1989': { type: 'ukpga', year: 1989, chapter: 41 },
  'matrimonial causes act 1973': { type: 'ukpga', year: 1973, chapter: 18 },
  'police and criminal evidence act 1984': { type: 'ukpga', year: 1984, chapter: 60 },
  'criminal justice act 2003': { type: 'ukpga', year: 2003, chapter: 44 },
  'proceeds of crime act 2002': { type: 'ukpga', year: 2002, chapter: 29 },
  'bribery act 2010': { type: 'ukpga', year: 2010, chapter: 23 },
  'contract (rights of third parties) act 1999': { type: 'ukpga', year: 1999, chapter: 31 },
};

// Statute section regex: "s.172" or "section 172" or "s 172(1)(a)" or "s.901G"
const SECTION_RE = /(?:s\.?|section)\s*(\d+[A-Z]?)(?:\([\d]+\)(?:\([a-z]\))?)?/i;

// Schedule regex: "Schedule 8 [39(7)]" or "Schedule 1, paragraph 4" or "Schedule 1 [4]"
const SCHEDULE_RE = /schedule\s+(\d+)(?:\s*[\[\(,]\s*(?:paragraph\s*)?(\d+))?/i;

// Paragraph citation: "at [37]" or "¶16" or "para 37"
const PARA_RE = /(?:at\s+)\[(\d+)\]|¶(\d+)|(?:para(?:graph)?\.?\s*)(\d+)/i;

// Generic statute pattern: "Act Name YYYY" with optional section
const GENERIC_STATUTE_RE = /([A-Z][\w\s()]+Act)\s+(\d{4})/i;

export function parseCitation(raw: string): ParsedCitation {
  if (!raw) return { raw, type: 'unknown' };

  // Extract paragraph reference
  const paraMatch = raw.match(PARA_RE);
  const paragraph = paraMatch ? (paraMatch[1] || paraMatch[2] || paraMatch[3]) : undefined;

  // Try NCN first
  const ncnMatch = raw.match(NCN_RE);
  if (ncnMatch) {
    const year = parseInt(ncnMatch[1]);
    const courtRaw = ncnMatch[2].toLowerCase();
    const number = parseInt(ncnMatch[3]);
    const division = ncnMatch[4]?.toLowerCase();

    let court: string;
    if (courtRaw === 'ewhc' && division && EWHC_DIV_MAP[division]) {
      court = EWHC_DIV_MAP[division];
    } else {
      court = COURT_MAP[courtRaw] || courtRaw;
    }

    const uri = `${court}/${year}/${number}`;

    return {
      raw,
      type: 'case',
      ncn: ncnMatch[0],
      court,
      year,
      number,
      uri,
      paragraph,
    };
  }

  // Try statute lookup
  const lc = raw.toLowerCase();
  for (const [name, info] of Object.entries(STATUTE_LOOKUP)) {
    if (lc.includes(name)) {
      const sectionMatch = raw.match(SECTION_RE);
      const scheduleMatch = raw.match(SCHEDULE_RE);
      const section = sectionMatch?.[1];
      const scheduleNum = scheduleMatch?.[1];
      const schedulePara = scheduleMatch?.[2];

      let legislationUri: string;
      if (scheduleNum) {
        // Schedule reference: schedule/N or schedule/N/paragraph/M
        legislationUri = schedulePara
          ? `${info.type}/${info.year}/${info.chapter}/schedule/${scheduleNum}/paragraph/${schedulePara}`
          : `${info.type}/${info.year}/${info.chapter}/schedule/${scheduleNum}`;
      } else if (section) {
        legislationUri = `${info.type}/${info.year}/${info.chapter}/section/${section}`;
      } else {
        legislationUri = `${info.type}/${info.year}/${info.chapter}`;
      }

      return {
        raw,
        type: 'statute',
        actName: name,
        actType: info.type,
        actYear: info.year,
        actChapter: info.chapter,
        section: section || (scheduleNum ? `sch${scheduleNum}` : undefined),
        legislationUri,
        paragraph,
      };
    }
  }

  // Try generic statute pattern (Act Name YYYY) for unknown statutes
  const genericMatch = raw.match(GENERIC_STATUTE_RE);
  if (genericMatch) {
    const sectionMatch = raw.match(SECTION_RE);
    return {
      raw,
      type: 'statute',
      actName: `${genericMatch[1]} ${genericMatch[2]}`,
      actYear: parseInt(genericMatch[2]),
      section: sectionMatch?.[1],
      paragraph,
    };
  }

  return { raw, type: 'unknown', paragraph };
}

export function extractCitations(
  nodes: Array<{ citationStatus: string; citationSource?: string }>,
): ParsedCitation[] {
  return nodes
    .filter(n => n.citationStatus === 'Ext' && n.citationSource)
    .map(n => parseCitation(n.citationSource!))
    .filter(c => c.type !== 'unknown');
}
