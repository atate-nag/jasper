# ReasonQA — Ship It: CC Build Brief

## Date: 6 April 2026

---

## What This Is

Everything needed to go from localhost to live product in 48 hours. Four workstreams, all parallel:

1. **Vercel deployment** — get the existing app on a URL
2. **File upload + async processing** — users upload a document, get a report back
3. **Stripe integration** — free tier + paid subscription
4. **Landing page** — "Does your reasoning hold?"

This is the minimum viable shipped product. No DAG visualisation, no web report viewer (PDF only for now), no enterprise features. Ship, measure, iterate.

---

## 1. Vercel Deployment

### Current state

The app runs on localhost as a Next.js app with Supabase backend. The `apps/reasonqa/` directory sits alongside Jasper in the monorepo. Shared intermediary components in `lib/intermediary/`.

### What to do

Deploy `apps/reasonqa/` to Vercel. The monorepo setup means you need to configure Vercel's root directory to `apps/reasonqa/`.

**Environment variables needed on Vercel:**

```
ANTHROPIC_API_KEY=...
ANTHROPIC_ZERO_DATA_RETENTION=true    # MANDATORY — see Data & Privacy section
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=...
NEXT_PUBLIC_APP_URL=https://reasonqa.com  (or whatever domain)
```

**Domain:** If you have a domain ready, point it at Vercel. If not, the `.vercel.app` subdomain works for initial launch. Buy the domain in parallel.

**Edge runtime vs Node.js:** The analysis pipeline calls the Anthropic API with long timeouts (Pass 1 can take 2+ minutes). Vercel serverless functions have a 60-second timeout on the Hobby plan, 300 seconds on Pro. **You need Vercel Pro ($20/month)** for the pipeline to complete without timing out. Alternatively, move the pipeline to a background job (see section 2).

**Build settings:**
```
Framework: Next.js
Root directory: apps/reasonqa
Build command: npm run build (or pnpm build)
Output directory: .next
Node.js version: 20.x
```

### Estimated time: 2-3 hours including environment variables, domain setup, and first successful deploy.

---

## 2. File Upload + Async Processing

This is the hardest piece. The pipeline takes 10-15 minutes per analysis. You cannot hold an HTTP connection open that long. The architecture must be: upload → queue → process in background → notify when done.

### Upload flow

```
User uploads PDF/DOCX/TXT/MD
  → Next.js API route receives file
  → File stored in Supabase Storage (bucket: "documents")
  → Row created in analyses table (status: "queued")
  → Background job triggered
  → User redirected to /analysis/[id] (polling page)
```

### Supabase Storage setup

Create a bucket called `documents` in Supabase Storage. Private bucket — files accessible only via service role key, not public URLs.

```sql
-- Storage bucket (create via Supabase dashboard or SQL)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('documents', 'documents', false);

-- RLS policy: users can upload to their own folder
CREATE POLICY "Users can upload documents" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text);
```

### Database schema

```sql
CREATE TABLE analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  document_name TEXT NOT NULL,
  document_path TEXT,                  -- path in Supabase Storage (NULL after processing — source doc deleted)
  status TEXT NOT NULL DEFAULT 'queued',  -- queued | processing | pass1 | pass2 | retrieval | pass3 | metrics | complete | failed
  quality TEXT,                        -- STRONG | ADEQUATE | MARGINAL | WEAK
  claim_count INTEGER,
  connection_count INTEGER,
  issue_count INTEGER,
  report_pdf_path TEXT,               -- path to generated PDF in Storage
  report_json JSONB,                  -- structured report data for future web viewer
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,             -- soft delete: user can permanently delete analysis + report
  
  -- Usage tracking
  pass1_tokens INTEGER,
  pass2_tokens INTEGER,
  pass3_tokens INTEGER,
  retrieval_calls INTEGER,
  total_cost_gbp NUMERIC(6,4)
);

-- RLS: users see only their own non-deleted analyses
ALTER TABLE analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own analyses" ON analyses
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND deleted_at IS NULL);

-- Index for polling
CREATE INDEX idx_analyses_user_status ON analyses(user_id, status);
```

