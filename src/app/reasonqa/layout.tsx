import Link from 'next/link';
import { Source_Serif_4, Source_Sans_3, IBM_Plex_Mono } from 'next/font/google';
import { createClient } from '@/lib/supabase/server';

const serif = Source_Serif_4({
  subsets: ['latin'],
  variable: '--font-serif',
  display: 'swap',
});

const sans = Source_Sans_3({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata = {
  title: 'ReasonQA — Does your reasoning hold?',
};

export default async function ReasonQALayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <div className={`${serif.variable} ${sans.variable} ${mono.variable} min-h-screen bg-white text-[#4A4A68]`} style={{ fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <nav className="border-b border-[#E5E7EB] bg-[#FAFBFC] px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <Link href="/reasonqa" className="text-lg font-semibold text-[#1A1A2E]" style={{ fontFamily: 'var(--font-serif)' }}>
            ReasonQA
          </Link>
          <div className="flex gap-6 text-sm text-[#8B8BA3]">
            {user ? (
              <>
                <Link href="/reasonqa/dashboard" className="hover:text-[#1A1A2E]">
                  Dashboard
                </Link>
                <Link href="/reasonqa/analyse" className="hover:text-[#1A1A2E]">
                  New Analysis
                </Link>
                <Link href="/reasonqa/pricing" className="hover:text-[#1A1A2E]">
                  Pricing
                </Link>
              </>
            ) : (
              <>
                <Link href="/reasonqa/pricing" className="hover:text-[#1A1A2E]">
                  Pricing
                </Link>
                <Link href="/login" className="rounded bg-[#1B2A4A] px-4 py-1.5 text-white hover:bg-[#263D6A]">
                  Sign in
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
