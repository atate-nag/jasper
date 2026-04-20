export default function Terms() {
  return (
    <div className="mx-auto max-w-2xl py-8">
      <h1 className="text-2xl font-semibold text-[#1A1A2E]" style={{ fontFamily: 'var(--font-serif)' }}>Terms of Service</h1>
      <div className="mt-6 space-y-4 text-sm leading-relaxed text-[#4A4A68]">
        <p><strong className="text-[#1A1A2E]">1. Service.</strong> ReasonQA provides AI-powered analysis of professional documents to identify potential structural weaknesses in reasoning. This is an analytical tool, not legal advice.</p>
        <p><strong className="text-[#1A1A2E]">2. No legal advice.</strong> ReasonQA output should be reviewed by a qualified legal professional. We do not guarantee the accuracy, completeness, or legal correctness of any analysis.</p>
        <p><strong className="text-[#1A1A2E]">3. Your documents.</strong> Documents you upload are processed to generate your analysis report. Source documents are permanently deleted from our servers immediately after processing completes. We do not retain your source documents. We do not use your documents to train AI models.</p>
        <p><strong className="text-[#1A1A2E]">4. Analysis reports.</strong> Reports are stored in your account until you delete them. You are responsible for managing analysis reports in accordance with your own data governance and privilege obligations. You can permanently delete any analysis at any time. Deleted data is not recoverable.</p>
        <p><strong className="text-[#1A1A2E]">5. AI processing.</strong> Your document text is sent to Anthropic&apos;s Claude API for analysis. We use Anthropic&apos;s zero data retention configuration &mdash; Anthropic does not log or retain your document content.</p>
        <p><strong className="text-[#1A1A2E]">6. Data.</strong> We use standard encryption in transit (TLS) and at rest. Infrastructure is hosted in the EU/UK.</p>
        <p><strong className="text-[#1A1A2E]">7. Payment.</strong> Pro subscriptions are billed monthly. You can cancel at any time. No refunds for partial months.</p>
        <p><strong className="text-[#1A1A2E]">8. Liability.</strong> Our liability is limited to the fees you have paid in the 12 months preceding any claim.</p>
        <p><strong className="text-[#1A1A2E]">9. Changes.</strong> We may update these terms. Continued use constitutes acceptance.</p>
      </div>
    </div>
  );
}