**Source document deletion:** After the pipeline completes (status = "complete" or "failed"), the background job MUST delete the uploaded document from Supabase Storage. The `document_path` field is then set to NULL. The source document does not persist on our infrastructure after processing. This is non-negotiable — see Data & Privacy section.

### Background processing

Two options depending on infrastructure preference:

**Option A: Vercel Cron + long-running function (simplest)**

Use a Vercel cron job that polls for queued analyses every 30 seconds. The function picks up the next queued job, downloads the document from Storage, runs the pipeline, uploads the PDF, updates the row. Requires Vercel Pro for the 300-second function timeout. If the pipeline exceeds 300 seconds (it can on complex documents), this won't work.

**Option B: Supabase Edge Functions (recommended)**

Deploy the pipeline as a Supabase Edge Function with a longer timeout (up to 150 seconds per invocation — still tight). Chain multiple invocations: one for each pass.

**Option C: Inngest or Trigger.dev (most robust)**

Use a background job service. Inngest has a generous free tier and integrates with Next.js. The flow:

```typescript
// API route: /api/reasonqa/analyse
export async function POST(req: Request) {
  const { documentPath, analysisId } = await req.json();
  
  // Trigger background job
  await inngest.send({
    name: "reasonqa/analyse",
    data: { analysisId, documentPath }
  });
  
  return Response.json({ analysisId, status: "queued" });
}

// Background job (runs in Inngest's infrastructure, no timeout issues)
inngest.createFunction(
  { id: "reasonqa-analyse", retries: 1 },
  { event: "reasonqa/analyse" },
  async ({ event, step }) => {
    const { analysisId, documentPath } = event.data;
    
    // Step 1: Parse document
    const text = await step.run("parse-document", async () => {
      return await parseDocument(documentPath);
    });
    
    // Step 2: Pass 1
    const nodes = await step.run("pass1", async () => {
      await updateStatus(analysisId, "pass1");
      return await runPass1(text);
    });
    
    // Step 3: Pass 2 + Retrieval (parallel)
    const [edges, corpus] = await Promise.all([
      step.run("pass2", async () => {
        await updateStatus(analysisId, "pass2");
        return await runPass2(nodes);
      }),
      step.run("retrieval", async () => {
        await updateStatus(analysisId, "retrieval");
        return await runRetrieval(nodes);
      })
    ]);
    
    // Step 4: Pass 3
    const verification = await step.run("pass3", async () => {
      await updateStatus(analysisId, "pass3");
      return await runPass3(nodes, edges, corpus);
    });
    
    // Step 5: Generate report + cleanup
    await step.run("generate-report", async () => {
      await updateStatus(analysisId, "metrics");
      const report = generateReport(nodes, edges, verification);
      const pdf = await renderPDF(report);
      await uploadPDF(analysisId, pdf);
      await updateStatus(analysisId, "complete");
      
      // MANDATORY: delete source document after processing
      await supabase.storage.from("documents").remove([documentPath]);
      await supabase.from("analyses").update({ document_path: null }).eq("id", analysisId);
    });
  }
);
```

**Recommendation:** Option C (Inngest). It handles the long-running pipeline gracefully, retries on failure, and the step-based execution means each pass can take as long as it needs. Free tier covers the launch volume. Add `inngest` to dependencies and deploy the Inngest functions alongside the Next.js app.

### Upload API route

```typescript
// /api/reasonqa/upload
export async function POST(req: Request) {
  const user = await getUser(req);  // Supabase auth
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  
  // Check usage limits
  const usage = await getMonthlyUsage(user.id);
  const plan = await getUserPlan(user.id);
  if (usage >= plan.monthlyLimit) {
    return Response.json({ error: "Monthly limit reached. Upgrade to Pro." }, { status: 403 });
  }
  
  const formData = await req.formData();
  const file = formData.get("document") as File;
  
  // Validate file type
  const allowedTypes = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/markdown"
  ];
  if (!allowedTypes.includes(file.type)) {
    return Response.json({ error: "Unsupported file type" }, { status: 400 });
  }
  
  // Upload to Supabase Storage
  const path = `${user.id}/${Date.now()}-${file.name}`;
  await supabase.storage.from("documents").upload(path, file);
  
  // Create analysis record
  const { data: analysis } = await supabase
    .from("analyses")
    .insert({ user_id: user.id, document_name: file.name, document_path: path })
    .select()
    .single();
  
  // Trigger background job
  await inngest.send({
    name: "reasonqa/analyse",
    data: { analysisId: analysis.id, documentPath: path }
  });
  
  return Response.json({ analysisId: analysis.id });
}
```

