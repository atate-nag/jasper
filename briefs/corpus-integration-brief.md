# CC Brief — Legal Corpus Integration

## Overview

Connect the three-pass pipeline to authoritative legal sources so Pass 3 can automatically verify citations against the actual text of judgments and statutes. This replaces the current approach (user uploads reference documents) with automated lookup for legal documents.

## Two APIs, Two Citation Types

### 1. UK Case Law — National Archives Find Case Law

**Base URL:** `https://caselaw.nationalarchives.gov.uk`
**Licence:** Open Justice Licence (commercial use permitted, no charge)
**Rate limit:** 1,000 requests per rolling 5-minute period per IP
**Format:** LegalDocML XML

**Retrieving a case by Neutral Citation Number (NCN):**

NCNs follow a standard format: `[YEAR] COURT NUMBER`
Examples:
- `[2025] EWHC 2755 (Ch)` → URI: `ewhc/ch/2025/2755`
- `[2025] EWHC 2758 (KB)` → URI: `ewhc/kb/2025/2758`
- `[2024] EWCA Civ 24` → URI: `ewca/civ/2024/24`
- `[2023] UKSC 10` → URI: `uksc/2023/10`

**Direct XML retrieval:**
```
GET https://caselaw.nationalarchives.gov.uk/{uri}/data.xml
```

Example:
```
GET https://caselaw.nationalarchives.gov.uk/ewhc/ch/2025/2755/data.xml
```

Returns full judgment in LegalDocML XML.

**Search (when NCN is incomplete or absent):**
```
GET https://caselaw.nationalarchives.gov.uk/atom.xml?query={search_term}&court={court_code}
```

Example:
```
GET https://caselaw.nationalarchives.gov.uk/atom.xml?query=Poundland&court=ewhc/ch
```

Returns Atom feed with matching cases. Each entry contains:
- `<title>` — case name
- `<link rel="alternate" type="application/akn+xml">` — link to XML
- `<tna:identifier type="ukncn">` — the NCN
- `<published>` — handed down date

**Court codes:**

