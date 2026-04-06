# ReasonQA — Unified Coding Methodology: CC Build Brief

## Date: 6 April 2026

**Governing document:** Coding Methodology v5 DRAFT (Argumentative Architecture Coding Methodology). This brief implements the v5 changes in the ReasonQA pipeline.

**Terminology note:** v5 defines a four-pass process (Passes 1-3 are LLM calls, Pass 4 is structural annotation computed by deterministic code). The ReasonQA product and all prior briefs refer to a "three-pass pipeline" — this refers to the three LLM passes. Pass 4 (structural metrics computation) runs as code after Pass 3 and is not a separate LLM call.

---

## What Changed and Why

A cross-domain review identified two structural problems in how ReasonQA implements the Toulmin coding methodology. These aren't bugs — the pipeline works — but they lose analytical power and prevent the system from properly handling strategy documents alongside legal ones.

### Problem 1: P means two different things

The coding methodology v4 defines P as Prescriptive ("the board should do X"). The ReasonQA implementation redefined P as Procedural ("the claim was filed on 14 March"). These are completely different concepts.

Procedural claims are **factual claims about process** — verifiable, not action-recommending. They're F nodes. Filing dates, hearing listings, service dates — these report what happened. They don't prescribe action.

Meanwhile, legal documents absolutely contain genuine prescriptions: "The court should grant summary judgment." "We recommend the client accepts the offer." "The plan should be sanctioned." ReasonQA currently has no way to code these because P has been reassigned to procedural history.

The fix: **revert P to Prescriptive** across the pipeline. Code procedural facts as F nodes. Procedural facts can be distinguished from merits-based facts by a tag or coding note if needed, but they don't warrant their own node type.

### Problem 2: J is too weak

The coding methodology v4 defines J as a normative justification edge — "why should we do this?" — connecting evaluative conclusions (V) to prescriptions (P). ReasonQA weakened J to "context or background," making it barely distinguishable from a soft Support edge.

