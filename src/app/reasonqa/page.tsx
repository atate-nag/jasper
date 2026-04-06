import Link from 'next/link';

export default function ReasonQALanding() {
  return (
    <div className="flex flex-col items-center">
      {/* Hero */}
      <div className="pt-16 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
          Does your reasoning hold?
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-gray-400">
          ReasonQA finds structural weaknesses in legal arguments that citation
          checkers miss &mdash; unsupported conclusions, contested authorities,
          and evidence that supports both sides.
        </p>
        <div className="mt-8 flex justify-center gap-4">
          <Link
            href="/reasonqa/analyse"
            className="rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white hover:bg-blue-700"
          >
            Upload a document
          </Link>
          <Link
            href="/reasonqa/pricing"
            className="rounded-lg border border-gray-700 bg-gray-900 px-6 py-3 text-sm font-medium text-gray-300 hover:border-gray-600 hover:text-white"
          >
            See pricing
          </Link>
        </div>
        <p className="mt-4 text-sm text-gray-600">
          3 free analyses. No credit card required.
        </p>
      </div>

      {/* Value propositions */}
      <div className="mt-20 grid max-w-4xl gap-8 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
          <h3 className="font-semibold text-white">Beyond citation checking</h3>
          <p className="mt-2 text-sm text-gray-400">
            We don&apos;t just verify your citations exist. We check whether they
            actually support the propositions you cite them for.
          </p>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
          <h3 className="font-semibold text-white">Counter-authority detection</h3>
          <p className="mt-2 text-sm text-gray-400">
            We search live case law to find authorities your opponent will cite.
            If Bedfordshire has been distinguished by the Supreme Court, you need
            to know before they tell you.
          </p>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
          <h3 className="font-semibold text-white">Structural reasoning analysis</h3>
          <p className="mt-2 text-sm text-gray-400">
            69 claims. 111 connections. 16 issues. Every argument decomposed,
            every inference tested, every gap identified.
          </p>
        </div>
      </div>

      {/* Demo section */}
      <div className="mt-20 w-full max-w-3xl">
        <h2 className="text-center text-xl font-semibold text-white">
          What it finds
        </h2>
        <p className="mt-2 text-center text-sm text-gray-500">
          Real findings from an analysis of a legal memo (anonymised)
        </p>
        <div className="mt-6 space-y-3">
          <DemoIssue
            severity="high"
            type="Overrelied &amp; contested authority"
            description='X v Bedfordshire is cited for the proposition that breach of statutory duty does not give rise to a private law cause of action. However, 5 nodes depend on this authority and subsequent courts have applied it on both sides. DFX v Coventry City Council states it "has been superseded and is no longer good law" in certain contexts.'
            tag="interpretive"
          />
          <DemoIssue
            severity="medium"
            type="Uncited counter-authority"
            description="DFX v Coventry City Council [2021] EWHC 1382 (QB) distinguishes X v Bedfordshire in the context of local authority duties. The document does not cite or address this case."
            tag="interpretive"
          />
          <DemoIssue
            severity="medium"
            type="Unsupported conclusion"
            description="The memo concludes that judicial review availability indicates Parliament did not intend a private right of action, but there is no factual node establishing that JR is actually available for s.8(4) decisions."
          />
        </div>
      </div>

      {/* Pricing preview */}
      <div className="mt-20 text-center">
        <div className="inline-flex gap-8 rounded-xl border border-gray-800 bg-gray-900 px-8 py-6">
          <div>
            <p className="text-2xl font-bold text-white">&pound;0</p>
            <p className="text-sm text-gray-500">Free &middot; 3/month</p>
          </div>
          <div className="border-l border-gray-800" />
          <div>
            <p className="text-2xl font-bold text-white">&pound;200</p>
            <p className="text-sm text-gray-500">Pro &middot; 20/month</p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-20 border-t border-gray-800 py-8 text-center text-xs text-gray-600">
        <p>
          ReasonQA analyses the structural integrity of legal reasoning.
          It is not legal advice. All analysis should be reviewed by a qualified
          legal professional.
        </p>
        <div className="mt-3 flex justify-center gap-4">
          <Link href="/reasonqa/terms" className="hover:text-gray-400">Terms</Link>
          <Link href="/reasonqa/privacy" className="hover:text-gray-400">Privacy</Link>
          <Link href="/reasonqa/pricing" className="hover:text-gray-400">Pricing</Link>
        </div>
      </div>
    </div>
  );
}

function DemoIssue({
  severity,
  type,
  description,
  tag,
}: {
  severity: string;
  type: string;
  description: string;
  tag?: string;
}) {
  const borderColor = severity === 'high' ? 'border-red-800 bg-red-950/30' : 'border-yellow-800 bg-yellow-950/30';
  return (
    <div className={`rounded-lg border p-4 ${borderColor}`}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium uppercase text-gray-400">{severity}</span>
        <span className="text-xs text-gray-600">{type}</span>
        {tag && (
          <span className="rounded bg-purple-900/40 px-1.5 py-0.5 text-xs text-purple-300">{tag}</span>
        )}
      </div>
      <p className="mt-2 text-sm text-gray-300">{description}</p>
    </div>
  );
}
