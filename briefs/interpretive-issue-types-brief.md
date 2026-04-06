# ReasonQA — Interpretive Issue Types: CC Brief

## Date: 6 April 2026

---

## Problem

The interpretive context retrieval works. The Bedfordshire search found 10 cases, Haiku classified them (7 SUPPORTS, 1 UNDERMINES, 3 DISTINGUISHES, 4 NEUTRAL), the assembler flagged Bedfordshire as JANUS-FACED, and Pass 3 received the context and used it — labelling P050-P054 as "JANUS-FACED AUTHORITY" in citation verifications and noting "courts have applied it on both sides" in corrections.

But the finding doesn't appear as an issue in the Issues section. The Issues list has 10 items, all typed as `missing_warrant`, `unsupported_conclusion`, or `qualifier_mismatch`. There is no `janus_faced_evidence` issue type. The finding is scattered across citation verifications, corrections, and reasoning chain counterarguments instead of being a headline finding.

This is a presentation problem, not a detection problem. Fix it by adding five interpretive issue types to the Pass 3 prompt and the issue taxonomy.

---

## Five New Issue Types

All five use data already collected by the interpretive context retrieval layer. The classification categories (SUPPORTS, UNDERMINES, DISTINGUISHES, NEUTRAL, IRRELEVANT) don't change. The assembly logic computes these patterns from classification results and passes them to Pass 3 as structured flags alongside the interpretive context paragraphs.

### 1. `janus_faced_evidence`

**Trigger:** Assembly flags an authority as JANUS-FACED (cases on both SUPPORTS and UNDERMINES sides).

**Severity:** HIGH when the authority is on a critical chain (depth ≥ 4). MEDIUM otherwise.

**Pass 3 instruction:**
```
When the interpretive context flags an authority as JANUS-FACED, create
an issue with type "janus_faced_evidence". The issue should:
- Name the authority and the proposition it's cited for
- Name the citing case(s) that UNDERMINE the proposition, with a
  one-sentence explanation of how
- Name the citing case(s) that SUPPORT the proposition
- State whether the document acknowledges the counter-reading
- If the document doesn't acknowledge it: the fix is to engage with
  the counter-authority and explain why the supportive reading is preferred
```

**Example from Edge v Ofcom:**
```
[HIGH] janus_faced_evidence:
X v Bedfordshire [1995] 2 AC 633 is cited for the proposition that breach
of statutory duty does not give rise to a private law cause of action.
However, subsequent courts have applied Bedfordshire on both sides: DFX v
Coventry City Council [2021] EWHC 1382 (QB) states it "has been superseded
and is no longer good law" in the child protection context. The document
does not acknowledge the contested status of this authority.
Fix: Acknowledge that Bedfordshire has been distinguished in subsequent
case law and explain why it remains applicable in the regulatory/spectrum
context specifically.
Nodes: P050, P051, P052, P053, P054
```

### 2. `eroded_authority`

**Trigger:** DISTINGUISHES ≥ 30% of non-NEUTRAL/IRRELEVANT classifications for an authority.

**Severity:** MEDIUM.

**Pass 3 instruction:**
```
When the interpretive context shows an authority has been DISTINGUISHED
in 30% or more of substantive citing cases, create an issue with type
"eroded_authority". The authority's scope is narrower than a blanket
citation implies. This is different from janus_faced — eroded means
"this used to be broader than it is now," not "this could go either way."
- Name the authority
- State the percentage of distinguishing cases
- Name 1-2 of the most significant distinguishing cases
- State whether the document acknowledges the limited scope
```

### 3. `overrelied_contested`

**Trigger:** Authority supports ≥ 3 nodes on critical chains AND has DISTINGUISHES + UNDERMINES ≥ 25% of substantive classifications.

**Severity:** HIGH.

**Pass 3 instruction:**
```
When an authority is both structurally load-bearing (supports 3+ nodes
on critical chains) AND interpretively contested (25%+ of citing cases
distinguish or undermine it), create an issue with type
"overrelied_contested". This is the most dangerous combination: the
argument collapses if the authority doesn't hold, and the authority is
under pressure.
- Name the authority and the nodes that depend on it
- State the structural dependency (how many nodes, which chains)
- State the interpretive contest (% distinguished/undermined)
- The fix is either to diversify the evidential base (find independent
  support for the dependent nodes) or to engage with the counter-authority
```

### 4. `uncited_counter_authority`

**Trigger:** A case classified as UNDERMINES or DISTINGUISHES does not appear anywhere in the document under analysis.

**Severity:** MEDIUM.

**Pass 3 instruction:**
```
When the interpretive context includes a case that UNDERMINES or
DISTINGUISHES the cited authority, and that case is not mentioned
anywhere in the document being analysed, create an issue with type
"uncited_counter_authority". This is the most directly actionable
finding — the document misses a case a competent opponent would cite.
- Name the counter-authority (full case name and citation)
- Name the authority it distinguishes/undermines
- One sentence on how the counter-authority was applied
- The fix is to cite the counter-authority and address it
```

**Example:**
```
[MEDIUM] uncited_counter_authority:
DFX v Coventry City Council [2021] EWHC 1382 (QB) distinguishes X v
Bedfordshire in the context of local authority duties, stating it "has
been superseded and is no longer good law." The document does not cite
or address DFX v Coventry.
Fix: Cite DFX v Coventry and explain why it does not affect the
application of Bedfordshire in the regulatory/spectrum context.
Nodes: P050
```

### 5. `stale_authority`

