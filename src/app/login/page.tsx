'use client';

import { createClient } from '@/lib/supabase/client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isReasonQA, setIsReasonQA] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [useMagicLink, setUseMagicLink] = useState(false);
  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    setIsReasonQA(window.location.hostname.includes('reasonqa'));
  }, []);

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const redirectTo = isReasonQA
      ? `${window.location.origin}/auth/callback?next=/reasonqa/dashboard`
      : `${window.location.origin}/auth/callback`;

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });

    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setMagicLinkSent(true);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      setError(error.message);
    } else {
      router.push(isReasonQA ? '/reasonqa/dashboard' : '/');
    }
  }

  if (isReasonQA) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="w-full max-w-sm space-y-6 p-8">
          <div className="text-center">
            <h1 className="text-2xl font-semibold text-[#1A1A2E]" style={{ fontFamily: 'Source Serif 4, Georgia, serif' }}>ReasonQA</h1>
            <p className="mt-2 text-sm text-[#8B8BA3]">Sign in to continue</p>
          </div>

          {magicLinkSent ? (
            <div className="text-center space-y-3">
              <p className="text-sm text-[#1A1A2E]">Check your email</p>
              <p className="text-xs text-[#8B8BA3]">
                We&apos;ve sent a sign-in link to <span className="font-medium text-[#1A1A2E]">{email}</span>. Click the link in the email to sign in. You can close this tab.
              </p>
              <button
                onClick={() => { setMagicLinkSent(false); setUseMagicLink(false); }}
                className="text-xs text-[#1B2A4A] hover:underline"
              >
                Try a different method
              </button>
            </div>
          ) : useMagicLink ? (
            <form onSubmit={handleMagicLink} className="space-y-4">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                required
                className="w-full rounded border border-[#D1D5DB] bg-[#F8F9FA] px-4 py-3 text-[#1A1A2E] placeholder-[#C4C4D4] focus:border-[#1B2A4A] focus:outline-none focus:ring-1 focus:ring-[#1B2A4A]"
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded bg-[#1B2A4A] px-4 py-3 font-medium text-white transition-colors hover:bg-[#263D6A] disabled:opacity-50"
              >
                {loading ? 'Sending...' : 'Send sign-in link'}
              </button>
              {error && <p className="text-sm text-[#A63D40]">{error}</p>}
              <button
                type="button"
                onClick={() => setUseMagicLink(false)}
                className="w-full text-xs text-[#8B8BA3] hover:text-[#1A1A2E]"
              >
                Sign in with password instead
              </button>
            </form>
          ) : (
            <form onSubmit={handleLogin} className="space-y-4">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                required
                className="w-full rounded border border-[#D1D5DB] bg-[#F8F9FA] px-4 py-3 text-[#1A1A2E] placeholder-[#C4C4D4] focus:border-[#1B2A4A] focus:outline-none focus:ring-1 focus:ring-[#1B2A4A]"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                required
                className="w-full rounded border border-[#D1D5DB] bg-[#F8F9FA] px-4 py-3 text-[#1A1A2E] placeholder-[#C4C4D4] focus:border-[#1B2A4A] focus:outline-none focus:ring-1 focus:ring-[#1B2A4A]"
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded bg-[#1B2A4A] px-4 py-3 font-medium text-white transition-colors hover:bg-[#263D6A] disabled:opacity-50"
              >
                {loading ? 'Signing in...' : 'Sign in'}
              </button>
              {error && <p className="text-sm text-[#A63D40]">{error}</p>}
              <button
                type="button"
                onClick={() => setUseMagicLink(true)}
                className="w-full text-xs text-[#8B8BA3] hover:text-[#1A1A2E]"
              >
                Sign in with email link instead
              </button>
            </form>
          )}

          <p className="text-center text-xs text-[#C4C4D4]">
            ReasonQA analyses the structural integrity of legal reasoning.
          </p>
        </div>
      </div>
    );
  }

  // Jasper login (original dark theme)
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="max-w-sm w-full space-y-6 p-8">
        <div className="text-center">
          <h1 className="text-3xl font-medium text-white">Jasper</h1>
          <p className="text-gray-400 mt-2">Sign in to continue</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            required
            className="w-full px-4 py-3 bg-gray-900 border border-gray-800 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            required
            className="w-full px-4 py-3 bg-gray-900 border border-gray-800 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 rounded-lg text-white font-medium transition-colors"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </form>
      </div>
    </div>
  );
}
