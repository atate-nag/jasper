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
  version_group_id?: string;
  version_number?: number;
  analysis_type?: string;
}

export function AnalysisList({ analyses }: { analyses: AnalysisRow[] }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<string | null>(null);

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('This will permanently delete this analysis and its report. Deleted data cannot be recovered.')) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/reasonqa/analysis/${id}`, { method: 'DELETE' });
      if (res.ok) router.refresh();
    } catch { /* ignore */ }
    setDeleting(null);
  }

  return (
    <div className="mt-6 space-y-3">
      {analyses.map((a) => {
        const isFailed = a.status === 'error';
        const isStuck = !['complete', 'error'].includes(a.status) &&
          Date.now() - new Date(a.created_at).getTime() > 300_000;
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
            className={`group flex items-center justify-between rounded border bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-shadow hover:shadow-[0_2px_8px_rgba(0,0,0,0.08)] ${
              isFailed || isStuck
                ? 'border-[#E5E7EB] opacity-60'
                : 'border-[#E5E7EB]'
            }`}
          >
            <Link href={`/reasonqa/analysis/${a.id}`} className="min-w-0 flex-1">
              <p className={`truncate font-medium ${isFailed || isStuck ? 'text-[#8B8BA3]' : 'text-[#1A1A2E]'}`}>
                {a.title || 'Untitled document'}
              </p>
              <p className="mt-1 text-sm text-[#8B8BA3]">
                {a.doc_type.toUpperCase()} &middot; {date}
                {(a.version_number ?? 1) > 1 && ` · v${a.version_number}`}
                {a.analysis_type === 'incremental' && ' · incremental'}
                {isStuck && ' · appears stalled'}
              </p>
            </Link>
            <div className="ml-4 flex items-center gap-4">
              <QualityBadge quality={a.quality} />
              <StatusBadge status={a.status as AnalysisStatus} />
              {showDelete && (
                <button
                  onClick={(e) => handleDelete(e, a.id)}
                  disabled={deleting === a.id}
                  className="hidden rounded px-2 py-1 text-xs text-[#8B8BA3] hover:text-[#A63D40] group-hover:inline-block"
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
