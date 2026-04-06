'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { StatusBadge, QualityBadge } from './status-badge';
import type { AnalysisStatus } from '@/lib/reasonqa/types';

interface AnalysisRow {
  id: string;
  status: string;
  title: string | null;
  doc_type: string;
  created_at: string;
  quality: string | null;
}

export function AnalysisList({ analyses }: { analyses: AnalysisRow[] }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<string | null>(null);

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    setDeleting(id);
    try {
      const res = await fetch(`/api/reasonqa/analysis/${id}`, { method: 'DELETE' });
      if (res.ok) {
        router.refresh();
      }
    } catch {
      // ignore
    }
    setDeleting(null);
  }

  return (
    <div className="mt-6 space-y-3">
      {analyses.map((a) => {
        const isFailed = a.status === 'error';
        const isStuck = !['complete', 'error'].includes(a.status) &&
          Date.now() - new Date(a.created_at).getTime() > 300_000; // 5min
        const isInProgress = !['complete', 'error'].includes(a.status);
        const showDelete = isFailed || isStuck || isInProgress;
        const date = new Date(a.created_at).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        });

        return (
          <div
            key={a.id}
            className={`flex items-center justify-between rounded-lg border p-4 ${
              isFailed || isStuck
                ? 'border-gray-800/50 bg-gray-900/50'
                : 'border-gray-800 bg-gray-900 hover:border-gray-700'
            }`}
          >
            <Link
              href={`/reasonqa/analysis/${a.id}`}
              className="min-w-0 flex-1"
            >
              <p className={`truncate font-medium ${isFailed || isStuck ? 'text-gray-500' : 'text-white'}`}>
                {a.title || 'Untitled document'}
              </p>
              <p className="mt-1 text-sm text-gray-500">
                {a.doc_type.toUpperCase()} &middot; {date}
                {isStuck && ' · appears stalled'}
              </p>
            </Link>
            <div className="ml-4 flex items-center gap-3">
              <QualityBadge quality={a.quality} />
              <StatusBadge status={a.status as AnalysisStatus} />
              {showDelete && (
                <button
                  onClick={(e) => handleDelete(e, a.id)}
                  disabled={deleting === a.id}
                  className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-red-950/50 hover:text-red-400"
                  title="Delete this analysis"
                >
                  {deleting === a.id ? '...' : 'Delete'}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