**Trigger:** Split classifications by date. If pre-2020 cases are majority SUPPORTS and post-2020 cases are majority DISTINGUISHES/UNDERMINES, the authority is trending away from the document's reading.

**Severity:** LOW when < 3 post-2020 contrary cases. MEDIUM when ≥ 3.

**Pass 3 instruction:**
```
When the interpretive context shows a temporal pattern — older cases
support the authority's application and recent cases distinguish or
undermine it — create an issue with type "stale_authority". The
authority is losing ground over time.
- Name the authority
- State the trend (e.g. "3 of 4 post-2020 cases distinguish this authority")
- Name the most recent contrary case
- The fix is to acknowledge the trend and argue why the authority
  remains applicable despite it
```

---

## Assembly Logic Changes

The interpretive context assembler currently produces:

```json
{
  "authority": "X v Bedfordshire [1995] 2 AC 633",
  "janus_faced": true,
  "classifications": {
    "supports": [...],
    "undermines": [...],
    "distinguishes": [...],
    "neutral": [...]
  }
}
```

Add computed flags for each issue type:

```json
{
  "authority": "X v Bedfordshire [1995] 2 AC 633",
  "proposition": "breach of statutory duty does not...",
  "nodes_citing": ["P050", "P051", "P052", "P053", "P054"],
  "on_critical_chain": true,
  "classifications": {
    "supports": [
      { "case": "Gorringe v Calderdale [2004] UKHL 15", "uri": "ukhl/2004/15", "paragraph": "..." },
      ...
    ],
    "undermines": [
      { "case": "DFX v Coventry [2021] EWHC 1382 (QB)", "uri": "ewhc/qb/2021/1382", "paragraph": "...", "in_document": false }
    ],
    "distinguishes": [
      { "case": "Suresh v GMC [2025] EWHC 804 (KB)", "uri": "ewhc/kb/2025/804", "paragraph": "...", "in_document": false, "date": "2025-04-03" },
      { "case": "Poole v GN [2019] UKSC 25", "uri": "uksc/2019/25", "paragraph": "...", "in_document": false, "date": "2019-06-06" },
      ...
    ],
    "neutral": [...]
  },
  "flags": {
    "janus_faced": true,
    "eroded": true,                    // 3 DISTINGUISHES out of 11 substantive = 27% (close to threshold)
    "overrelied_contested": true,      // 5 nodes + 36% contested
    "uncited_counter_authorities": [
      "DFX v Coventry City Council [2021] EWHC 1382 (QB)",
      "Suresh v GMC [2025] EWHC 804 (KB)",
      "Poole Borough Council v GN [2019] UKSC 25"
    ],
    "stale": true                      // pre-2020: mostly SUPPORTS; post-2020: mostly DISTINGUISHES
  }
}
```

The `in_document` field (boolean) requires checking whether the citing case name appears in the original document text. This is a string search, not an LLM call.

The `date` field comes from the Atom feed entry's `<published>` element, already available.

---

## Pass 3 Prompt Changes

Add a section after the existing citation verification and interpretive context instructions:

```
## Interpretive Issue Detection

The interpretive context includes computed flags for each authority.
When flags are present, create corresponding issues in the Issues section.

Available flags and corresponding issue types:
- janus_faced → janus_faced_evidence (HIGH if on critical chain, else MEDIUM)
- eroded → eroded_authority (MEDIUM)
- overrelied_contested → overrelied_contested (HIGH)
- uncited_counter_authorities → uncited_counter_authority (MEDIUM, one issue per uncited case)
- stale → stale_authority (LOW if < 3 recent contrary, MEDIUM if ≥ 3)

For each flag, create ONE issue in the Issues section using the templates
above. Do NOT scatter the finding across citation verifications only.
The issue must appear in the Issues list as a named, typed finding.

It is fine to ALSO annotate the relevant citation verifications with
"JANUS-FACED AUTHORITY" or similar — but the Issues list is the primary
location for the finding.
```

---

## Summary Generator Change

The summary should reference interpretive findings. Add to the summary generation instruction:

```
If any authority is flagged as janus_faced or overrelied_contested,
mention this in the summary as a key weakness. Example: "The memo
relies heavily on X v Bedfordshire, which has been applied by subsequent
courts to reach opposite conclusions — a fact the memo does not
acknowledge."
```

---

## Deduplication

Multiple flags can fire for the same authority (Bedfordshire triggered all five in the Edge example). Don't create five separate issues for the same authority. Instead:

- If `janus_faced` AND `overrelied_contested` both fire → create one `overrelied_contested` issue (it subsumes Janus-faced + adds the structural dependency dimension). Severity: HIGH.
- If `janus_faced` AND `eroded` both fire → create one `janus_faced_evidence` issue that notes the erosion pattern.
- `uncited_counter_authority` is always a separate issue per uncited case — these are individually actionable ("cite this specific case").
- `stale_authority` is only created if no higher-severity flag (janus_faced, overrelied_contested) already fired for the same authority.

Priority order: `overrelied_contested` > `janus_faced_evidence` > `eroded_authority` > `stale_authority`. For a given authority, create the highest-priority applicable issue plus any `uncited_counter_authority` issues.

---

## Test

Re-run Edge v Ofcom. The Issues section should now include:

1. A `janus_faced_evidence` or `overrelied_contested` issue for Bedfordshire (HIGH)
2. At least one `uncited_counter_authority` issue naming DFX v Coventry (MEDIUM)
3. These should appear in the Issues list alongside the existing structural issues

The total issue count should increase from 10 to at least 12.
