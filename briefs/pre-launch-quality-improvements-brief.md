# ReasonQA — Pre-Launch Quality Improvements: CC Brief

## Date: 6 April 2026

---

Four targeted fixes to improve report quality before launch. All independent — can be done in any order or in parallel.

---

## 1. Query Construction Fixes

### Problem

The interpretive context retrieval wastes API calls and misses authorities due to three query construction issues visible in the Edge v Ofcom logs.

### Issue A: Statutes going through interpretive retrieval

"Section 5 Communications Act 2003" triggered a search that returned entirely irrelevant results (family law, tax, pensions). 10 cases fetched, 18 Haiku classifications, every single one IRRELEVANT. Statute references should never go through interpretive retrieval — they don't have citation networks. The citation verification layer already fetches and checks statute text.

**Fix:** In the query builder, filter out authorities that are statute/legislation references before constructing search queries. Detection: if the authority string starts with "Section" or "Schedule" or "Article" or "Part" or matches a pattern like `s.\d+` or contains "Act \d{4}" or "Regulations \d{4}" without a case name, it's a statute. Skip it.

```typescript
function isStatuteReference(authority: string): boolean {
  const statutePatterns = [
    /^Section\s/i,
    /^Schedule\s/i,
    /^Article\s/i,
    /^Part\s/i,
    /^s\.\d/i,
    /Act\s+\d{4}/,
    /Regulations\s+\d{4}/,
    /Directive\s+\d{4}/,
    /Order\s+\d{4}/,
  ];
  // Only skip if there's NO case name pattern (v Something)
  const hasCaseName = /\bv\b/.test(authority) || /\bRe\b/.test(authority);
  if (hasCaseName) return false;
  return statutePatterns.some(p => p.test(authority));
}
```

### Issue B: Case name queries too specific

"Recall Support v DCMS" in quotes returned 0 results. The full party name with "v" in quotes is too restrictive for Find Case Law's keyword search. Judgments may refer to the case as "Recall Support Services" or "Recall" without the "v DCMS" formulation.

**Fix:** Extract the most distinctive single party name, not the full "X v Y" citation. Use the shorter, more distinctive party as the primary search term.

```typescript
function extractSearchName(authority: string): string {
  // Strip citation brackets: [2013] EWHC 3091 (Ch)
  const withoutCitation = authority.replace(/\[?\d{4}\]?\s*\w+\s*\d+\s*(\(\w+\))?/g, '').trim();
  
  // Split on " v " or " v. "
  const parties = withoutCitation.split(/\s+v\.?\s+/i);
  
  if (parties.length >= 2) {
    // Pick the more distinctive party (longer name, or non-generic)
    const generic = ['secretary of state', 'commissioners', 'hmrc', 'the crown'];
    const [p1, p2] = parties.map(p => p.trim());
    
    // Prefer the party that isn't generic government
    if (generic.some(g => p2.toLowerCase().includes(g))) return cleanPartyName(p1);
    if (generic.some(g => p1.toLowerCase().includes(g))) return cleanPartyName(p2);
    
    // Otherwise pick the longer one (more distinctive)
    return cleanPartyName(p1.length >= p2.length ? p1 : p2);
  }
  
  // No "v" — use first few distinctive words
  return cleanPartyName(withoutCitation);
}

function cleanPartyName(name: string): string {
  // Strip common suffixes
  return name
    .replace(/\s*(Ltd|Limited|Plc|Inc|LLP|&\s*(Ors|Anor|Others))\s*/gi, '')
    .replace(/\s*(Re|In re)\s*/gi, '')
    .trim();
}
```

For Edge v Ofcom examples:
- "Recall Support Services v DCMS [2013] EWHC 3091 (Ch)" → search name: "Recall Support Services"
- "X (minors) v Bedfordshire County Council [1995] 2 AC 633" → search name: "Bedfordshire County Council"
- "Energy Solutions EU Ltd v Nuclear Decommissioning Authority [2017] UKSC 34" → search name: "Energy Solutions"

### Issue C: Redundant topical terms

"Nuclear Decommissioning" "decommissioning" "implemented" has "decommissioning" effectively appearing twice. The topical terms should come from the proposition, not from the authority name.

**Fix:** After extracting the search name from the authority, construct topical terms exclusively from the proposition text. Don't include words that already appear in the search name.

