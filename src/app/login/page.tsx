'use client';

import { createClient } from '@/lib/supabase/client';
import { useState } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const supabase = createClient();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setError(error.message);
    } else {
      setSent(true);
    }
  }

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="max-w-sm w-full text-center space-y-4 p-8">
          <h1 className="text-2xl font-medium text-white">Check your email</h1>
          <p className="text-gray-400">
            We sent a magic link to <span className="text-white">{email}</span>.
            Click it to sign in.
          </p>
        </div>
      </div>
    );
  }

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
            placeholder="you@example.com"
            required
            className="w-full px-4 py-3 bg-gray-900 border border-gray-800 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg text-white font-medium transition-colors"
          >
            Send magic link
          </button>
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </form>
      </div>
    </div>
  );
}
