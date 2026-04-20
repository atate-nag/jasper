'use client';

import { useState } from 'react';

export default function PartnersPage() {
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);

    const body = [
      `Name: ${data.get('name')}`,
      `Chambers: ${data.get('chambers')}`,
      `Practice area(s): ${data.get('areas')}`,
      `Email: ${data.get('email')}`,
      `Members interested: ${data.get('members')}`,
    ].join('\n');

    // mailto fallback — no backend needed for early stage
    window.location.href = `mailto:adrian@reasonqa.io?subject=${encodeURIComponent('Design Partner Programme')}&body=${encodeURIComponent(body)}`;
    setSubmitted(true);
  }

  return (
    <div className="mx-auto max-w-xl py-12">
      <h1
        className="text-2xl font-semibold text-[#1A1A2E]"
        style={{ fontFamily: 'var(--font-serif)' }}
      >
        ReasonQA Design Partner Programme
      </h1>

      <p className="mt-4 text-sm leading-relaxed text-[#4A4A68]">
        We&apos;re offering 5 chambers free access to ReasonQA for 3 months in
        exchange for monthly feedback and permission to use anonymised
        testimonials.
      </p>

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <div>
          <h2 className="text-sm font-semibold text-[#1A1A2E]">What you get</h2>
          <ul className="mt-2 space-y-1 text-sm text-[#4A4A68]">
            <li>Free access for up to 5 members for 3 months</li>
            <li>Priority feature requests</li>
            <li>Direct line to the founder for support</li>
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-[#1A1A2E]">What we ask</h2>
          <ul className="mt-2 space-y-1 text-sm text-[#4A4A68]">
            <li>A 30-minute feedback session each month</li>
            <li>Permission to use anonymised quotes in marketing</li>
            <li>Honest assessment of what works and what doesn&apos;t</li>
          </ul>
        </div>
      </div>

      {submitted ? (
        <div className="mt-10 rounded border border-[#E5E7EB] bg-[#FAFBFC] p-6 text-center">
          <p className="text-sm text-[#4A4A68]">
            Thank you &mdash; your email client should have opened with the
            details. If it didn&apos;t, please email{' '}
            <a href="mailto:adrian@reasonqa.io" className="text-[#1B2A4A] underline">
              adrian@reasonqa.io
            </a>{' '}
            directly.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-10 space-y-4">
          <Field name="name" label="Name" required />
          <Field name="chambers" label="Chambers" required />
          <Field name="areas" label="Practice area(s)" />
          <Field name="email" label="Email" type="email" required />
          <Field name="members" label="Number of members interested" type="number" />
          <button
            type="submit"
            className="w-full rounded bg-[#1B2A4A] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#263D6A]"
          >
            Submit
          </button>
        </form>
      )}
    </div>
  );
}

function Field({
  name,
  label,
  type = 'text',
  required = false,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium text-[#1A1A2E]">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        className="mt-1 w-full rounded border border-[#D1D5DB] px-3 py-2 text-sm text-[#1A1A2E] focus:border-[#1B2A4A] focus:outline-none focus:ring-1 focus:ring-[#1B2A4A]"
      />
    </div>
  );
}