```typescript
function buildQuery(searchName: string, proposition: string, maxTopicalTerms: number = 2): string {
  // Extract candidate terms from proposition
  const stopwords = new Set(['the', 'a', 'an', 'in', 'of', 'for', 'that', 'which', 'was', 'is', 'are', 'were', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'not', 'and', 'or', 'but', 'to', 'from', 'by', 'with', 'at', 'on', 'under', 'this', 'it', 'its']);
  const nameWords = new Set(searchName.toLowerCase().split(/\s+/));
  
  const terms = proposition
    .split(/\s+/)
    .map(w => w.replace(/[^a-zA-Z]/g, '').toLowerCase())
    .filter(w => w.length > 3 && !stopwords.has(w) && !nameWords.has(w));
  
  // Pick the most distinctive terms (least common in general English)
  // Simple heuristic: longer words are more distinctive
  const ranked = [...new Set(terms)].sort((a, b) => b.length - a.length);
  const topical = ranked.slice(0, maxTopicalTerms);
  
  // Build query: quoted search name + quoted topical terms
  return `"${searchName}" ${topical.map(t => `"${t}"`).join(' ')}`;
}
```

### Expected impact

- Eliminates ~20 wasted Haiku calls per analysis (the statute searches)
- Improves hit rate on case law authorities (Recall should return results)
- Reduces total retrieval time by ~30 seconds (fewer irrelevant fetches)
- May surface additional counter-authorities for currently-missed searches

### Estimated time: 2-3 hours

---

## 2. Source-Document Grounding Category

### Problem

Both Edge v Ofcom (24 UNGROUNDED) and Poundland (30 UNGROUNDED) have many factual claims flagged UNGROUNDED that are actually drawn from the document under analysis. "Poundland operates approximately 800 discount retail stores" is grounded — it's grounded in the source document. Flagging it as UNGROUNDED alongside genuinely unsupported evaluative conclusions is misleading.

The chain grounding percentages suffer: P064 in Poundland shows 35% grounded when the factual foundation is solid. The problem is classification, not analysis quality.

### Fix

Add `SOURCE_DOCUMENT` as a verification status alongside VERIFIED, PARTIAL, UNGROUNDED, UNTRACEABLE, FAILED.

**Definition:** A claim is SOURCE_DOCUMENT when it restates or reports information from the document being analysed, rather than citing an external authority. The claim is grounded in the source material, but the source material is the document itself, not an external authoritative source.

**Detection:** In Pass 1, when extracting nodes, if a Factual claim has no external citation (Citation_Presence = None) AND is a background/definitional/procedural claim derived from the document's own stated facts, tag it as SOURCE_DOCUMENT rather than UNGROUNDED.

The simplest implementation: add guidance to the Pass 3 prompt.

```
VERIFICATION STATUS — SOURCE_DOCUMENT:

When verifying F nodes with no external citation, assess whether the 
claim restates information from the source document (the document being 
analysed). If the claim reports a fact, figure, date, party identification, 
deal term, or procedural event that is stated in the source document, 
assign status SOURCE_DOCUMENT.

SOURCE_DOCUMENT means: "this claim is grounded in the document under 
analysis, not in an external authority." It is distinct from UNGROUNDED, 
which means "this claim has no identified evidential basis."

Examples:
- "Poundland operates approximately 800 stores" → SOURCE_DOCUMENT 
  (factual premise from the case materials)
- "Edge filed its Claim Form on 27 April 2022" → SOURCE_DOCUMENT 
  (procedural fact from the case)
- "The court should dismiss the claim" → UNGROUNDED 
  (evaluative conclusion, not a restated fact)
- "Section 8(4) imposes a mandatory duty" → VERIFIED or PARTIAL 
  (externally cited and checkable)
```

**Grounding score treatment:** SOURCE_DOCUMENT counts as grounded for chain grounding calculations. The claim has an identified source — it's the document itself. This is the same as how internal citations (Int:) are treated.

**Report display:** In the citation verifications section, SOURCE_DOCUMENT nodes get a brief note: "Factual premise from source document." No lengthy verification narrative needed. This dramatically shortens the citation verification section — instead of 30 individual "UNGROUNDED — factual claim about X with no citation, drawn from case materials" entries, you get 30 one-line "SOURCE_DOCUMENT" entries.

**Structural metrics:** Add to the report structure section:

