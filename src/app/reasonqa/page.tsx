import Link from 'next/link';

export default function ReasonQALanding() {
  return (
    <div className="flex flex-col items-center">
      {/* Hero */}
      <div className="pt-16 text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-[#1A1A2E] sm:text-5xl" style={{ fontFamily: 'var(--font-serif)', lineHeight: 1.2 }}>
          Verify before you file.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-[#4A4A68]">
          Every citation checked against the source. Every counter-authority
          surfaced. Structural weaknesses identified before your opponent finds
          them.
        </p>
        <div className="mt-8 flex justify-center gap-4">
          <Link
            href="/reasonqa/analyse"
            className="rounded bg-[#1B2A4A] px-6 py-3 text-sm font-medium text-white hover:bg-[#263D6A]"
          >
            Upload a document
          </Link>
          <Link
            href="/reasonqa/pricing"
            className="rounded border border-[#1B2A4A] bg-white px-6 py-3 text-sm font-medium text-[#1B2A4A] hover:bg-[#F8F9FA]"
          >
            See pricing
          </Link>
        </div>
        <p className="mt-4 text-sm text-[#8B8BA3]">
          2 free analyses. No credit card required.
        </p>
      </div>

      {/* Value propositions */}
      <div className="mt-20 grid max-w-4xl gap-8 sm:grid-cols-3">
        <div>
          <h3 className="font-semibold text-[#1A1A2E]">Counter-authority detection</h3>
          <p className="mt-2 text-sm leading-relaxed text-[#4A4A68]">
            We search live case law to surface authorities that challenge your
            position &mdash; cases your opponent will find, or that a reviewer
            with more time would flag. Each finding names the specific case and
            explains how it bears on your argument.
          </p>
        </div>
        <div>
          <h3 className="font-semibold text-[#1A1A2E]">Citation-proposition verification</h3>
          <p className="mt-2 text-sm leading-relaxed text-[#4A4A68]">
            We don&apos;t just check your cases exist. We retrieve the judgment
            text and check whether the authority actually supports the specific
            proposition you cite it for.
          </p>
        </div>
        <div>
          <h3 className="font-semibold text-[#1A1A2E]">Structural reasoning analysis</h3>
          <p className="mt-2 text-sm leading-relaxed text-[#4A4A68]">
            Every claim traced from premise to conclusion. Every inference tested
            for support. The report shows where your argument is strong and where
            it&apos;s vulnerable &mdash; before anyone else does.
          </p>
        </div>
      </div>

      {/* Demo section */}
      <div className="mt-20 w-full max-w-3xl">
        <h2 className="text-center text-xl font-semibold text-[#1A1A2E]" style={{ fontFamily: 'var(--font-serif)' }}>
          What it finds
        </h2>
        <p className="mt-2 text-center text-sm text-[#8B8BA3]">
          Real findings from an analysis of a legal advisory memo (anonymised)
        </p>
        <div className="mt-6 space-y-4">
          <div className="rounded border border-[#E5E7EB] bg-[#FAFBFC] px-4 py-3 font-mono text-sm leading-relaxed text-[#4A4A68]" style={{ fontFamily: 'var(--font-mono)' }}>
            <span className="font-medium text-[#1A1A2E]">[VERIFIED]</span> 14 citations checked against Find Case Law<br />
            <span className="text-green-700">12 verified</span> &mdash; authority supports cited proposition<br />
            <span className="text-amber-700">1 partial</span> &mdash; authority supports proposition but with qualification<br />
            <span className="text-[#8B8BA3]">1 untraceable</span> &mdash; judgment text not available for verification
          </div>
          <DemoIssue
            severity="high"
            type="Overrelied &amp; Contested Authority"
            tag="interpretive"
            description="The memo's central argument depends on an authority cited by five separate propositions. But subsequent courts have applied this authority on both sides — one held it &ldquo;has been superseded and is no longer good law&rdquo; in certain contexts. The memo does not acknowledge the contestation."
            fix="Acknowledge the authority has been narrowed in subsequent case law. Explain why the supportive reading applies in this specific context. Alternatively, diversify the evidential base with additional authorities."
          />
          <DemoIssue
            severity="medium"
            type="Uncited Counter-Authority"
            tag="interpretive"
            description="A 2021 High Court decision directly distinguishes the memo's foundational authority. This case is not cited or addressed in the memo. A competent opponent would use it."
            fix="Cite the counter-authority and explain why it does not affect the application in the present context."
          />
          <DemoIssue
            severity="medium"
            type="Unsupported Conclusion"
            description="The memo asserts that a particular remedy is available as if established fact, but cites no authority for this proposition and does not demonstrate it. The conclusion may be correct — but it is asserted, not argued."
            fix="Cite supporting authority or acknowledge this as an assumption requiring further analysis."
          />
        </div>
      </div>

      {/* Pricing preview */}
      <div className="mt-20 text-center">
        <div className="inline-flex flex-wrap justify-center gap-8 rounded border border-[#E5E7EB] bg-[#FAFBFC] px-8 py-6">
          <div>
            <p className="text-2xl font-semibold text-[#1A1A2E]">&pound;0</p>
            <p className="text-sm text-[#8B8BA3]">Free &middot; 2/month</p>
          </div>
          <div className="border-l border-[#E5E7EB]" />
          <div>
            <p className="text-2xl font-semibold text-[#1A1A2E]">&pound;200</p>
            <p className="text-sm text-[#8B8BA3]">Pro &middot; 20/month</p>
          </div>
          <div className="border-l border-[#E5E7EB]" />
          <div>
            <p className="text-2xl font-semibold text-[#1A1A2E]">&pound;2,000</p>
            <p className="text-sm text-[#8B8BA3]">Annual &middot; save &pound;400</p>
          </div>
          <div className="border-l border-[#E5E7EB]" />
          <div>
            <p className="text-2xl font-semibold text-[#1A1A2E]">&pound;150</p>
            <p className="text-sm text-[#8B8BA3]">Chambers &middot; per seat/month</p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-20 w-full border-t border-[#E5E7EB] py-8 text-center text-xs leading-relaxed text-[#8B8BA3]">
        <p>
          ReasonQA analyses the structural integrity of legal reasoning. It is not
          legal advice and does not replace professional judgment. All analysis should
          be reviewed by a qualified legal professional. Documents are deleted from our
          servers after processing. Reports are retained in your account until you
          delete them. AI processing uses zero data retention configuration.
        </p>
        <div className="mt-3 flex justify-center gap-4">
          <Link href="/reasonqa/terms" className="hover:text-[#4A4A68]">Terms</Link>
          <Link href="/reasonqa/privacy" className="hover:text-[#4A4A68]">Privacy</Link>
          <Link href="/reasonqa/security" className="hover:text-[#4A4A68]">Security</Link>
          <Link href="/reasonqa/pricing" className="hover:text-[#4A4A68]">Pricing</Link>
        </div>
        <p className="mt-3">
          <a href="mailto:admin@reasonqa.io" className="hover:text-[#4A4A68]">admin@reasonqa.io</a>
        </p>
      </div>
    </div>
  );
}

function DemoIssue({
  severity,
  type,
  description,
  fix,
  tag,
}: {
  severity: string;
  type: string;
  description: string;
  fix?: string;
  tag?: string;
}) {
  const borderColor = severity === 'high' ? 'border-l-[#A63D40]' : 'border-l-[#B8860B]';
  return (
    <div className={`border-l-4 ${borderColor} bg-[#FAFBFC] py-3 pl-4 pr-4`}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[#8B8BA3]">{severity}</span>
        <span className="text-xs text-[#8B8BA3]">{type}</span>
        {tag && (
          <span className="rounded bg-[#E8ECF4] px-1.5 py-0.5 text-xs font-medium text-[#1B2A4A]">{tag}</span>
        )}
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-[#4A4A68]">{description}</p>
      {fix && (
        <p className="mt-2 rounded bg-[#F1F3F5] px-3 py-2 text-sm text-[#4A4A68]">
          <span className="font-medium text-[#1A1A2E]">Fix: </span>
          {fix}
        </p>
      )}
    </div>
  );
}