The strong J definition captures a relationship that S and W cannot: the connection between "the limitation period has expired" (V) and "the court should strike out the claim" (P). That's not S — the V node doesn't provide evidence that the P node is factually true (prescriptions aren't true or false). It's not W — the V node doesn't provide a logical principle. It's J: the evaluative conclusion provides the normative reason why the prescribed action is warranted.

The fix: **strengthen J to "normative reason why an action should be taken."** This is the v4 definition. The ReasonQA implementation drifted from it.

---

## The Unified Framework

### Node Types (fixed across all domains)

```
F (Factual)
  Definition: Verifiable claim about what is the case.
  Test: Can this be checked against evidence, data, or authoritative source?
  Strategy examples:
    - "BYD's revenue grew 33% in Q3 2025"
    - "The acquisition closed on 14 September"
    - "Three board members voted against the resolution"
  Legal examples:
    - "Section 8(4) of the WTA 2006 imposes a mandatory duty on Ofcom"
    - "Edge filed its original Claim Form on 27 April 2022"
    - "Rose J held that national security justified the restriction for COMUGs"
  Note: Procedural facts (filing dates, hearing dates, service dates) are F
  nodes, not a separate type. If useful, tag them as F[procedural] to
  distinguish from merits-based facts, but they don't get their own type.

M (Mechanism)
  Definition: The reasoning bridge — how or why evidence leads to a conclusion.
  Test: Does this node supply the inferential rule connecting evidence to claim?
  Strategy examples:
    - "Vertical integration lowers costs because the manufacturer controls
      cell production and avoids margin stacking"
    - "Network effects create winner-take-all dynamics in platform markets"
  Legal examples:
    - "The doctrine of proportionality requires the court to balance severity
      of interference against importance of the objective"
    - "Under X v Bedfordshire, breach of statutory duty gives rise to private
      action only if the duty was imposed for a limited class"
  Note: In strategy, M nodes tend to be causal mechanisms. In law, they tend
  to be interpretive rules and legal principles. Both answer "how/why does
  the evidence lead to this conclusion?" Same structural function.

V (Value / Evaluative)
  Definition: Judgement of significance, adequacy, strength, reasonableness.
  Test: Does this node assess rather than report?
  Strategy examples:
    - "This is the most consequential risk to the five-year plan"
    - "The margin compression is structural, not cyclical"
  Legal examples:
    - "The clause is commercially unreasonable"
    - "Edge's claim has no realistic prospect of success"
    - "The continuous breach argument is weakened by the nine-year delay"

P (Prescriptive)
  Definition: Action recommendation — what should be done.
  Test: Does this node recommend, direct, or propose an action?
  Strategy examples:
    - "The board should commission an independent market review"
    - "Divest the European distribution business within 18 months"
    - "Defer the acquisition until regulatory clarity improves"
  Legal examples:
    - "The court should grant summary judgment on Count III"
    - "We recommend the client accepts the Part 36 offer"
    - "The plan should be sanctioned under Part 26A"
    - "The indemnity clause should be capped at twice the contract value"
  Note: NOT procedural facts. "The claim was filed on 14 March" is F.
  "The court should dismiss the claim" is P. The distinction: F reports
  what happened, P recommends what should happen.
```

### Edge Types (fixed across all domains)

```
S (Support)
  Definition: Evidence supporting the truth of a claim.
  Direction: Source provides evidential basis for target.
  Test: Does knowing the source is true make the target more likely true?
  Example: "Revenue fell 12% in Q3" (F) --S--> "The business is in decline" (V)
  Example: "Rose J held the restriction was unjustified" (F) --S--> "The COSUGs
           claim has merit" (V)

W (Warrant)
  Definition: The logical bridge making an inference valid.
  Direction: Source provides the reasoning rule that connects evidence to conclusion.
  Test: Does this node explain WHY the evidence leads to the conclusion?
  Example: "Network effects create winner-take-all dynamics" (M) --W-->
           "The market will consolidate to 2-3 players" (V)
  Example: "Under Bedfordshire, the duty must be for a limited class" (M) --W-->
           "Section 8(4) does not give rise to private action" (V)

J (Justification)
  Definition: Normative reason why a prescription should be adopted.
  Direction: Source provides the evaluative basis for the target prescription.
  Typical direction: V→P, M→P, occasionally V→V (when one evaluative
  conclusion justifies an evaluative stance).
  Test: Does this node answer "why should we do this?"
  Note: J edges typically connect V or M nodes to P nodes. They are NOT
  the same as S.
  S connects evidence to factual/evaluative claims (truth-supporting).
  J connects evaluative conclusions to action recommendations (action-warranting).
  Example: "The margin compression is structural" (V) --J--> "Commit to
           premium positioning" (P)
  Example: "The actionability point is independently fatal" (V) --J-->
           "The court should dismiss the claim" (P)
  Example: "The limitation period has expired" (V) --J--> "The claim should
           be struck out" (P)
  Counter-example (this is S, not J):
    "Revenue fell 12%" (F) --S--> "The business is in decline" (V)
    This is evidence supporting an evaluative claim, not a normative
    reason for action.

E (Elaboration)
  Definition: Restatement or extension at the same level, adding no new
  evidential weight.
  Direction: Source restates or expands the target.
  Test: If you removed this edge, would the argument lose any evidential support?
  If no, it's E.
  Example: "BYD's Blade Battery reduces fire risk" (F) --E--> "BYD has
           developed proprietary safety technology" (F)
```

---

## Changes Required in the Pipeline

### Pass 1 Prompt

Two changes to node type definitions.

**Change 1: M label.** The prompt currently defines M as "Method." Replace with "Mechanism." No functional change — same definition, clearer label that avoids confusion with procedural claims. Per v5 §2: "Mechanism better captures the functional role: explaining HOW and WHY."

**Change 2: P type.** The prompt currently defines P as:

```
P (Procedural): Claims about process — filing dates, procedural posture,
next steps.
```

Replace with:

```
P (Prescriptive): Action recommendations — what should be done. Claims
that recommend, direct, or propose a course of action.

Examples:
- "The court should grant summary judgment" → P
- "We recommend the client accepts the offer" → P
- "The plan should be sanctioned" → P

NOT procedural facts:
- "The claim was filed on 27 April 2022" → F (this reports what happened)
- "The hearing is listed for 6 June" → F (this reports a scheduled event)
- "Edge served the Amended Claim Form on 25 August 2022" → F

Test: if the node recommends an action, it's P. If it reports what
happened or what is scheduled, it's F.
```

### Pass 2 Prompt

Update the J edge definition. The prompt currently defines J as:

```
J (Justification): Context or background for a claim.
```

Replace with:

```
J (Justification): Normative reason why a prescription should be adopted.
Connects evaluative conclusions (V) or reasoning bridges (M) to
prescriptions (P). Occasionally connects V→V when one evaluative
conclusion justifies an evaluative stance. Answers "why should we do this?"

J is NOT the same as S:
- S: "This evidence supports the truth of this claim"
- J: "This conclusion justifies this recommended action"

Use J when:
- The source is V or M
- The target is P
- The source answers "why should we do this?" not "is this true?"

Examples:
- "The actionability point is independently fatal" (V) --J-->
  "The court should dismiss the claim" (P)
- "Because the contract was procured by misrepresentation" (V) --J-->
  "The claimant should elect to rescind" (P)
```

### Pass 3 Prompt

Minimal changes. Pass 3 verifies citations and checks structural integrity. The verification logic doesn't depend on whether a node is P-Procedural or P-Prescriptive. However, one new check becomes possible:

**New check: Unsupported prescriptions.** With P correctly typed as Prescriptive, Pass 3 can verify that every P node has at least one incoming J edge from a V or M node. A prescription without a justification — "the court should dismiss the claim" with no evaluative basis — is a structural gap. This is a new issue type:

```
Type: unsupported_prescription
Severity: MEDIUM (HIGH if the P node is the document's ultimate recommendation)
Description: P node has no incoming J edge. The recommended action has no
stated justification in the document's reasoning structure.
Fix: Add the evaluative basis for the recommendation — why should this
action be taken?
```

### Structural Metrics

One new metric becomes available:

**Prescription Reachability:** % of P nodes reachable from at least one F node via S/W/J chains. A well-structured advisory document should approach 100% — every recommendation is traceable back to factual evidence through reasoning chains. A poorly-structured one has prescriptions that are disconnected from the evidential base.

This metric is computed by code (not LLM) from the DAG via graph traversal. Add it to the structural metrics section of the report. (Aligns with v5 Coding Methodology §6.)

---

## Impact on Existing Reports

### Edge v Ofcom (69 claims, 111 connections)

Nodes that change type:
- **P069** ("Edge's claim has no realistic prospect of success") — stays P. This is a prescription: the court should reject the claim. But the qualifier analysis changes: P069 is now a prescription that needs J edges from V nodes, not just S edges from evidence. The existing edge from "the actionability point is independently fatal" (V) to P069 should be retyped from S to J.
- **P040** ("Edge filed its original Claim Form on 27 April 2022") — changes from P to F. Procedural fact.
- **P041** ("Edge filed an Amended Claim Form with Particulars of Claim on 22 August 2022") — changes from P to F. Procedural fact.
- **P042** ("Edge filed Amended Particulars of Claim on 24 August 2023") — changes from P to F. Procedural fact.

Edges that change type:
- Several edges feeding into P069 should be retyped from S to J — they're normative justifications for the dismissal recommendation, not evidence that the claim factually lacks merit.

Net effect: The issues identified don't change. The structural analysis becomes more precise — you can now distinguish "this evidence supports this finding" from "this finding justifies this recommendation."

### Poundland

The ultimate conclusion ("the plan should be sanctioned") is a prescription. Currently coded as V. Should be P. The evaluative conclusions supporting it ("the plan is fair," "the comparator is worse") connect via J edges, not S edges.

### Financial Remedy Letter

The letter's recommendations ("we propose a 60/40 split," "the pension should be offset") are prescriptions. The evaluative bases for them ("the wife's contributions are non-financial but substantial," "the pension is the largest single asset") connect via J edges.

---

## Regression Test

After updating the prompts, re-run Edge v Ofcom through the full pipeline. Compare against the existing report:

1. **Claim count should be identical** (69) — no claims are added or removed, only retyped
2. **Connection count should be identical** (111) — no edges are added or removed, only retyped
3. **Issue count should be equal or greater** — the new unsupported_prescription check may identify additional issues
4. **All existing issues should still be detected** — the structural problems (qualifier mismatch on P069, missing authority on P050, COMUGs temporal disaggregation) don't depend on type labels
5. **P040, P041, P042 should be typed F** — procedural facts
6. **P069 should remain P** — prescription
7. **At least one edge feeding P069 should be typed J** — normative justification, not evidential support

If all seven criteria are met, the update is clean.

---

## Domain-Specific Coding Guidance

The unified framework uses fixed types across all domains. Each domain gets a coding guidance appendix with domain-specific examples and boundary-case notes. These appendices live alongside the pipeline prompts and are included when analysing documents from that domain.

### Legal Appendix (include when analysing legal documents)

```
Domain-specific notes for legal document analysis:

F nodes in legal documents include:
- Statutory provisions ("Section 8(4) imposes a mandatory duty")
- Case holdings as reported ("Rose J held that...")
- Procedural facts ("The claim was filed on 27 April 2022")
- Regulatory facts ("Ofcom consulted in November 2015")

M nodes in legal documents tend to be:
- Legal principles ("Under Bedfordshire, the duty must be for a limited class")
- Interpretive rules ("Expressio unius — express provision elsewhere implies exclusion here")
- Doctrinal frameworks ("The Francovich conditions require a sufficiently serious breach")

V nodes in legal documents include:
- Case holdings as adopted ("The restriction was unjustified")
- Assessments of strength ("The claim has no realistic prospect")
- Characterisations ("This is substantively identical to the Recall claim")

P nodes in legal documents include:
- Recommendations to client ("We recommend accepting the offer")
- Submissions to court ("The court should grant summary judgment")
- Proposed orders ("The plan should be sanctioned")
- Drafting recommendations ("The clause should be capped at 2x contract value")

Boundary case — case holdings:
- "Rose J held that the restriction was unjustified" → F (reporting what the judge found)
- "The restriction is unjustified" → V (adopting the holding as the document's own assessment)
- "The court should find the restriction unjustified" → P (prescribing what the court should decide)
```

### Strategy Appendix (include when analysing strategy documents)

```
Domain-specific notes for strategy document analysis:

F nodes in strategy documents include:
- Market data ("Revenue fell 12% in Q3")
- Competitor actions ("BYD launched the Seagull at $9,700")
- Internal metrics ("Gross margin declined from 22% to 18%")
- Historical events ("The acquisition closed on 14 September")

M nodes in strategy documents tend to be:
- Causal mechanisms ("Vertical integration lowers costs because...")
- Market dynamics ("Network effects create winner-take-all dynamics")
- Strategic frameworks ("Porter's five forces indicate...")

V nodes in strategy documents include:
- Risk assessments ("This is the most consequential risk")
- Competitive evaluations ("The cost advantage is structural, not cyclical")
- Market judgements ("The window for entry is closing")

P nodes in strategy documents include:
- Board recommendations ("The board should commission a review")
- Strategic directives ("Divest the European business within 18 months")
- Investment decisions ("Defer the acquisition until Q2")
- Operational changes ("Restructure the sales team around verticals")

Boundary case — forecasts vs prescriptions:
- "Revenue will decline 8% next year" → V (evaluative prediction)
- "The board should plan for an 8% revenue decline" → P (action recommendation)
```

---

## Scope

### Build now
- Update Pass 1 prompt: M = Mechanism (label change), P = Prescriptive, procedural facts = F
- Update Pass 2 prompt: J = normative reason for action (allow V→V)
- Add unsupported_prescription issue type to Pass 3
- Add Prescription Reachability to structural metrics (per v5 §6)
- Re-run Edge v Ofcom as regression test
- Create legal and strategy coding guidance appendices

### Deferred
- Automatic domain detection (legal vs strategy) to select the right appendix
- F[procedural] tagging (optional refinement — not needed for MVP)
- Retroactive re-analysis of Poundland and financial remedy reports