| Court | Code | Subdivisions |
|-------|------|-------------|
| Supreme Court | `uksc` | — |
| Court of Appeal (Civil) | `ewca/civ` | — |
| Court of Appeal (Criminal) | `ewca/crim` | — |
| High Court (Chancery) | `ewhc/ch` | — |
| High Court (King's Bench) | `ewhc/kb` | — |
| High Court (Family) | `ewhc/fam` | — |
| High Court (Admin) | `ewhc/admin` | — |
| High Court (Commercial) | `ewhc/comm` | — |
| High Court (TCC) | `ewhc/tcc` | — |
| County Court | `ewcc` | — |

**Coverage:** Most courts from early 2000s onwards. Not all decisions are available — some are delivered verbally and never transcribed.

### 2. UK Legislation — legislation.gov.uk

**Base URL:** `https://www.legislation.gov.uk`
**Licence:** Open Government Licence (free, commercial use permitted)
**Format:** CLML (Crown Legislation Markup Language) XML, also available as HTML

**Retrieving a specific section:**

URI pattern: `/{type}/{year}/{chapter}/section/{section}`

Legislation types:
- `ukpga` — UK Public General Act
- `uksi` — UK Statutory Instrument
- `asp` — Act of Scottish Parliament
- `wsi` — Welsh Statutory Instrument

Examples:
```
# Companies Act 2006, section 901G
GET https://www.legislation.gov.uk/ukpga/2006/46/section/901G/data.xml

# Wireless Telegraphy Act 2006, section 8
GET https://www.legislation.gov.uk/ukpga/2006/36/section/8/data.xml

# Limitation Act 1980, section 2
GET https://www.legislation.gov.uk/ukpga/1980/58/section/2/data.xml

# Communications Act 2003, section 104
GET https://www.legislation.gov.uk/ukpga/2003/21/section/104/data.xml
```

Append `/data.xml` for XML or `/data.htm` for HTML fragment.

**Point-in-time versions:**
```
# As enacted
GET https://www.legislation.gov.uk/ukpga/2006/46/section/901G/enacted/data.xml

# As at a specific date
GET https://www.legislation.gov.uk/ukpga/2006/46/section/901G/2025-01-01/data.xml
```

**Search:**
```
GET https://www.legislation.gov.uk/ukpga/data.feed?title={search_term}
```

Returns Atom feed of matching Acts.

## Integration Architecture

### Step 1: Citation Parser

After Pass 1, extract and parse all Ext-cited references.

```typescript
interface ParsedCitation {
  raw: string;              // Original text: "[2025] EWHC 2755 (Ch)"
  type: 'case' | 'statute'; // What kind of source
  // Case-specific
  ncn?: string;             // "[2025] EWHC 2755 (Ch)"
  caseName?: string;        // "Poundland" or "Re Poundland"
  court?: string;           // "ewhc/ch"
  year?: number;            // 2025
  number?: number;          // 2755
  uri?: string;             // "ewhc/ch/2025/2755"
  // Statute-specific
  actName?: string;         // "Companies Act 2006"
  actType?: string;         // "ukpga"
  actYear?: number;         // 2006
  actChapter?: number;      // 46
  section?: string;         // "901G"
  legislationUri?: string;  // "ukpga/2006/46/section/901G"
  // Common
  paragraph?: string;       // "at [37]" or "¶16"
}

function parseCitation(raw: string): ParsedCitation {
  // NCN regex: /\[(\d{4})\]\s+(UKSC|UKPC|EWCA\s+(?:Civ|Crim)|EWHC|EWCC|UKUT|UKFTT)\s+(\d+)(?:\s+\((\w+)\))?/
  // Statute regex: match common Act names to their legislation.gov.uk identifiers
  // Paragraph regex: /(?:at\s+)?\[(\d+)\]|¶(\d+)/
}
```

**Common UK statutes lookup table** (for resolving Act names to legislation.gov.uk URIs):

```typescript
const STATUTE_LOOKUP: Record<string, { type: string; year: number; chapter: number }> = {
  'Companies Act 2006': { type: 'ukpga', year: 2006, chapter: 46 },
  'Wireless Telegraphy Act 2006': { type: 'ukpga', year: 2006, chapter: 36 },
  'Communications Act 2003': { type: 'ukpga', year: 2003, chapter: 21 },
  'Limitation Act 1980': { type: 'ukpga', year: 1980, chapter: 58 },
  'European Union (Withdrawal) Act 2018': { type: 'ukpga', year: 2018, chapter: 16 },
  'Insolvency Act 1986': { type: 'ukpga', year: 1986, chapter: 45 },
  'Senior Courts Act 1981': { type: 'ukpga', year: 1981, chapter: 54 },
  'Human Rights Act 1998': { type: 'ukpga', year: 1998, chapter: 42 },
  'Equality Act 2010': { type: 'ukpga', year: 2010, chapter: 15 },
  'Employment Rights Act 1996': { type: 'ukpga', year: 1996, chapter: 18 },
  // Extend as needed — this can grow incrementally
};
```

### Step 2: Corpus Fetcher

```typescript
interface FetchedSource {
  citation: ParsedCitation;
  found: boolean;
  text?: string;           // Extracted text content
  paragraphs?: Record<string, string>;  // Paragraph number → text
  url: string;             // Source URL for attribution
  fetchedAt: Date;
}

async function fetchCaseLaw(citation: ParsedCitation): Promise<FetchedSource> {
  // 1. Try direct URI lookup
  const uri = citation.uri; // e.g. "ewhc/ch/2025/2755"
  const xmlUrl = `https://caselaw.nationalarchives.gov.uk/${uri}/data.xml`;
  
  try {
    const response = await fetch(xmlUrl);
    if (response.ok) {
      const xml = await response.text();
      const text = extractTextFromLegalDocML(xml);
      const paragraphs = extractParagraphsFromLegalDocML(xml);
      return { citation, found: true, text, paragraphs, url: xmlUrl, fetchedAt: new Date() };
    }
  } catch (e) {
    // Fall through to search
  }
  
  // 2. If direct lookup fails, search by case name
  if (citation.caseName) {
    const searchUrl = `https://caselaw.nationalarchives.gov.uk/atom.xml?query=${encodeURIComponent(citation.caseName)}`;
    const feed = await fetch(searchUrl);
    // Parse Atom feed, find matching entry, fetch XML
    // ...
  }
  
  return { citation, found: false, url: xmlUrl, fetchedAt: new Date() };
}

