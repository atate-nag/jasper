# ReasonQA — Design Restyle Brief

## Date: 6 April 2026

---

## The Problem

The product looks like a developer tool. The buyers are managing partners, heads of risk, and senior associates at law firms. The current dark-mode, blue-accent, compact-dashboard aesthetic signals "built by engineers for engineers." It needs to signal "authoritative analytical tool for professionals who charge £500/hour."

The analytical output is commercially distinctive. The design needs to match the seriousness of what it's delivering. A lawyer reading "JANUS-FACED AUTHORITY: X v Bedfordshire has been applied on both sides — cite DFX v Coventry and explain why the narrowing doesn't apply here" should feel like they're reading an authoritative review from a senior colleague, not checking a CI/CD pipeline.

---

## Design Direction: Editorial Legal

**One sentence:** The Economist's digital edition meets a Chambers & Partners ranking page.

**What this means in practice:**
- Light backgrounds, dark text, substantial white space
- Restrained colour — almost monochrome with one accent colour for status/action
- Typography that says "serious document" not "SaaS dashboard"
- Information density that respects the reader's time without looking cramped
- The report view should feel like reading a well-typeset legal brief, not scanning a notification feed

**What it does NOT mean:**
- Old-fashioned. This isn't a 2005 law firm website with gold serif headers and marble textures.
- Bland. The product has distinctive, powerful output — the design should be confident and spare, not timid.
- Cluttered. Legal professionals deal with enough visual noise in Westlaw and LexisNexis. ReasonQA should feel like a relief by comparison.

---

## Reference Points

Look at these for tone and feel (not to copy, but for calibration):

**Lexis+ UK** (lexisnexis.co.uk/lexis-plus) — Light theme, clean layout, professional. Their report views use white backgrounds with restrained blue accents. Type is readable at length.

**ICLR.4** (iclr.co.uk) — Conservative, authoritative. Heavy on white space and serif typography. Feels like a digital law library.

**The Economist digital** — Editorial confidence. Light backgrounds, strong typographic hierarchy, restrained use of red as the single accent colour. Dense information presented clearly.

**Chambers & Partners** (chambers.com) — Rankings and analysis presented with authority. Navy/white colour scheme. Professional without being stuffy.

**Stripe's documentation** (stripe.com/docs) — As a counter-reference for the product chrome (nav, buttons, form elements). Clean, modern, light-themed, professional. Shows you can be a tech product without looking like a terminal.

---

## Colour Palette

### Primary (replace the current dark theme)

```css
:root {
  /* Backgrounds */
  --bg-primary: #FFFFFF;              /* Main background — clean white */
  --bg-secondary: #F8F9FA;            /* Card backgrounds, alternating rows */
  --bg-tertiary: #F1F3F5;             /* Sidebar, nav background */
  --bg-report: #FAFBFC;               /* Report reading area — very slight warmth */

  /* Text */
  --text-primary: #1A1A2E;            /* Headings, primary content — near-black with slight warmth */
  --text-secondary: #4A4A68;          /* Secondary text, metadata */
  --text-tertiary: #8B8BA3;           /* Placeholder text, timestamps */

  /* Accent — deep navy, not electric blue */
  --accent-primary: #1B2A4A;          /* Primary buttons, links */
  --accent-hover: #263D6A;            /* Button hover state */
  --accent-light: #E8ECF4;            /* Light accent backgrounds */

  /* Status colours — muted, not neon */
  --status-verified: #2D7D46;         /* Verified — forest green, not lime */
  --status-partial: #B8860B;          /* Partial — dark goldenrod, not orange */
  --status-ungrounded: #8B8BA3;       /* Ungrounded — grey, low emphasis */
  --status-failed: #A63D40;           /* Failed — muted red, not alarm red */
  --status-source-doc: #5B7BA3;       /* Source document — slate blue */

  /* Issue severity */
  --severity-high: #A63D40;           /* Muted red */
  --severity-medium: #B8860B;         /* Dark goldenrod */
  --severity-low: #8B8BA3;            /* Grey */

  /* Quality ratings */
  --quality-strong: #2D7D46;
  --quality-adequate: #5B7BA3;
  --quality-marginal: #B8860B;
  --quality-weak: #A63D40;

  /* Borders and dividers */
  --border-light: #E5E7EB;
  --border-medium: #D1D5DB;

  /* Shadows — subtle, not dramatic */
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
  --shadow-md: 0 2px 8px rgba(0,0,0,0.08);
}
```

