# ReasonQA — Live Interpretive Context Retrieval: CC Build Brief

## Date: 6 April 2026

---

## What This Is

A live retrieval layer that searches Find Case Law for cases citing the same authorities as the document under analysis, fetches the relevant paragraphs, and classifies whether they support or undermine the propositions in the document. This detects Janus-faced evidence — where the same authority supports opposite conclusions — without requiring a pre-built citation graph or the computational analysis licence.

This is the feature that closes the gap between the manual three-pass pipeline (which caught the Janus-faced node on Bedfordshire) and the automated pipeline (which missed it entirely).

---

## How It Works

### Trigger

After Pass 2 (edge construction), the pipeline has a list of reasoning edges with their source citations. For each edge that cites an external authority, the retrieval layer runs.

### Step 1: Extract searchable authority references

From Pass 1/2 output, extract every externally cited authority. For each, construct a search query.

Examples from Edge v Ofcom:
- P045/P046 cite "X v Bedfordshire" → search query: `"Bedfordshire" "breach of statutory duty"`
- P051/P052 cite "Energy Solutions" → search query: `"Energy Solutions" "Francovich"`  
- P023 cites "Recall Support Services" → search query: `"Recall" "Francovich" "Authorisation Directive"`
- P019 cites s.104 CA 2003 → search query: `"section 104" "Communications Act"`

Query construction rules:
- Case name: use the most distinctive party name in quotes (e.g. "Bedfordshire" not "X v Bedfordshire County Council" — shorter queries return more results)
- Add 1-2 topical terms from the proposition the authority is cited for (e.g. "breach of statutory duty", "Francovich", "damages")
- Keep queries to 3-5 terms maximum — Find Case Law search is simple keyword matching, not semantic

### Step 2: Search Find Case Law Atom feed

```
GET https://caselaw.nationalarchives.gov.uk/atom.xml?query={query}&per_page=10&order=-date
```

Returns up to 10 most recent judgments containing those terms. Each entry includes:
- Title (case name)
- ID (document URI)
- Published date
- Updated date

Rate limit: 1,000 requests per 5 minutes. At ~5-10 authorities per document, this is 5-10 requests — negligible.

**No licence required.** This is individual API usage under the Open Justice Licence, not bulk computational analysis.

### Step 3: Fetch judgment XML and extract citation paragraphs

For each search result, fetch the judgment XML:

```
GET https://caselaw.nationalarchives.gov.uk/{uri}/data.xml
```

Parse the XML. Find all `<ref>` tags that reference the authority being investigated. Extract the paragraph (`<p>` or `<block>`) containing each `<ref>` tag, plus the preceding and following paragraphs for context. This gives 3-paragraph windows around each mention of the authority.

**Important:** The feasibility test showed that `uk:cite` and `canonicalForm` attributes were absent from the Energy Solutions XML. The `<ref>` tags exist (42 were found) but may use `href` attributes or just contain the citation text inline. The parser needs to handle multiple markup patterns:

```python
# Pattern 1: ref with uk:canonical attribute
<ref uk:canonical="[2004] UKHL 15" ...>Gorringe v Calderdale</ref>

# Pattern 2: ref with href to Find Case Law
<ref href="https://caselaw.nationalarchives.gov.uk/ukhl/2004/15" ...>Gorringe</ref>

# Pattern 3: ref with href="#" (unresolvable, non-neutral citation)
<ref href="#" ...>[1995] 2 AC 633</ref>

# Pattern 4: plain text mention (no ref tag — older or less enriched XML)
# Fall back to text search for the authority name within paragraph text
```

### Step 4: LLM classification of citation treatment

For each 3-paragraph window, send to Haiku with a structured prompt:

