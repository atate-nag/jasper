export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-300 py-16 px-4">
      <div className="max-w-2xl mx-auto space-y-8">
        <h1 className="text-3xl font-medium text-white">Privacy Policy</h1>
        <p className="text-sm text-gray-500">Last updated: March 2026</p>

        <section className="space-y-3">
          <h2 className="text-xl text-white">What we collect</h2>
          <ul className="list-disc list-inside space-y-1">
            <li>Conversation messages (text and voice transcriptions)</li>
            <li>Your profile — built from conversation inference, not forms</li>
            <li>Voice recordings are transcribed and immediately discarded</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl text-white">How data is processed</h2>
          <ul className="list-disc list-inside space-y-1">
            <li>Conversations are processed by Anthropic (Claude) — <a href="https://www.anthropic.com/policies/privacy" className="text-blue-400 hover:underline">their privacy policy</a></li>
            <li>Voice is processed by OpenAI (Whisper/TTS) — <a href="https://openai.com/policies/privacy-policy" className="text-blue-400 hover:underline">their privacy policy</a></li>
            <li>Data is stored in Supabase (EU region)</li>
            <li>API providers retain data for up to 30 days for abuse monitoring</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl text-white">Your rights</h2>
          <ul className="list-disc list-inside space-y-1">
            <li>Request a copy of all your data at any time</li>
            <li>Request deletion of your account and all associated data</li>
            <li>Contact: privacy@jasper.ai</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl text-white">Consent</h2>
          <p>By using Jasper, you agree to conversations being stored and processed as described above.</p>
        </section>
      </div>
    </div>
  );
}
