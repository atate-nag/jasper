export default function Terms() {
  return (
    <div className="mx-auto max-w-2xl py-8">
      <h1 className="text-2xl font-bold text-white">Terms of Service</h1>
      <div className="mt-6 space-y-4 text-sm leading-relaxed text-gray-300">
        <p><strong>1. Service.</strong> ReasonQA provides AI-powered analysis of professional documents to identify potential structural weaknesses in reasoning. This is an analytical tool, not legal advice.</p>
        <p><strong>2. No legal advice.</strong> ReasonQA output should be reviewed by a qualified legal professional. We do not guarantee the accuracy, completeness, or legal correctness of any analysis.</p>
        <p><strong>3. Your documents.</strong> Documents you upload are processed to generate your analysis report. Source documents are permanently deleted from our servers immediately after processing completes. We do not retain your source documents. We do not use your documents to train AI models.</p>
        <p><strong>4. Analysis reports.</strong> Reports are stored in your account until you delete them. Reports contain substantive content extracted from your documents (claims, citations, structural analysis). You are responsible for managing analysis reports in accordance with your own data governance and privilege obligations. You can permanently delete any analysis and its report at any time via your dashboard. Deleted data is not recoverable.</p>
        <p><strong>5. AI processing.</strong> Your document text is sent to Anthropic&apos;s Claude API for analysis. We use Anthropic&apos;s zero data retention configuration &mdash; Anthropic does not log or retain your document content. No third party trains on your data.</p>
        <p><strong>6. Data.</strong> We use standard encryption in transit (TLS) and at rest. Infrastructure is hosted in the EU/UK.</p>
        <p><strong>7. Payment.</strong> Pro subscriptions are billed monthly. You can cancel at any time. No refunds for partial months.</p>
        <p><strong>8. Liability.</strong> Our liability is limited to the fees you have paid in the 12 months preceding any claim. We are not liable for any decisions made based on our analysis output.</p>
        <p><strong>9. Changes.</strong> We may update these terms. Continued use constitutes acceptance.</p>
      </div>
    </div>
  );
}