```
You are analysing how a court applied a legal authority.

THE AUTHORITY: {authority_name} {authority_citation}

THE PROPOSITION IT IS CITED FOR IN THE DOCUMENT UNDER ANALYSIS:
{proposition_from_document}

THE CITING CASE: {citing_case_name} {citing_case_citation}

PARAGRAPHS FROM THE CITING CASE WHERE THE AUTHORITY IS DISCUSSED:
{paragraph_window}

Question: Does this citing case use {authority_name} to SUPPORT or UNDERMINE the proposition that "{proposition_from_document}"?

Answer with one of:
- SUPPORTS: The citing case applies the authority in a way consistent with the proposition
- UNDERMINES: The citing case applies the authority in a way that contradicts or limits the proposition
- DISTINGUISHES: The citing case acknowledges the authority but finds it inapplicable on different facts
- NEUTRAL: The citing case mentions the authority but does not clearly support or undermine the proposition
- IRRELEVANT: The mention is not substantively related to the proposition

Then explain in 2-3 sentences why.
```

Cost: Haiku on ~500 tokens input + ~100 tokens output = negligible. At 10 results × 5 authorities × 2 mentions average = ~100 Haiku calls per document analysis. Maybe £0.01-0.02 total.

### Step 5: Assemble interpretive context for Pass 3

Group the classified citations by authority and by treatment:

```json
{
  "authority": "X v Bedfordshire [1995] 2 AC 633",
  "proposition": "breach of statutory duty does not give rise to private law cause of action",
  "citing_cases": {
    "supports": [
      {
        "case": "Gorringe v Calderdale [2004] UKHL 15",
        "paragraph": "...",
        "explanation": "Applied Bedfordshire strictly — held that where statute provides framework, no common law duty arises"
      }
    ],
    "undermines": [
      {
        "case": "Phelps v Hillingdon [2001] 2 AC 619",
        "paragraph": "...",
        "explanation": "Distinguished Bedfordshire — held that individual professionals can owe duty of care despite statutory framework"
      }
    ]
  },
  "janus_faced": true  // authorities found on BOTH sides
}
```

If an authority has citing cases on both sides → flag as **JANUS-FACED** and include in Pass 3 corpus.

### Step 6: Feed into Pass 3

The interpretive context goes into Pass 3's prompt alongside the existing citation verification corpus:

```
INTERPRETIVE CONTEXT:

The following authorities cited in the document have been applied by
subsequent courts in ways that both support AND undermine the propositions
they are cited for:

AUTHORITY: X v Bedfordshire [1995] 2 AC 633
CITED FOR: "breach of statutory duty does not give rise to private law cause of action"

SUPPORTING: Gorringe v Calderdale [2004] UKHL 15 — [extracted paragraphs]
UNDERMINING: Phelps v Hillingdon [2001] 2 AC 619 — [extracted paragraphs]

For each Janus-faced authority, assess whether the document acknowledges
the counter-reading. If the document presents only one interpretation as
settled when courts have gone both ways, flag as JANUS-FACED evidence.
```

---

## Independent Testability

Same requirement as the earlier brief — must be testable without running the full pipeline.

### CLI commands

```bash
# Search for cases citing an authority and classify treatment
reasonqa corpus:search --authority "Bedfordshire" --proposition "breach of statutory duty does not give rise to private law cause of action" --topical-terms "breach statutory duty"

# Search only (no LLM classification — just see what comes back)
reasonqa corpus:search --authority "Bedfordshire" --topical-terms "breach statutory duty" --search-only

# Classify a specific judgment's treatment of an authority
reasonqa corpus:classify --judgment-uri "uksc/2023/52" --authority "Bedfordshire" --proposition "breach of statutory duty does not give rise to private law cause of action"

# Run the full interpretive context retrieval on a Pass 2 output
reasonqa corpus:context --input pass2-output.json --output interpretive-context.json

# Run on a Pass 2 output, search-only mode (no LLM, just show search results)
reasonqa corpus:context --input pass2-output.json --search-only
```

The `--search-only` flag is critical for rapid iteration. It shows you what the Atom feed returns for each authority without spending tokens on classification. This is how you refine query construction — run it, see if the right cases come back, adjust the query terms, run again.

### Test fixtures

Save the search results and classification outputs from Edge v Ofcom and Poundland as fixtures:

```
tests/fixtures/
  edge-v-ofcom/
    search-results/
      bedfordshire.json        # raw Atom feed results
      energy-solutions.json
      recall.json
    classification/
      bedfordshire-supports.json
      bedfordshire-undermines.json
    interpretive-context.json  # full assembled context
    expected-janus-faced.json  # ground truth: which authorities should be flagged
```

