import Link from 'next/link';

export const metadata = {
  title: 'ReasonQA — Does your reasoning hold?',
};

export default function ReasonQALayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-200">
      <nav className="border-b border-gray-800 px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <Link href="/reasonqa" className="text-lg font-semibold text-white">
            ReasonQA
          </Link>
          <div className="flex gap-6 text-sm text-gray-400">
            <Link href="/reasonqa/dashboard" className="hover:text-white">
              Dashboard
            </Link>
            <Link href="/reasonqa/analyse" className="hover:text-white">
              New Analysis
            </Link>
            <Link href="/reasonqa/pricing" className="hover:text-white">
              Pricing
            </Link>
          </div>
        </div>
      </nav>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
