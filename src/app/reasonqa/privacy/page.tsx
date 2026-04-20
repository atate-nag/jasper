export default function Privacy() {
  return (
    <div className="mx-auto max-w-2xl py-8">
      <h1 className="text-2xl font-semibold text-[#1A1A2E]" style={{ fontFamily: 'var(--font-serif)' }}>Privacy Policy</h1>
      <div className="mt-6 space-y-4 text-sm leading-relaxed text-[#4A4A68]">
        <p><strong className="text-[#1A1A2E]">What we collect.</strong> Email address, payment information (processed by Stripe), and analysis reports you generate.</p>
        <p><strong className="text-[#1A1A2E]">What we do NOT retain.</strong> Source documents. Your uploaded document is deleted from our servers immediately after analysis completes.</p>
        <p><strong className="text-[#1A1A2E]">Document processing.</strong> Your document is uploaded to encrypted cloud storage, processed using Anthropic&apos;s Claude API under zero data retention configuration, and permanently deleted upon completion. Only the generated analysis report is retained.</p>
        <p><strong className="text-[#1A1A2E]">Analysis reports.</strong> Reports are stored in your account until you delete them. Deletion is irreversible.</p>
        <p><strong className="text-[#1A1A2E]">Third parties:</strong></p>
        <ul className="list-inside list-disc space-y-1 text-[#4A4A68]">
          <li>Anthropic (AI processing &mdash; zero data retention)</li>
          <li>Supabase (database and encrypted storage, EU/UK)</li>
          <li>Stripe (payment processing only)</li>
          <li>Vercel (web hosting)</li>
        </ul>
        <p>We do not sell, share, or provide your data to any other party.</p>
        <p><strong className="text-[#1A1A2E]">Your rights.</strong> You can delete individual analyses from your dashboard at any time. Contact us to delete your account and all associated data.</p>
        <p><strong className="text-[#1A1A2E]">For legal professionals.</strong> Analysis reports stored in your account may be disclosable in litigation. You are responsible for managing reports in accordance with your own privilege and disclosure obligations.</p>
      </div>
    </div>
  );
}
