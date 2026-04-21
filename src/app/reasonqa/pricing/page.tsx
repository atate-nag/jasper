'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Pricing() {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  async function handleCheckout(plan: string) {
    setLoading(plan);
    try {
      const res = await fetch('/api/reasonqa/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (data.url) { window.location.href = data.url; return; }
      if (data.error) alert(data.error);
    } catch { alert('Something went wrong.'); }
    setLoading(null);
  }

  const features = [
    'All document types',
    'Citation verification',
    'Counter-authority detection',
    'Structural analysis',
    'PDF export',
  ];

  return (
    <div className="mx-auto max-w-4xl py-12">
      <h1 className="text-center text-3xl font-semibold text-[#1A1A2E]" style={{ fontFamily: 'var(--font-serif)' }}>Pricing</h1>
      <p className="mt-3 text-center text-[#4A4A68]">Start free. Upgrade when you need more.</p>

      <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {/* Free */}
        <div className="rounded border border-[#E5E7EB] bg-white p-6">
          <h2 className="text-lg font-semibold text-[#1A1A2E]">Free</h2>
          <p className="mt-1 text-3xl font-semibold text-[#1A1A2E]">&pound;0</p>
          <p className="text-sm text-[#8B8BA3]">per month</p>
          <ul className="mt-6 space-y-3 text-sm text-[#4A4A68]">
            <li>2 analyses per month</li>
            <li>Unlimited revisions within 7 days</li>
            {features.map(f => <li key={f}>{f}</li>)}
          </ul>
          <button
            onClick={() => router.push('/reasonqa/analyse')}
            className="mt-8 w-full rounded border border-[#D1D5DB] bg-white px-4 py-2.5 text-sm font-medium text-[#4A4A68] hover:border-[#1B2A4A] hover:text-[#1A1A2E]"
          >
            Get started
          </button>
          <p className="mt-2 text-center text-xs text-[#8B8BA3]">No credit card required</p>
        </div>

        {/* Pro */}
        <div className="rounded border border-[#1B2A4A] bg-[#FAFBFC] p-6">
          <h2 className="text-lg font-semibold text-[#1A1A2E]">Pro</h2>
          <p className="mt-1 text-3xl font-semibold text-[#1A1A2E]">&pound;200</p>
          <p className="text-sm text-[#8B8BA3]">per month</p>
          <ul className="mt-6 space-y-3 text-sm text-[#4A4A68]">
            <li>20 document analyses per month</li>
            <li className="font-medium text-[#1B2A4A]">Unlimited revisions within 7 days</li>
            {features.map(f => <li key={f}>{f}</li>)}
            <li className="font-medium text-[#1B2A4A]">Priority processing</li>
          </ul>
          <button
            onClick={() => handleCheckout('pro')}
            disabled={loading === 'pro'}
            className="mt-8 w-full rounded bg-[#1B2A4A] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#263D6A] disabled:opacity-50"
          >
            {loading === 'pro' ? 'Redirecting...' : 'Subscribe \u2014 \u00A3200/month'}
          </button>
        </div>

        {/* Annual */}
        <div className="rounded border border-[#E5E7EB] bg-white p-6">
          <h2 className="text-lg font-semibold text-[#1A1A2E]">Annual</h2>
          <p className="mt-1 text-3xl font-semibold text-[#1A1A2E]">&pound;2,000</p>
          <p className="text-sm text-[#8B8BA3]">per year</p>
          <ul className="mt-6 space-y-3 text-sm text-[#4A4A68]">
            <li className="font-medium text-[#2D7D46]">Save &pound;400</li>
            <li>20 document analyses per month</li>
            <li className="font-medium text-[#1B2A4A]">Unlimited revisions within 7 days</li>
            {features.map(f => <li key={f}>{f}</li>)}
            <li className="font-medium text-[#1B2A4A]">Priority processing</li>
          </ul>
          <button
            onClick={() => handleCheckout('annual')}
            disabled={loading === 'annual'}
            className="mt-8 w-full rounded bg-[#1B2A4A] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#263D6A] disabled:opacity-50"
          >
            {loading === 'annual' ? 'Redirecting...' : 'Subscribe \u2014 \u00A32,000/year'}
          </button>
        </div>

        {/* Chambers */}
        <div className="rounded border border-[#E5E7EB] bg-white p-6">
          <h2 className="text-lg font-semibold text-[#1A1A2E]">Chambers</h2>
          <p className="mt-1 text-3xl font-semibold text-[#1A1A2E]">&pound;150</p>
          <p className="text-sm text-[#8B8BA3]">per seat/month</p>
          <ul className="mt-6 space-y-3 text-sm text-[#4A4A68]">
            <li>5+ members</li>
            <li>Annual billing</li>
            <li>20 document analyses per seat/month</li>
            <li className="font-medium text-[#1B2A4A]">Unlimited revisions within 7 days</li>
            {features.map(f => <li key={f}>{f}</li>)}
            <li className="font-medium text-[#1B2A4A]">Priority processing</li>
          </ul>
          <a
            href="mailto:admin@reasonqa.io?subject=Chambers%20pack%20enquiry"
            className="mt-8 block w-full rounded border border-[#1B2A4A] bg-white px-4 py-2.5 text-center text-sm font-medium text-[#1B2A4A] hover:bg-[#F8F9FA]"
          >
            Contact us to set up
          </a>
        </div>
      </div>

      <p className="mt-8 text-center text-xs text-[#8B8BA3]">
        ReasonQA is an analytical tool for legal professionals. It does not provide legal advice.
        See our <a href="/reasonqa/terms" className="text-[#1B2A4A] hover:underline">Terms of Service</a> and <a href="/reasonqa/privacy" className="text-[#1B2A4A] hover:underline">Privacy Policy</a>.
      </p>
      <p className="mt-2 text-center text-xs text-[#8B8BA3]">
        Need higher volume? <a href="mailto:admin@reasonqa.io" className="text-[#1B2A4A] hover:underline">Get in touch</a>.
      </p>
    </div>
  );
}