async function fetchLegislation(citation: ParsedCitation): Promise<FetchedSource> {
  const uri = citation.legislationUri; // e.g. "ukpga/2006/46/section/901G"
  const xmlUrl = `https://www.legislation.gov.uk/${uri}/data.xml`;
  
  try {
    const response = await fetch(xmlUrl);
    if (response.ok) {
      const xml = await response.text();
      const text = extractTextFromCLML(xml);
      return { citation, found: true, text, url: xmlUrl, fetchedAt: new Date() };
    }
  } catch (e) {
    // Legislation not found or API error
  }
  
  return { citation, found: false, url: xmlUrl, fetchedAt: new Date() };
}
```

### Step 3: XML Text Extraction

LegalDocML and CLML are both XML formats. We need to extract readable text from them.

```typescript
function extractTextFromLegalDocML(xml: string): string {
  // LegalDocML structure:
  // <akomaNtoso>
  //   <judgment>
  //     <header> ... </header>
  //     <judgmentBody>
  //       <decision>
  //         <paragraph eId="para_1">
  //           <num>1.</num>
  //           <content><p>...</p></content>
  //         </paragraph>
  //         ...
  //       </decision>
  //     </judgmentBody>
  //   </judgment>
  // </akomaNtoso>
  
  // Extract all <paragraph> elements, preserving paragraph numbers
  // Return as plain text with paragraph markers
  // Use a lightweight XML parser (e.g., fast-xml-parser)
}

function extractParagraphsFromLegalDocML(xml: string): Record<string, string> {
  // Return map of paragraph number → text content
  // e.g., { "1": "I am giving judgment...", "2": "The case before me..." }
  // This allows Pass 3 to verify claims against specific paragraphs
}

function extractTextFromCLML(xml: string): string {
  // CLML structure varies by document type
  // For sections: extract the <P1> / <P2> content
  // Return as plain text
}
```

### Step 4: Integration with Pipeline

The corpus lookup runs **between Pass 1 and Pass 3** — ideally in parallel with Pass 2.

```
Pass 1 completes → nodes with Ext citations identified
                 ↓
        ┌────────┴────────┐
        ↓                 ↓
    Pass 2 (edges)    Citation lookup (parallel)
        ↓                 ↓
        └────────┬────────┘
                 ↓
    Pass 3 (verification with fetched sources)
```

```typescript
async function runPipeline(documentText: string) {
  // Pass 1
  const nodes = await runPass1(documentText);
  
  // Extract citations from nodes
  const citations = nodes
    .filter(n => n.citation === 'Ext')
    .map(n => parseCitation(n.citationSource));
  
  // Run Pass 2 and citation lookup in parallel
  const [edges, fetchedSources] = await Promise.all([
    runPass2(nodes),
    fetchAllSources(citations)
  ]);
  
  // Compute metrics (code, not LLM)
  const metrics = computeMetrics(nodes, edges);
  
  // Pass 3 with fetched sources
  const verification = await runPass3(nodes, edges, fetchedSources);
  
  return { nodes, edges, metrics, verification };
}