### Dark mode (optional, not default)

If you keep a dark mode toggle for personal preference, that's fine. But the default MUST be light. Legal professionals reading 15-page analysis reports on a screen need dark text on light backgrounds.

---

## Typography

### Font pairing

**Headings:** A serif with authority. Options (pick one):
- **Freight Text Pro** — the Economist uses this. Warm, readable, serious.
- **Lora** (Google Fonts, free) — elegant serif, good weight range, works well at heading sizes.
- **Source Serif 4** (Google Fonts, free) — Adobe's serif, clean and professional, excellent readability.
- **Literata** (Google Fonts, free) — designed for long-form reading, distinctive but not flashy.

**Body text / UI:** A refined sans-serif. Options:
- **Source Sans 3** (Google Fonts, free) — pairs naturally with Source Serif 4. Clean, professional, highly readable.
- **DM Sans** (Google Fonts, free) — geometric but warm. Good for UI elements and body text.
- **IBM Plex Sans** (Google Fonts, free) — corporate feel without being cold. Pairs well with most serifs.

**Monospace (for claim IDs, citations):**
- **IBM Plex Mono** or **JetBrains Mono** — for P001, P002, citation references, and structural metrics.

### Type scale

```css
/* Report title */
h1 { font-family: var(--font-serif); font-size: 1.75rem; font-weight: 600; line-height: 1.3; color: var(--text-primary); }

/* Section headings (Issues, Claims, Structure, Verification) */
h2 { font-family: var(--font-serif); font-size: 1.25rem; font-weight: 600; line-height: 1.4; color: var(--text-primary); }

/* Issue titles, claim IDs */
h3 { font-family: var(--font-sans); font-size: 0.95rem; font-weight: 600; line-height: 1.4; color: var(--text-primary); }

/* Body text — the summary, issue descriptions, claim text */
body { font-family: var(--font-sans); font-size: 0.9375rem; line-height: 1.65; color: var(--text-secondary); }

/* The report summary paragraph — this is the most important text */
.report-summary { font-family: var(--font-serif); font-size: 1.05rem; line-height: 1.75; color: var(--text-primary); }

/* Metadata, timestamps, secondary labels */
.meta { font-family: var(--font-sans); font-size: 0.8125rem; color: var(--text-tertiary); }

/* Claim IDs, citation references */
.mono { font-family: var(--font-mono); font-size: 0.8125rem; }
```

---

## Page-by-Page Redesign

### Navigation bar

Current: Dark background, white text, "ReasonQA" in sans-serif, blue underline.

Change to: White or very light grey background. "ReasonQA" in the serif heading font, dark navy. Thin bottom border (1px `--border-light`). Nav links in `--text-secondary`, active state in `--accent-primary`. No coloured underline — use font-weight change for active state.

The nav should feel like a document header, not a SaaS toolbar.

### Upload page (/new)

Current: Dark background, dashed dark drop zone barely visible.