### Polling page

`/analysis/[id]` — the user lands here after upload. Polls the analyses table every 3 seconds for status updates.

```
Status display:
  queued      → "Queued for analysis..."
  pass1       → "Extracting claims..." (show progress ~20%)
  pass2       → "Mapping reasoning structure..." (~40%)
  retrieval   → "Searching case law..." (~55%)
  pass3       → "Verifying citations and reasoning..." (~75%)
  metrics     → "Computing structural metrics..." (~90%)
  complete    → Show report (PDF download link + summary stats)
  failed      → "Analysis failed. Please try again." + error context
```

Keep it simple. A progress bar that advances through the stages, the document name, and estimated time remaining ("typically 10-15 minutes"). When complete, show: quality rating, claim count, issue count, and a "Download Report (PDF)" button.

### Document parsing

PDF and DOCX need server-side parsing. Use:
- **PDF:** `pdf-parse` (npm) for text extraction. For scanned PDFs, fall back to `pdftotext` via system call if available.
- **DOCX:** `mammoth` (npm) for text extraction. Clean, well-maintained, handles most Word documents.
- **TXT/MD:** Read directly, no parsing needed.

```typescript
async function parseDocument(path: string): Promise<string> {
  const { data } = await supabase.storage.from("documents").download(path);
  const buffer = Buffer.from(await data.arrayBuffer());
  const ext = path.split(".").pop()?.toLowerCase();
  
  switch (ext) {
    case "pdf":
      const pdf = await pdfParse(buffer);
      return pdf.text;
    case "docx":
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    case "txt":
    case "md":
      return buffer.toString("utf-8");
    default:
      throw new Error(`Unsupported file type: ${ext}`);
  }
}
```

### Estimated time: 6-8 hours for upload flow, background processing, polling page, and document parsing.

---

## 3. Stripe Integration

### Pricing

| Tier | Price | Analyses/month | Target |
|------|-------|---------------|--------|
| Free | £0 | 3 | Try it, see the output quality |
| Pro | £200/month | 20 | Individual lawyers, small teams |

Compute cost per analysis: ~£0.80 (Sonnet for Pass 1+2, Opus for Pass 3, Haiku for classification). At Pro with 20 analyses: £16 compute, £200 revenue. Healthy margins.

Don't build an Enterprise tier yet. If firms want more volume or on-premise, that's a conversation, not a self-serve checkout.

### Stripe setup

1. Create a Stripe account (if not already done)
2. Create one Product: "ReasonQA Pro"
3. Create one Price: £200/month, recurring
4. Create a Stripe Checkout session for subscription
5. Handle webhook for `checkout.session.completed` and `customer.subscription.deleted`

### Database additions

```sql
ALTER TABLE auth.users ADD COLUMN stripe_customer_id TEXT;

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  stripe_subscription_id TEXT NOT NULL,
  status TEXT NOT NULL,  -- active | cancelled | past_due
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Usage tracking view
CREATE VIEW monthly_usage AS
SELECT 
  user_id,
  COUNT(*) as analyses_this_month
FROM analyses
WHERE created_at > date_trunc('month', now())
  AND status != 'failed'
GROUP BY user_id;
```

### Checkout flow