Ground truth for Edge v Ofcom: Bedfordshire should be flagged as Janus-faced. The test passes if the system finds citing cases on both sides and flags it.

---

## File Structure

```
apps/reasonqa/src/
  corpus/
    search/
      atom-client.ts           — Find Case Law Atom feed search
      query-builder.ts         — construct search queries from authority references
      xml-parser.ts            — fetch and parse judgment XML, extract citation paragraphs
      types.ts                 — SearchResult, JudgmentParagraph, etc.
    classification/
      treatment-classifier.ts  — Haiku LLM call to classify citation treatment
      prompt.ts                — classification prompt template
      types.ts                 — TreatmentType enum (SUPPORTS/UNDERMINES/DISTINGUISHES/NEUTRAL/IRRELEVANT)
    context/
      assembler.ts             — group by authority, detect Janus-faced, format for Pass 3
      types.ts                 — InterpretiveContext, JanusFacedAuthority
    cli/
      corpus-commands.ts       — CLI handlers
    __tests__/
      search.test.ts
      classifier.test.ts
      assembler.test.ts
      fixtures/
```

---

## Integration with Pipeline

### Where it runs

After Pass 2, in parallel with existing citation verification (Layer A):

```
Pass 2 output
  ├─ Layer A: Citation verification (existing — fetch cited sources, verify accuracy)
  ├─ Layer B: Interpretive context retrieval (NEW — search for citing cases, classify treatment)
  ↓
Pass 3: Verification against full corpus (citations + interpretive context)
```

### What changes in Pass 3

Add the interpretive context section to the Pass 3 prompt (as specified in Step 6 above). Pass 3 now has three categories of source material:

1. **Cited sources** (from Layer A) — statute text and case law the document cites
2. **Interpretive context** (from Layer B) — cases citing the same authorities, classified by treatment
3. **Source document** — the document under analysis

### Performance impact

- Search: 5-10 Atom feed requests (~1-2 seconds each) = 10-20 seconds
- XML fetch: 5-10 judgment XMLs per authority × 5 authorities = 25-50 fetches (~1-2 seconds each) = 30-60 seconds
- LLM classification: ~100 Haiku calls (~0.5 seconds each) = 50 seconds
- **Total: ~2-3 minutes added to the pipeline**

This runs in parallel with Pass 2 → Pass 3 handoff, so effective addition to total pipeline time is ~2 minutes (the LLM calls are the bottleneck and can't be parallelised with the search/fetch).

### Filtering to avoid noise

Not every authority needs interpretive context retrieval. Only retrieve for:

1. **Authorities on critical reasoning chains** (depth ≥ 4) — skip background citations
2. **Authorities supporting Value or Method nodes** — these are the interpretive claims. Factual citations to statute text don't need treatment classification.
3. **Maximum 5 authorities per analysis** — the 5 most structurally important. More than this adds cost and time without proportional value.

---

## What This Replaces

This brief supersedes the "Interpretive Context Retrieval" brief from earlier in this session for the MVP. The pattern table approach (curated interpretive patterns with pre-mapped authorities) becomes a **fallback and validation layer** rather than the primary mechanism:

- If live search finds citing cases on both sides → Janus-faced detection works
- If live search returns no useful results (e.g. the authority is too obscure or the search terms are wrong) → fall back to pattern table if the interpretive move matches a known pattern
- As the corpus citation graph is built (Track 2, post-licence), it progressively replaces live search with faster, more complete graph lookups

---

## Success Criteria

Run the updated pipeline on Edge v Ofcom with live interpretive context retrieval enabled:

1. The system searches for cases citing Bedfordshire and finds results (the feasibility test already confirmed this returns 50+ cases)
2. Among those results, at least one case is classified as UNDERMINES the "no private action" proposition (Phelps, Barrett, or similar)
3. At least one case is classified as SUPPORTS (Gorringe, or similar)
4. Bedfordshire is flagged as JANUS-FACED
5. The Janus-faced finding appears in the Pass 3 output as a HIGH severity issue

If all five criteria are met, the core product thesis is validated in the automated pipeline — the system catches what the manual analysis caught, without the judgment as ground truth.
