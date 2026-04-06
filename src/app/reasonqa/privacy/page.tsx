export default function Privacy() {
  return (
    <div className="mx-auto max-w-2xl py-8">
      <h1 className="text-2xl font-bold text-white">Privacy Policy</h1>
      <div className="mt-6 space-y-4 text-sm leading-relaxed text-gray-300">
        <p><strong>What we collect.</strong> Email address, payment information (processed by Stripe &mdash; we do not store card details), and analysis reports you generate.</p>
        <p><strong>What we do NOT retain.</strong> Source documents. Your uploaded document is deleted from our servers immediately after analysis completes. We do not keep copies.</p>
        <p><strong>Document processing.</strong> Your document is uploaded to encrypted cloud storage (Supabase), processed by our analysis pipeline using Anthropic&apos;s Claude API under zero data retention configuration (Anthropic does not log or store your input), and permanently deleted upon completion. Only the generated analysis report is retained in your account.</p>
        <p><strong>Analysis reports.</strong> Reports contain substantive content extracted from your documents, including claims, citations, and structural analysis. Reports are stored in your account until you delete them. You can permanently delete any report at any time from your dashboard. Deletion is irreversible.</p>
        <p><strong>Third parties:</strong></p>
        <ul className="list-inside list-disc space-y-1 text-gray-400">
          <li>Anthropic (AI processing &mdash; zero data retention, no training on your data)</li>
          <li>Supabase (database and encrypted storage, EU/UK)</li>
          <li>Stripe (payment processing only)</li>
          <li>Vercel (web hosting, EU/UK)</li>
        </ul>
        <p>We do not sell, share, or provide your data to any other party.</p>
        <p><strong>Data location.</strong> All infrastructure hosted in the EU/UK.</p>
        <p><strong>Your rights.</strong> You can delete individual analyses and reports from your dashboard at any time. You can delete your account and all associated data by contacting us. We respond to deletion requests within 30 days.</p>
        <p><strong>Discoverability note for legal professionals.</strong> Analysis reports stored in your account may be disclosable in litigation depending on the circumstances of their creation. You are responsible for managing reports in accordance with your own privilege and disclosure obligations.</p>
      </div>
    </div>
  );
}