```typescript
// /api/stripe/checkout
export async function POST(req: Request) {
  const user = await getUser(req);
  
  const session = await stripe.checkout.sessions.create({
    customer_email: user.email,
    mode: "subscription",
    line_items: [{ price: STRIPE_PRO_PRICE_ID, quantity: 1 }],
    success_url: `${APP_URL}/dashboard?upgraded=true`,
    cancel_url: `${APP_URL}/pricing`,
    metadata: { userId: user.id }
  });
  
  return Response.json({ url: session.url });
}

// /api/stripe/webhook
export async function POST(req: Request) {
  const event = stripe.webhooks.constructEvent(
    await req.text(),
    req.headers.get("stripe-signature"),
    STRIPE_WEBHOOK_SECRET
  );
  
  switch (event.type) {
    case "checkout.session.completed":
      const session = event.data.object;
      await createSubscription(session.metadata.userId, session.subscription);
      break;
    case "customer.subscription.deleted":
      await cancelSubscription(event.data.object.id);
      break;
  }
  
  return Response.json({ received: true });
}
```

### Usage limit enforcement

In the upload API route (section 2), check:
```typescript
const usage = await getMonthlyUsage(user.id);
const subscription = await getActiveSubscription(user.id);
const limit = subscription ? 20 : 3;

if (usage >= limit) {
  if (!subscription) {
    return Response.json({ 
      error: "Free tier limit reached (3/month). Upgrade to Pro for 20 analyses/month.",
      upgradeUrl: "/pricing"
    }, { status: 403 });
  } else {
    return Response.json({ 
      error: "Monthly analysis limit reached (20/month). Contact us for higher volume.",
    }, { status: 403 });
  }
}
```

### Estimated time: 3-4 hours including Stripe account setup, webhook handling, and usage limits.

---

## 4. Landing Page

### URL structure

```
/                   → Landing page
/login              → Auth (sign in / sign up)
/dashboard          → User's analyses list
/upload             → Upload a document
/analysis/[id]      → Analysis progress / report
/pricing            → Plan comparison
/terms              → Terms of service
/privacy            → Privacy policy
```

### Landing page design

**Headline:** "Does your reasoning hold?"

**Subheadline:** "ReasonQA finds structural weaknesses in legal arguments that citation checkers miss — unsupported conclusions, contested authorities, and evidence that supports both sides."

**Three value propositions (with icons):**

1. **Beyond citation checking** — "We don't just verify your citations exist. We check whether they actually support the propositions you cite them for."

2. **Counter-authority detection** — "We search live case law to find authorities your opponent will cite. If Bedfordshire has been distinguished by the Supreme Court, you need to know before they tell you."

3. **Structural reasoning analysis** — "69 claims. 111 connections. 16 issues. Every argument decomposed, every inference tested, every gap identified."

**Demo section:** Show a redacted/anonymised summary from the Edge v Ofcom analysis. The quality badge, claim count, connection count, issue count. Two or three example issues (the `overrelied_contested` on Bedfordshire and one `uncited_counter_authority`). Not the full report — just enough to show the output quality.

**CTA:** "Upload a document and see what it finds. 3 free analyses, no credit card required."

**Pricing section:**

| | Free | Pro |
|---|---|---|
| Analyses per month | 3 | 20 |
| Document types | PDF, DOCX, TXT | PDF, DOCX, TXT |
| Citation verification | ✓ | ✓ |
| Interpretive context (counter-authority detection) | ✓ | ✓ |
| Structural analysis + DAG metrics | ✓ | ✓ |
| Price | Free | £200/month |

**Footer:** "ReasonQA analyses the structural integrity of legal reasoning. It is not legal advice. All analysis should be reviewed by a qualified legal professional." Link to Terms and Privacy.

### Design direction

Professional, editorial, minimal. Dark navy or charcoal backgrounds with white text for the hero section. Clean serif for headings (signals legal credibility), sans-serif for body. No gradients, no illustrations, no stock photos of gavels. The product output IS the visual — show the report, not decorative graphics.

Think: The Economist meets a developer tool. Authoritative, spare, confident.

### Terms of service (minimal for launch)