async function fetchAllSources(citations: ParsedCitation[]): Promise<FetchedSource[]> {
  // Fetch all sources in parallel, respecting rate limits
  // National Archives: 1,000 requests per 5 minutes = ~3.3/second
  // legislation.gov.uk: no documented limit, be conservative (~2/second)
  
  const results: FetchedSource[] = [];
  for (const citation of citations) {
    if (citation.type === 'case') {
      results.push(await fetchCaseLaw(citation));
    } else if (citation.type === 'statute') {
      results.push(await fetchLegislation(citation));
    }
    // Small delay to respect rate limits
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  return results;
}
```

### Step 5: Pass 3 Source Material Assembly

Format the fetched sources for inclusion in the Pass 3 prompt:

```typescript
function assembleSourceCorpus(fetchedSources: FetchedSource[]): string {
  let corpus = '## SOURCE MATERIALS FOR CITATION VERIFICATION\n\n';
  
  for (const source of fetchedSources) {
    if (source.found) {
      corpus += `### ${source.citation.raw}\n`;
      corpus += `Source: ${source.url}\n`;
      corpus += `Status: RETRIEVED\n\n`;
      
      if (source.paragraphs) {
        // Include only relevant paragraphs if specific ones were cited
        const citedPara = source.citation.paragraph;
        if (citedPara && source.paragraphs[citedPara]) {
          corpus += `Cited paragraph [${citedPara}]:\n${source.paragraphs[citedPara]}\n\n`;
          // Also include surrounding paragraphs for context
          const paraNum = parseInt(citedPara);
          for (const offset of [-2, -1, 1, 2]) {
            const nearby = (paraNum + offset).toString();
            if (source.paragraphs[nearby]) {
              corpus += `Paragraph [${nearby}]:\n${source.paragraphs[nearby]}\n\n`;
            }
          }
        } else {
          // No specific paragraph cited — include full text (truncated if needed)
          corpus += source.text?.substring(0, 15000) + '\n\n';
        }
      } else {
        corpus += source.text?.substring(0, 15000) + '\n\n';
      }
    } else {
      corpus += `### ${source.citation.raw}\n`;
      corpus += `Status: NOT FOUND in National Archives / legislation.gov.uk\n`;
      corpus += `This citation could not be retrieved. It may be too recent, from a court not covered, or incorrectly cited.\n\n`;
    }
  }
  
  return corpus;
}
```

## Computational Analysis Application

The Open Justice Licence permits reuse but **does not permit computational analysis** without a separate (free) application. Since the product will programmatically search and extract content from case law, we need to apply.

**Action item:** Email `caselawlicence@nationalarchives.gov.uk` with:
- Description of the product (reasoning quality assurance tool)
- How case law will be used (citation verification — checking whether cited cases support the propositions they're cited for)
- Volume estimate (initially low — perhaps 50-100 case lookups per day)
- Confirmation of compliance with Open Justice Licence conditions

This is a free application with no documented rejection criteria. The National Archives has previously granted access to Oxford's AI for English Law project for similar purposes.

## Database Updates

Add a table for cached source lookups to avoid repeated API calls:

```sql
CREATE TABLE source_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  citation_raw TEXT NOT NULL,
  citation_type TEXT NOT NULL,  -- 'case' or 'statute'
  source_uri TEXT NOT NULL,     -- The API URI used
  source_url TEXT NOT NULL,     -- Full URL
  found BOOLEAN NOT NULL,
  text_content TEXT,            -- Extracted text
  paragraphs JSONB,            -- Paragraph map (for cases)
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
  
  UNIQUE(citation_raw)
);

-- Index for fast lookup
CREATE INDEX idx_source_cache_citation ON source_cache(citation_raw);
```

Cache cases for 30 days (judgments don't change often). Cache legislation for 7 days (amendments can occur).

## MVP vs Later

**MVP (build now):**
- Citation parser for NCNs and common UK statutes
- Direct case retrieval by constructed URI
- Direct legislation section retrieval
- Text extraction from XML
- Source corpus assembly for Pass 3
- Source cache to avoid repeated lookups

**Later:**
- Fuzzy case search (when NCN isn't available or is malformed)
- EU case law lookup (CURIA / EUR-Lex for pre-Brexit authorities)
- Scottish and Northern Irish legislation
- Statutory instrument lookup
- Law report series lookup (for cases cited by law report rather than NCN)
- Expand the statutes lookup table as new Acts are encountered
