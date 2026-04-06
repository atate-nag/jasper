'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Pricing() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleUpgrade() {
    setLoading(true);
    try {
      const res = await fetch('/api/reasonqa/stripe/checkout', { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      if (data.error) {
        alert(data.error);
      }
    } catch {
      alert('Something went wrong. Please try again.');
    }
    setLoading(false);
  }

  return (
    <div className="mx-auto max-w-3xl py-12">
      <h1 className="text-center text-3xl font-bold text-white">Pricing</h1>
      <p className="mt-3 text-center text-gray-400">
        Start free. Upgrade when you need more.
      </p>

      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        {/* Free tier */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
          <h2 className="text-lg font-semibold text-white">Free</h2>
          <p className="mt-1 text-3xl font-bold text-white">&pound;0</p>
          <p className="text-sm text-gray-500">per month</p>
          <ul className="mt-6 space-y-3 text-sm text-gray-300">
            <li>3 analyses per month</li>
            <li>All document types</li>
            <li>Citation verification</li>
            <li>Counter-authority detection</li>
            <li>Structural analysis</li>
            <li>PDF export</li>
          </ul>
          <button
            onClick={() => router.push('/reasonqa/analyse')}
            className="mt-8 w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm font-medium text-gray-300 hover:border-gray-600 hover:text-white"
          >
            Get started
          </button>
        </div>

        {/* Pro tier */}
        <div className="rounded-xl border border-blue-800 bg-blue-950/20 p-6">
          <h2 className="text-lg font-semibold text-white">Pro</h2>
          <p className="mt-1 text-3xl font-bold text-white">&pound;200</p>
          <p className="text-sm text-gray-500">per month</p>
          <ul className="mt-6 space-y-3 text-sm text-gray-300">
            <li>20 analyses per month</li>
            <li>All document types</li>
            <li>Citation verification</li>
            <li>Counter-authority detection</li>
            <li>Structural analysis</li>
            <li>PDF export</li>
            <li className="text-blue-300">Priority support</li>
          </ul>
          <button
            onClick={handleUpgrade}
            disabled={loading}
            className="mt-8 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Redirecting to Stripe...' : 'Upgrade to Pro'}
          </button>
        </div>
      </div>

      <p className="mt-8 text-center text-xs text-gray-600">
        Need more volume or on-premise deployment? <a href="mailto:hello@reasonqa.com" className="text-blue-400 hover:underline">Contact us</a>.
      </p>
    </div>
  );
}