```
Verification
  Verified: 35
  Partial: 7
  Source document: 24        ← NEW
  Failed: 0
  Ungrounded: 6              ← now only genuinely unsupported claims
```

This makes the verification stats dramatically more useful. 6 genuinely ungrounded claims is a meaningful number. 30 was noise.

### Estimated time: 2-3 hours (prompt update + report rendering change)

---

## 3. Schedule-Level Legislation Retrieval

### Problem

Both test cases fail to retrieve legislation provisions at the schedule/paragraph level:

```
[S1] NOT FOUND: Section 901G(3) Companies Act 2006
[S2] NOT FOUND: Section 901G(5) Companies Act 2006
[S13] NOT FOUND: European Union Withdrawal Act 2018, Schedule 1 [4]
[S14] NOT FOUND: European Union Withdrawal Act 2018, Schedule 8 [39(7)]
```

Two distinct sub-problems:

### Issue A: Inserted sections (s.901G)

Section 901G of the Companies Act 2006 was inserted by the Corporate Insolvency and Governance Act 2020. The legislation.gov.uk URL for it is:

```
https://www.legislation.gov.uk/ukpga/2006/46/section/901G/data.xml
```

Note the capital G. The citation parser is likely constructing the URL with a lowercase g or failing to handle the letter suffix. Legislation.gov.uk is case-sensitive on section identifiers for inserted sections.

**Fix:** The citation parser needs to:
1. Preserve the exact case of section numbers when constructing URLs
2. Handle section numbers with letter suffixes (901A, 901B, 901C... 901G)

