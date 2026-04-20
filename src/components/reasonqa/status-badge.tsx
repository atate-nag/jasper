import type { AnalysisStatus } from '@/lib/reasonqa/types';

const STATUS_STYLES: Record<string, string> = {
  pending: 'text-[#8B8BA3]',
  pass1: 'text-[#B8860B]',
  pass2: 'text-[#B8860B]',
  metrics: 'text-[#B8860B]',
  pass3: 'text-[#B8860B]',
  complete: 'text-[#2D7D46]',
  error: 'text-[#A63D40]',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Preparing...',
  pass1: 'Extracting claims...',
  pass2: 'Mapping reasoning...',
  metrics: 'Analysing structure...',
  pass3: 'Verifying...',
  complete: 'Complete',
  error: 'Error',
};

export function StatusBadge({ status }: { status: AnalysisStatus }) {
  return (
    <span className={`text-xs font-medium ${STATUS_STYLES[status] || 'text-[#8B8BA3]'}`}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

const QUALITY_STYLES: Record<string, string> = {
  STRONG: 'text-[#2D7D46] border-[#2D7D46]',
  ADEQUATE: 'text-[#5B7BA3] border-[#5B7BA3]',
  MARGINAL: 'text-[#B8860B] border-[#B8860B]',
  WEAK: 'text-[#A63D40] border-[#A63D40]',
};

export function QualityBadge({ quality }: { quality: string | null }) {
  if (!quality) return null;
  return (
    <span className={`border-l-[3px] pl-2 text-xs font-semibold uppercase tracking-wide ${QUALITY_STYLES[quality] || 'text-[#8B8BA3]'}`}>
      {quality}
    </span>
  );
}
