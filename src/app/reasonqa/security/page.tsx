'use client';

import { jsPDF } from 'jspdf';

function downloadSecurityPack(): void {
  const doc = new jsPDF();
  const M = 20;
  const W = 170;
  let y = M;

  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('ReasonQA — Security Pack', M, y);
  y += 10;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120);
  doc.text(`Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`, M, y);
  doc.setTextColor(0);
  y += 12;

  const sections: { title: string; body: string }[] = [
    {
      title: 'Document Processing',
      body: 'Your document is processed via Anthropic\u2019s Claude API under zero data retention. Your content is not logged, stored, or used for model training by any third party.',
    },
    {
      title: 'Document Lifecycle',
      body: 'Upload \u2192 Processing (10\u201315 minutes) \u2192 Source document DELETED \u2192 Report retained in your account \u2192 You can permanently delete any report at any time.',
    },
    {
      title: 'What We Store',
      body: '\u2022 Your account (email, subscription status)\n\u2022 Generated reports (until you delete them)\n\u2022 We do NOT store your source documents after processing.',
    },
    {
      title: 'What We Don\u2019t Do',
      body: '\u2022 We don\u2019t train models on your documents\n\u2022 We don\u2019t share your data with third parties\n\u2022 We don\u2019t retain your source documents\n\u2022 We don\u2019t log the content of your documents',
    },
    {
      title: 'Verification Sources',
      body: 'Citation verification uses the National Archives Find Case Law database (open data, Open Justice Licence) and legislation.gov.uk. No commercial legal database subscription is required or used.',
    },
    {
      title: 'Compliance',
      body: '\u2022 Zero data retention on all AI processing\n\u2022 UK/EU data processing\n\u2022 Bar Council AI guidance compliant',
    },
  ];

  for (const s of sections) {
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(s.title.toUpperCase(), M, y);
    y += 6;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(s.body, W) as string[];
    doc.text(lines, M, y);
    y += lines.length * 5 + 8;
  }

  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text('ReasonQA \u2014 reasonqa.io \u2014 admin@reasonqa.io', M, 282);

  doc.save('ReasonQA-Security-Pack.pdf');
}

export default function SecurityPage() {
  return (
    <div className="mx-auto max-w-2xl py-8">
      <h1
        className="text-2xl font-semibold text-[#1A1A2E]"
        style={{ fontFamily: 'var(--font-serif)' }}
      >
        How ReasonQA handles your data
      </h1>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-[#4A4A68]">
        <Section title="Document Processing">
          Your document is processed via Anthropic&apos;s Claude API under zero data
          retention. Your content is not logged, stored, or used for model
          training by any third party.
        </Section>

        <Section title="Document Lifecycle">
          <ol className="mt-1 list-inside list-decimal space-y-1">
            <li>Upload</li>
            <li>Processing (10&ndash;15 minutes)</li>
            <li>Source document <strong className="text-[#1A1A2E]">deleted</strong></li>
            <li>Report retained in your account</li>
            <li>You can permanently delete any report at any time</li>
          </ol>
        </Section>

        <Section title="What We Store">
          <ul className="mt-1 list-inside list-disc space-y-1">
            <li>Your account (email, subscription status)</li>
            <li>Generated reports (until you delete them)</li>
            <li>
              If you use incremental re-analysis, your original document text is
              retained in encrypted form (AES-256-GCM) for up to 30 days to
              enable comparison with revised versions. You can delete it at any
              time. If you do not use incremental re-analysis, your document is
              deleted immediately after processing.
            </li>
          </ul>
          <p className="mt-2">
            We do <strong className="text-[#1A1A2E]">not</strong> store your source
            documents after processing.
          </p>
        </Section>

        <Section title="What We Don't Do">
          <ul className="mt-1 list-inside list-disc space-y-1">
            <li>We don&apos;t train models on your documents</li>
            <li>We don&apos;t share your data with third parties</li>
            <li>We don&apos;t retain your source documents</li>
            <li>We don&apos;t log the content of your documents</li>
          </ul>
        </Section>

        <Section title="Verification Sources">
          Citation verification uses the National Archives{' '}
          <em>Find Case Law</em> database (open data, Open Justice Licence) and{' '}
          <em>legislation.gov.uk</em>. No commercial legal database subscription
          is required or used.
        </Section>

        <Section title="Compliance">
          <ul className="mt-1 list-inside list-disc space-y-1">
            <li>Zero data retention on all AI processing</li>
            <li>UK/EU data processing</li>
            <li>Bar Council AI guidance compliant</li>
          </ul>
        </Section>
      </div>

      <div className="mt-10 border-t border-[#E5E7EB] pt-6">
        <button
          onClick={downloadSecurityPack}
          className="rounded border border-[#1B2A4A] bg-white px-5 py-2.5 text-sm font-medium text-[#1B2A4A] hover:bg-[#F8F9FA]"
        >
          Download Security Pack &mdash; PDF
        </button>
        <p className="mt-2 text-xs text-[#8B8BA3]">
          One-page summary for PI renewal forms, chambers IT reviews, or
          compliance checks.
        </p>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-[#8B8BA3]">
        {title}
      </h2>
      <div className="mt-2">{children}</div>
    </div>
  );
}