```typescript
function buildLegislationUrl(act: string, provision: string): string {
  // Map common act names to legislation.gov.uk identifiers
  const actMap: Record<string, string> = {
    'Companies Act 2006': 'ukpga/2006/46',
    'Communications Act 2003': 'ukpga/2003/21',
    'Wireless Telegraphy Act 2006': 'ukpga/2006/36',
    'Limitation Act 1980': 'ukpga/1980/58',
    'European Union (Withdrawal) Act 2018': 'ukpga/2018/16',
    // Add more as needed
  };
  
  const actPath = actMap[act];
  if (!actPath) return null;
  
  // Handle different provision types
  // "Section 901G(3)" → section/901G  (preserve case, strip subsection for URL)
  // "Schedule 1 [4]" → schedule/1/paragraph/4
  // "Schedule 8 [39(7)]" → schedule/8/paragraph/39
  
  const sectionMatch = provision.match(/^[Ss]ection\s+(\d+[A-Z]?)/i);
  if (sectionMatch) {
    const sectionId = sectionMatch[1]; // preserves "901G" as-is
    return `https://www.legislation.gov.uk/${actPath}/section/${sectionId}/data.xml`;
  }
  
  const scheduleMatch = provision.match(/^[Ss]chedule\s+(\d+)\s*[\[\(](\d+)/i);
  if (scheduleMatch) {
    const schedNum = scheduleMatch[1];
    const paraNum = scheduleMatch[2];
    return `https://www.legislation.gov.uk/${actPath}/schedule/${schedNum}/paragraph/${paraNum}/data.xml`;
  }
  
  // Fallback: try section-level
  const numberMatch = provision.match(/(\d+[A-Z]?)/);
  if (numberMatch) {
    return `https://www.legislation.gov.uk/${actPath}/section/${numberMatch[1]}/data.xml`;
  }
  
  return null;
}
```

### Issue B: Schedule paragraphs

"Schedule 8, paragraph 39(7)" of the EU(W)A 2018 needs the URL:

```
https://www.legislation.gov.uk/ukpga/2018/16/schedule/8/paragraph/39/data.xml
```

The citation parser likely doesn't handle the `schedule/N/paragraph/N` URL pattern at all. It may be trying to construct a section-level URL which doesn't exist.

**Fix:** The `buildLegislationUrl` function above handles this. The regex `schedule/N [N]` maps to the correct URL pattern.

### Issue C: Whole-act references

The logs show several skips:

```
[corpus] Skipping whole-act fetch (no section): Communications Act 2003
[corpus] Skipping whole-act fetch (no section): European Union (Withdrawal) Act 2018, Schedule 1 [4]
```

The second line is wrong — "Schedule 1 [4]" IS a specific provision, not a whole-act reference. The citation parser is failing to recognise it as a fetchable reference.

**Fix:** The parser needs to recognise "Schedule N [N]" and "Schedule N, paragraph N" as specific provisions, not whole-act references. Adjust the "is this a specific provision?" check:

```typescript
function isSpecificProvision(citation: string): boolean {
  return /[Ss]ection\s+\d/i.test(citation) ||
         /[Ss]chedule\s+\d/i.test(citation) ||
         /[Aa]rticle\s+\d/i.test(citation) ||
         /[Rr]egulation\s+\d/i.test(citation) ||
         /[Pp]aragraph\s+\d/i.test(citation) ||
         /s\.\d/i.test(citation);
}
```

### Test

After fixing, re-run Edge v Ofcom and Poundland. Check:
- s.901G(3) and s.901G(5) → should return RETRIEVED with the statutory text
- Schedule 1 [4] EU(W)A → should return RETRIEVED
- Schedule 8 [39(7)] EU(W)A → should return RETRIEVED
- s.5 CA 2003 and s.104 CA 2003 → should still work (regression check)

### Estimated time: 3-4 hours (parser fixes + testing across both cases)

---

## 4. DAG Visualisation in Reports

### Problem

The interactive DAG component works in the web view but the PDF report doesn't include it. The earlier DAG visualisation brief specified that PDF export of the DAG is deferred — but since the component exists and works, wiring it into the report is worthwhile before launch.

### Two options

**Option A: Static SVG render in PDF (proper)**

The DAG layout engine (dagre/elk) computes node positions. Render to a static SVG. Embed the SVG in the PDF during report generation. This gives a clean, print-friendly DAG in the PDF.

Implementation:
1. In the report generation step (the Inngest job's final step), after computing structural metrics, run the DAG layout engine server-side
2. Render the layout to SVG string (no React needed — just SVG elements from computed positions)
3. Embed the SVG in the PDF using whatever PDF library is generating the report

The SVG should show:
- Critical chains only (same filtering as the interactive view — depth ≥ 4)
- Nodes coloured by type (F/M/V/P)
- Borders by verification status
- Issue badges on flagged nodes
- Weak link edges highlighted in red
- A legend

Size: fit to a single landscape page in the PDF. If the DAG is too large for one page, show only the single longest chain.

**Option B: Screenshot of the interactive component (quick hack)**

Use a headless browser (Puppeteer) to render the interactive DAG component and capture a PNG. Embed the PNG in the PDF. This is faster to implement but produces a raster image rather than a crisp vector, and adds a Puppeteer dependency.

**Recommendation:** Option A if the PDF is being generated by code (building the PDF programmatically). Option B if the PDF is being generated by rendering HTML to PDF via a headless browser anyway.

### Placement in the report

The DAG appears as a full-page section between the Issues list and the Claims table. Section heading: **"Reasoning Structure"**. Below the visualisation: a one-line legend explaining the colour coding and a note: "Interactive version available in your dashboard."

### Report JSON

The `report_json` field in the analyses table should include the DAG layout data so the web view and the PDF use the same layout:

```json
{
  "dag": {
    "nodes": [
      { "id": "P064", "type": "P", "status": "PARTIAL", "issues": ["overrelied_contested"], "x": 350, "y": 600 },
      ...
    ],
    "edges": [
      { "source": "P052", "target": "P064", "type": "J", "weakLink": false },
      ...
    ],
    "chains": [
      { "conclusion": "P064", "depth": 7, "grounding": 35, "path": ["P010", "P050", "P051", "P064"] }
    ]
  }
}
```

### Estimated time: 3-5 hours depending on Option A vs B and existing PDF generation approach.

---

## Summary

| Fix | Impact | Effort | Priority |
|-----|--------|--------|----------|
| Query construction | Fewer wasted calls, more authorities found | 2-3 hours | Do first |
| Source-document grounding | Honest metrics, cleaner reports | 2-3 hours | Do second |
| Legislation retrieval | 4-6 more provisions verified per report | 3-4 hours | Do third |
| DAG in reports | Visual centrepiece in PDF output | 3-5 hours | Do fourth |
| **Total** | | **10-15 hours** | |

All four can be done while waiting for ZDR. The first three improve analytical accuracy. The fourth improves presentation. After these, the report output is materially better than what you have now — fewer false UNGROUNDED flags, fewer wasted API calls, more legislation verified, and a visual DAG in every report.