```
ReasonQA Terms of Service

1. Service: ReasonQA provides AI-powered analysis of legal documents 
   to identify potential structural weaknesses in reasoning. This is 
   an analytical tool, not legal advice.

2. No legal advice: ReasonQA output should be reviewed by a qualified 
   legal professional. We do not guarantee the accuracy, completeness, 
   or legal correctness of any analysis.

3. Your documents: Documents you upload are processed to generate your 
   analysis report. Source documents are permanently deleted from our 
   servers immediately after processing completes. We do not retain 
   your source documents. We do not use your documents to train AI 
   models.

4. Analysis reports: Reports are stored in your account until you 
   delete them. Reports contain substantive content extracted from 
   your documents (claims, citations, structural analysis). You are 
   responsible for managing analysis reports in accordance with your 
   own data governance and privilege obligations. You can permanently 
   delete any analysis and its report at any time via your dashboard. 
   Deleted data is not recoverable.

5. AI processing: Your document text is sent to Anthropic's Claude 
   API for analysis. We use Anthropic's zero data retention 
   configuration — Anthropic does not log or retain your document 
   content. No third party trains on your data.

6. Data: We use standard encryption in transit (TLS) and at rest. 
   Infrastructure is hosted in the EU/UK.

7. Payment: Pro subscriptions are billed monthly. You can cancel at 
   any time. No refunds for partial months.

8. Liability: Our liability is limited to the fees you have paid in 
   the 12 months preceding any claim. We are not liable for any 
   decisions made based on our analysis output.

9. Changes: We may update these terms. Continued use constitutes 
   acceptance.
```

### Privacy policy (minimal for launch)

```
ReasonQA Privacy Policy

What we collect: Email address, payment information (processed by 
Stripe — we do not store card details), and analysis reports you 
generate.

What we do NOT retain: Source documents. Your uploaded document is 
deleted from our servers immediately after analysis completes. We 
do not keep copies.

Document processing: Your document is uploaded to encrypted cloud 
storage (Supabase), processed by our analysis pipeline using 
Anthropic's Claude API under zero data retention configuration 
(Anthropic does not log or store your input), and permanently 
deleted upon completion. Only the generated analysis report is 
retained in your account.

Analysis reports: Reports contain substantive content extracted 
from your documents, including claims, citations, and structural 
analysis. Reports are stored in your account until you delete them. 
You can permanently delete any report at any time from your 
dashboard. Deletion is irreversible.

Third parties: 
- Anthropic (AI processing — zero data retention, no training on 
  your data)
- Supabase (database and encrypted storage, EU/UK)
- Stripe (payment processing only)
- Vercel (web hosting, EU/UK)
- Inngest (background job orchestration — receives job metadata 
  only, not document content)

We do not sell, share, or provide your data to any other party.

Data location: All infrastructure hosted in the EU/UK.

Your rights: You can delete individual analyses and reports from 
your dashboard at any time. You can delete your account and all 
associated data by contacting us. We respond to deletion requests 
within 30 days.

Discoverability note for legal professionals: Analysis reports 
stored in your account may be disclosable in litigation depending 
on the circumstances of their creation. You are responsible for 
managing reports in accordance with your own privilege and 
disclosure obligations.

Contact: [email address]
```

### Estimated time: 4-6 hours for landing page, pricing page, terms, privacy, and dashboard.

---

## 5. Data & Privacy Architecture

This is not a separate workstream — it's a set of requirements that cut across all four workstreams. Every decision here is non-negotiable for a legal product.

### Anthropic Zero Data Retention

All Anthropic API calls MUST use the zero data retention configuration. This means Anthropic does not log inputs or outputs from your API calls. Without this, every privileged document a lawyer uploads gets stored on Anthropic's servers for 30 days. No law firm will accept that.

Implementation: set the `anthropic-beta: zero-data-retention-2025-04-01` header on every API call (check current header name — it may have been updated). Alternatively, if the SDK supports a ZDR flag, use that. Verify by checking the response headers confirm ZDR is active.

```typescript
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaultHeaders: {
    "anthropic-beta": "zero-data-retention-2025-04-01"  // verify current header
  }
});
```

### Data lifecycle

```
Upload          → Document stored in Supabase Storage (encrypted at rest)
Processing      → Document text sent to Anthropic API (ZDR — not retained)
                → Citation paragraphs fetched from Find Case Law (public data)
                → Classification calls to Haiku (ZDR — not retained)
Completion      → Source document DELETED from Supabase Storage
                → Report PDF + JSON stored in user's account
User deletes    → Report PDF deleted from Storage
                → Analysis row soft-deleted (deleted_at set)
                → Hard purge of soft-deleted rows after 30 days via cron
```