Change to:
- White background
- "New Analysis" heading in serif
- Subtitle text stays (it's good copy)
- Drop zone: light grey background (`--bg-secondary`), dashed border in `--border-medium`, ample padding. On hover/drag-over: border becomes `--accent-primary`, subtle background tint
- "Select a document" button: `--accent-primary` background, white text, no rounded corners (use 4px border-radius, not pill-shaped — pills read as consumer, slightly squared reads as professional)
- Below the drop zone: a small note in `--text-tertiary`: "Your document is deleted from our servers after analysis. Only the report is retained."

### Dashboard (/dashboard)

Current: Dark cards in a list, green "Complete" badges, quality ratings in green/orange.

Change to:
- White background
- "Your Analyses" heading in serif, with "New Analysis" button in `--accent-primary` (not bright blue)
- Each analysis is a card with white background, subtle border (`--border-light`), and `--shadow-sm` on hover
- Card layout:
  ```
  [Document name]                                    [Quality badge]
  [File type] · [Date] · [Claim count] claims · [Issue count] issues    [Status]
  [First sentence of summary in --text-tertiary, truncated to one line]
  ```
- Quality badge: small text label with coloured left border (4px), not a filled badge. "ADEQUATE" in `--quality-adequate` with a left border in the same colour. Reads like a classification, not a traffic light.
- Status: "Complete" as plain text in `--text-tertiary`, not a green pill badge. If still processing, show a subtle progress indicator.
- Add a "Delete" action (icon or text link) on hover — needed for data privacy anyway.

### Report view (/analysis/[id])

This is the most important page. It's what the lawyer reads. It must feel like reading a document.

**Header area:**
- Document title in serif, `--text-primary`, with quality indicator as a small label to the right (not a big coloured badge)
- Metadata line below: "84 claims · 88 connections · Analysed 6 April 2026" in `--text-tertiary`
- "Re-verify" and "Export PDF" buttons: outlined style (border in `--accent-primary`, text in `--accent-primary`, white background). These are secondary actions — they shouldn't visually compete with the report content.

**Summary:**
- Full width, serif font (`--font-serif`), slightly larger than body text, generous line height (1.75)
- This is the paragraph a senior partner reads first. It should feel like the opening of a well-written advisory note.
- No background colour, no card — just text with breathing room. A thin top border or generous top padding separates it from the header.

**Tab navigation (Issues / Claims / Structure / Verification):**
- Current tabs are fine functionally. Restyle: underline active tab in `--accent-primary`, inactive in `--text-tertiary`. No background colour on tabs.
- Tab counts in parentheses stay — they're useful.

**Issues list:**
- Each issue is a card with white background and left border coloured by severity:
  - HIGH: 4px left border in `--severity-high`
  - MEDIUM: 4px left border in `--severity-medium`
  - LOW: 4px left border in `--severity-low`
- Issue type label: small caps or small monospace text above the description: `OVERRELIED_CONTESTED` or more readably `Overrelied · Contested Authority`
- Node references (P050, P051...) in monospace, linked to the claims tab
- "Fix:" section in slightly different style — perhaps indented or with a subtle background tint

**Claims table:**
- Each claim as a row with:
  - ID in monospace (`P001`)
  - Type as a small, muted label with subtle background: `Factual` in grey, `Value` in blue-tinted, `Mechanism` in amber-tinted, `Prescriptive` in green-tinted — all very muted, not the bright saturated colours in the current design
  - Verification status on the right: text label in the status colour, not a badge
  - Claim text as the primary content — readable, unhurried
- Alternating row backgrounds (`--bg-primary` and `--bg-secondary`) for readability in long lists

**Structure section:**
- The DAG visualisation lives here
- Light background, nodes with subtle shadows
- The visualisation colours should use the same muted palette as the claims table type labels
- Below the DAG: structural metrics as a clean summary grid, not a code-style dump

**Verification section:**
- Similar to claims table but with the verification narrative for each claim
- SOURCE_DOCUMENT entries (once implemented) get a single-line treatment
- VERIFIED entries get a brief confirmation
- PARTIAL and UNGROUNDED get the full narrative

### Pricing page (/pricing)

- White background
- Two-column comparison: Free and Pro
- Clean table layout, no flashy gradient cards
- Pro column gets a subtle highlight (light accent background)
- CTA button: "Start with 3 free analyses" (Free) and "Subscribe — £200/month" (Pro)
- Below the pricing: one line about data handling: "Documents deleted after processing. Zero data retention on AI calls."

### Landing page (/)

- Hero section: white background, serif headline "Does your reasoning hold?" centred, large
- Subheadline in sans-serif, `--text-secondary`
- Below: three value props as clean text blocks with small icons or numbers, not flashy cards
- Demo section: a static screenshot or embedded sample of the report view (light-themed), showing an issue finding. This is the visual proof.
- CTA: "Upload a document — 3 free analyses, no credit card" in `--accent-primary`
- Footer: minimal. Terms, Privacy, contact email.

---

## Component-Level Changes

### Buttons

```css
/* Primary action */
.btn-primary {
  background: var(--accent-primary);
  color: white;
  border: none;
  border-radius: 4px;           /* Not pill-shaped */
  padding: 0.625rem 1.25rem;
  font-family: var(--font-sans);
  font-size: 0.875rem;
  font-weight: 500;
  letter-spacing: 0.01em;
}

/* Secondary action (Re-verify, Export PDF) */
.btn-secondary {
  background: transparent;
  color: var(--accent-primary);
  border: 1px solid var(--accent-primary);
  border-radius: 4px;
  padding: 0.625rem 1.25rem;
}
```

### Cards

```css
.card {
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: 6px;
  padding: 1.25rem 1.5rem;
  box-shadow: var(--shadow-sm);
}

.card:hover {
  box-shadow: var(--shadow-md);
  border-color: var(--border-medium);
}
```

### Issue severity indicator

```css
.issue {
  border-left: 4px solid var(--severity-medium);  /* changes by severity */
  padding-left: 1rem;
  margin-bottom: 1.5rem;
}

.issue-type {
  font-family: var(--font-sans);
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
  margin-bottom: 0.25rem;
}
```

### Quality rating

```css
/* Replace the bright coloured badge with a subtle label */
.quality-badge {
  font-family: var(--font-sans);
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.25rem 0.5rem;
  border-left: 3px solid;
  background: transparent;
}

.quality-adequate { color: var(--quality-adequate); border-color: var(--quality-adequate); }
.quality-strong { color: var(--quality-strong); border-color: var(--quality-strong); }
.quality-marginal { color: var(--quality-marginal); border-color: var(--quality-marginal); }
.quality-weak { color: var(--quality-weak); border-color: var(--quality-weak); }
```

### Claim type labels

```css
.type-label {
  font-family: var(--font-sans);
  font-size: 0.6875rem;
  font-weight: 600;
  padding: 0.125rem 0.5rem;
  border-radius: 3px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.type-factual { background: #F1F3F5; color: #4A4A68; }
.type-value { background: #E8ECF4; color: #1B2A4A; }
.type-mechanism { background: #FDF6E3; color: #8B6914; }
.type-prescriptive { background: #E8F5E9; color: #2D7D46; }
```

---

## DAG Visualisation Styling

The interactive DAG should match the new palette:

- White/light background for the visualisation area
- Nodes use the same muted type colours as the claim labels
- Verified nodes: solid subtle border in `--status-verified`
- Ungrounded nodes: dashed border in `--status-ungrounded`
- Weak link edges: `--severity-high` (muted red), 2px
- Normal edges: `--border-medium`, 1px
- Issue badges on nodes: small circle with severity colour, positioned top-right of node
- Selected/hovered node: subtle shadow increase, not a colour change
- The DAG should feel like an analytical diagram in a consulting report, not a network graph in a monitoring dashboard

---

## What NOT to Change

- The analytical content (summaries, issues, claims, verifications) — this is the product's strength
- The tab structure (Issues / Claims / Structure / Verification) — it works
- The information hierarchy (summary first, then issues, then detail) — correct
- File upload functionality
- The Re-verify button concept

---

## Estimated Time

This is primarily CSS and Tailwind changes. The layout and components already exist — they just need restyling.

- Colour palette swap (CSS variables): 1-2 hours
- Typography integration (font loading, type scale): 1-2 hours
- Nav, upload, dashboard restyle: 2-3 hours
- Report view restyle (the most important page): 3-4 hours
- Landing page and pricing restyle: 2-3 hours
- DAG visualisation palette update: 1 hour
- **Total: 10-15 hours**

Can be done in parallel with the four quality improvements from the other brief. The design changes are purely CSS/component-level — they don't touch the pipeline, the API routes, or the data layer.
