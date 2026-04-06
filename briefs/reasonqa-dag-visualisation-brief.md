# ReasonQA — DAG Visualisation: CC Build Brief

## Date: 6 April 2026

---

## What to Build

Add an interactive DAG visualisation to the ReasonQA report. The visualisation shows the **critical reasoning chains** from conclusion nodes back to their evidential roots — not the full graph. The full graph (69 nodes, 111 edges in the Edge v Ofcom example) is visual noise. The value is in seeing the 2–4 longest chains, where the weak links are, and how issues cluster on specific paths.

This is a new section in the report output, positioned between the Summary/Issues section and the Claims table. It should be the thing a user looks at immediately after reading the summary — "show me the structure."

---

## Design Intent

### What the user sees

A top-to-bottom hierarchical layout. Evidence and factual premises at the top, inferential claims in the middle, conclusions at the bottom. This mirrors how legal reasoning actually works: facts support inferences, inferences support conclusions.

Each node shows:
- **Claim ID** (P069, P047, etc.)
- **Claim type** indicated by colour: Factual (neutral/grey), Value (blue), Method (amber), Procedural (green)
- **Verification status** indicated by border or icon: Verified (solid), Partial (dashed), Ungrounded (dotted/hollow), Untraceable (red outline), Failed (red fill)
- **Issue indicator** — nodes flagged in the Issues section get a warning badge with severity (HIGH/MEDIUM/LOW)

Edges show:
- **Direction of support** — arrow from supporting node to supported node (bottom-pointing, since evidence is at top)
- **Edge type** — reasoning edges (solid) vs elaboration edges (lighter/dashed)
- **Weak link highlight** — the weakest link in each chain (identified in the Reasoning Chains section) gets a distinct style (red, thicker, or animated)

### What the user does NOT see

- The full 69-node graph
- Toulmin terminology (no "warrant", "backing", "rebuttal" labels)
- Orphan nodes (P001, P003, P005, P009, P014, P017, P035, P041 in the Edge example — these are background facts with no outgoing reasoning edges. They appear in the Claims table but not in the visualisation)
- Elaboration-only subgraphs (chains consisting entirely of elaboration edges with no reasoning contribution to a conclusion)

### Interactions

- **Click a node** → panel slides in showing: full claim text, verification status with detail, any issues flagged on this node, list of incoming/outgoing edges
- **Click a weak link edge** → panel shows: the weakness explanation from the Reasoning Chains section, including the counterarguments (the "adversarial stress test" content)
- **Toggle chains** → if multiple conclusion nodes exist (e.g. P069 and P043 in Edge), user can select which chain(s) to display. Default: show all critical chains. Allow toggling individual chains on/off.
- **Hover** → highlight the full chain from root to conclusion that passes through the hovered node

### Chain Selection Logic

The pipeline output already identifies critical chains in the "Reasoning Chains" section. The visualisation should display:

1. **All chains explicitly listed in the Reasoning Chains output** — these are the ones the pipeline identified as structurally important (deepest, most load-bearing)
2. **Threshold: depth ≥ 4** — chains shorter than 4 are not structurally interesting enough to visualise (they're simple claim → evidence pairs)
3. **Deduplication** — where chains share subtrees (common in legal reasoning — multiple conclusions draw on the same statutory provisions), render shared nodes once with edges branching to multiple conclusions
4. **Maximum display: 5 chains** — if more than 5 meet the threshold, show the 5 deepest. Provide a "show all chains" toggle.

### What "critical chain" means operationally

Walk backward from each conclusion node (nodes with no outgoing reasoning edges — they're targets, not sources). At each step, follow incoming reasoning edges (not elaboration edges). Record the path. The longest paths are the critical chains. The weakest link on each chain is the edge where the source node has the lowest verification confidence or is flagged with an issue.

---

## Data Contract

The three-pass pipeline already produces all the data needed. No new LLM passes required. The visualisation is computed from the existing pipeline JSON output.

### Required fields from pipeline output

```
nodes: [
  {
    id: "P069",
    text: "Edge's claim has no realistic prospect of success...",
    type: "Procedural",           // Factual | Value | Method | Procedural
    qualifier: "Q0",              // Q0 (certain) | Q1 (hedged) | Q2 (speculative)
    verification_status: "VERIFIED",  // VERIFIED | PARTIAL | UNGROUNDED | UNTRACEABLE | FAILED
    citations: {
      internal: ["P047", "P048", "P053", "P055", "P064", "P066", "P067", "P068"],
      external: []
    },
    issues: [
      {
        severity: "MEDIUM",
        type: "qualifier_mismatch",
        description: "P069 stated at Q0 but depends on hedged premises..."
      }
    ]
  },
  ...
]

edges: [
  {
    source: "P047",
    target: "P069",
    type: "reasoning",            // reasoning | elaboration
    strength: "strong"            // strong | moderate | weak
  },
  ...
]

chains: [
  {
    conclusion: "P069",
    depth: 8,
    grounding_pct: 62,
    path: ["P012", "P046", "P047", "P048", "P053", "P055", "P064", "P069"],
    weakest_link: {
      source: "P050",
      target: "P069",
      explanation: "P050 asserts the normative principle that discretionary assessments are challengeable only by JR..."
    },
    counterarguments: [
      "Section 8(4) uses mandatory language ('must')...",
      "The X v Bedfordshire framework has been applied more flexibly...",
      ...
    ]
  },
  ...
]
```

### If the pipeline JSON doesn't currently output in this exact shape

The existing pipeline output (as seen in the report PDF) contains all this information but may not be structured as clean JSON. If the three-pass prompts currently output markdown-formatted text that gets parsed into the report, **the pipeline needs a JSON output mode** alongside the human-readable output. This is probably the most important prerequisite — the prompts should be updated to emit structured JSON that the visualisation component consumes directly.

**Recommended approach:** Add a `output_format: "json"` parameter to the pipeline. When set, Pass 1 emits nodes as JSON array, Pass 2 emits edges as JSON array, Pass 3 emits verification results and chains as JSON. The report renderer and the DAG visualisation both consume the same JSON. The current markdown/text output becomes a rendering of the JSON, not the primary output.

---

## Technical Implementation

### Layout library

Use **dagre** (via `@dagrejs/dagre` or `dagre-d3`) for hierarchical DAG layout. Not a force-directed layout — force layouts are for exploration of unknown structure. This is for inspection of known structure. Hierarchical layout communicates the direction of reasoning (evidence → conclusion) which is the whole point.

Alternative: **ELK.js** (`elkjs`) — more sophisticated layout algorithm, better at handling the branching/converging patterns common in legal reasoning DAGs. Slightly heavier. Probably worth it for production; dagre is fine for MVP.

### Rendering

React component using SVG. Not canvas — SVG allows CSS styling, DOM event handling, and accessibility. At the scale we're rendering (5–30 visible nodes, not 500), SVG performance is fine.

```
Component: <ReasoningChainView />

Props:
  nodes: Node[]
  edges: Edge[]
  chains: Chain[]
  issues: Issue[]
  onNodeClick: (nodeId: string) => void

State:
  selectedNode: string | null
  activeChains: string[]        // which conclusion chains are visible
  hoveredNode: string | null    // for chain highlighting
```

### Colour palette

Consistent with the report's existing design language. Suggest:

| Element | Colour | Meaning |
|---------|--------|---------|
| Factual node | `#6B7280` (grey) | Background facts, statutory provisions |
| Value node | `#3B82F6` (blue) | Analytical conclusions, legal assessments |
| Method node | `#F59E0B` (amber) | Legal principles, frameworks |
| Procedural node | `#10B981` (green) | Procedural facts, filing dates |
| Verified border | solid `#10B981` | Citation checked and confirmed |
| Partial border | dashed `#F59E0B` | Source truncated or partially confirmed |
| Ungrounded border | dotted `#6B7280` | No citation provided |
| Untraceable border | solid `#EF4444` | Citation could not be found |
| Failed border | fill `#EF4444` | Citation contradicts source |
| Weak link edge | `#EF4444`, 3px | Identified weakest link in chain |
| Issue badge | `#EF4444` / `#F59E0B` / `#6B7280` | HIGH / MEDIUM / LOW severity |

### File location

```
apps/reasonqa/src/components/dag/
  ReasoningChainView.tsx        — main component
  ChainLayout.ts                — dagre/elk layout computation
  NodeCard.tsx                  — individual node rendering
  EdgePath.tsx                  — edge rendering with weak link styling
  ChainSelector.tsx             — toggle which chains to display
  NodeDetailPanel.tsx           — slide-in panel on node click
  types.ts                      — TypeScript types for nodes, edges, chains
  colours.ts                    — colour constants
```

---

## Integration Points

### In the report view

The DAG visualisation appears as a collapsible section in the report, between Summary/Issues and the Claims table. Default state: **expanded**. This is the visual centrepiece of the report.

Section header: **"Reasoning Structure"** (not "DAG", not "Argument Map", not "Toulmin Graph")

Below the visualisation: a legend explaining the colour coding and a brief explanation: "This shows the main reasoning chains supporting each conclusion. Red edges indicate the weakest link in each chain. Click any node to see the full claim and its verification status."

### In the PDF export

The DAG visualisation needs to be rendered as a static SVG in the PDF version of the report. This means the layout computation and rendering must be separable from React — the layout engine (dagre/elk) runs server-side, produces SVG, which gets embedded in the PDF.

For MVP: The PDF report (like the one uploaded) does not include the visualisation. It's web-only. PDF export of the visualisation is deferred.

### Data flow

```
Pipeline JSON output
  → Report renderer (existing) → text/PDF report
  → ReasoningChainView component → interactive DAG
```

Both consume the same JSON. No separate data path.

---

## Scope

### MVP (build now)

- Hierarchical layout of critical chains (depth ≥ 4)
- Node colouring by type, border by verification status
- Issue badges on flagged nodes
- Weak link highlighting (red edge)
- Click node → detail panel with claim text, verification, issues
- Chain selector (toggle individual chains)
- Hover → highlight full chain through hovered node
- Legend and brief explanation text

### Deferred

- PDF export of the visualisation
- Full graph view (toggle to see all 69 nodes)
- Animated chain walkthrough ("step through the reasoning")
- Comparison view (two analyses of the same document side by side)
- Drag-to-rearrange nodes
- Export as standalone SVG/PNG
- Minimap for very large graphs
- Edge labels showing relationship type

---

## Risks and Decisions Needed

1. **JSON output mode** — if the pipeline doesn't currently emit structured JSON, this is prerequisite work. The prompts need updating to produce parseable JSON alongside human-readable text. This may be the largest piece of work in this brief.

2. **Layout library choice** — dagre (simpler, lighter, good enough for MVP) vs elkjs (better layouts for converging DAGs, heavier). Recommendation: start with dagre, switch to elk if the layouts are ugly on real data.

3. **Chain deduplication rendering** — when multiple chains share subtrees (e.g. P019 feeds into both P048 and P055 which both feed into P069), the shared nodes should be rendered once with branching edges. Dagre handles this natively. Just making it explicit as a requirement.

4. **Mobile** — hierarchical DAGs don't render well on phone screens. For mobile: show a simplified list view of chains (linear, not graphical) with the same click-to-expand detail. The full DAG is desktop/tablet only.

5. **Accessibility** — the visualisation must not be the only way to access the chain information. The Claims table and Reasoning Chains text section contain the same information in accessible form. The visualisation is additive.

---

## Reference

- Example report: Edge Telecommunications v Ofcom (uploaded PDF, 14 pages, 69 claims, 111 connections, 2 critical chains at depth 8 and depth 4)
- Pipeline prompts: `/mnt/user-data/outputs/three-pass-verification-prompts.md` (from previous session — may need regeneration)
- Coding methodology: `/mnt/user-data/uploads/Coding_Methodology_v4.md` (from previous session — may need re-upload)
- Previous CC build brief: `/mnt/user-data/outputs/reasonqa-cc-build-brief.md` (from previous session — may need regeneration)