The key principle: **after processing completes, only the report exists on your servers. The source document is gone.** The report contains extracted claims (which are substantive content from the document) but not the document itself. This is analogous to a lawyer's file note — it records analysis of the document, not the document verbatim.

### Delete analysis endpoint

```typescript
// /api/reasonqa/analysis/[id]/delete
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const user = await getUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  
  const { data: analysis } = await supabase
    .from("analyses")
    .select("id, user_id, report_pdf_path")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();
  
  if (!analysis) return Response.json({ error: "Not found" }, { status: 404 });
  
  // Delete PDF from Storage
  if (analysis.report_pdf_path) {
    await supabase.storage.from("documents").remove([analysis.report_pdf_path]);
  }
  
  // Soft delete the analysis row (purge report_json too)
  await supabase
    .from("analyses")
    .update({ 
      deleted_at: new Date().toISOString(),
      report_json: null,
      report_pdf_path: null
    })
    .eq("id", params.id);
  
  return Response.json({ deleted: true });
}
```

The dashboard should show a "Delete" button on each analysis card. Confirm with the user: "This will permanently delete this analysis and its report. This cannot be undone."

### What goes to Inngest

The background job service (Inngest) receives job metadata only: `analysisId` and `documentPath`. It does NOT receive document content. The Inngest function runs in their infrastructure but fetches the document from your Supabase Storage, processes it via Anthropic API calls, and writes results back to your Supabase. Inngest's logs will show job IDs and timing, not document content.

### Corpus cache

The citation verification and interpretive context layers cache judgment XML and statute text in Supabase. This is public data from Find Case Law and legislation.gov.uk — no privacy concern. Cache TTL: judgments 30 days, legislation 7 days. The cache does NOT contain any user document content.

### What you can say to firms who ask

"Source documents are deleted from our servers immediately after analysis. We use Anthropic's zero data retention API — your document content is not logged or stored by any third party. Analysis reports are stored in your account and you can permanently delete them at any time. We do not train on your data."

This is accurate and verifiable. Don't overclaim — don't say "we never see your data" (you do, during processing) or "nothing is stored" (the report is). Be precise about what persists and what doesn't.

---

## Total Estimated Timeline

| Workstream | Hours | Can parallelise? |
|-----------|-------|-----------------|
| Vercel deployment | 2-3 | Start immediately |
| File upload + async processing | 6-8 | After deploy works |
| Stripe integration | 3-4 | Parallel with upload work |
| Landing page + legal pages | 4-6 | Parallel with everything |
| **Total** | **15-21 hours** | **~12-14 hours wall clock with parallelisation** |

Two focused days. Ship by end of day 2.

---

## What's NOT in this brief (deferred)

- DAG visualisation (separate brief exists)
- Web-based report viewer (PDF download only for now)
- Interpretive context query refinement (works, needs polish)
- V5 coding methodology prompt updates (separate brief exists)
- Source-document grounding category
- Enterprise tier / team accounts
- SSO / SAML
- SOC 2 / security questionnaire responses
- On-premise deployment
- API access for programmatic use
- Batch analysis (multiple documents)

All of these come after you have conversion data from real users.

---

## Post-Launch Monitoring

Once live, track:

1. **Sign-ups per day** — is there organic pull?
2. **Upload rate** — do sign-ups actually run an analysis?
3. **Completion rate** — do analyses complete successfully? (monitor for pipeline errors)
4. **Return rate** — do users come back for a second analysis?
5. **Conversion rate** — free → Pro upgrades
6. **Pipeline errors** — monitor the analyses table for `failed` status. Log error messages.
7. **API costs** — track `total_cost_gbp` per analysis. Alert if average exceeds £1.50 (nearly 2x expected).

If sign-ups come but nobody uploads → the landing page works but the product experience doesn't. If uploads come but nobody converts → the free output is good enough or the price is wrong. If nobody signs up → the positioning or distribution isn't working. Each failure mode has a different fix.
