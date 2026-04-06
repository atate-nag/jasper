import type { AnalysisStatus } from '@/lib/reasonqa/types';

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-900/50 text-yellow-300',
  pass1: 'bg-yellow-900/50 text-yellow-300',
  pass2: 'bg-yellow-900/50 text-yellow-300',
  metrics: 'bg-yellow-900/50 text-yellow-300',
  pass3: 'bg-yellow-900/50 text-yellow-300',
  complete: 'bg-green-900/50 text-green-300',
  error: 'bg-red-900/50 text-red-300',
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
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status] || 'bg-gray-800 text-gray-400'}`}
    >
      {STATUS_LABELS[status] || status}
    </span>
  );
}

const QUALITY_STYLES: Record<string, string> = {
  STRONG: 'text-green-400',
  ADEQUATE: 'text-blue-400',
  MARGINAL: 'text-yellow-400',
  WEAK: 'text-red-400',
};

export function QualityBadge({ quality }: { quality: string | null }) {
  if (!quality) return null;
  return (
    <span className={`text-sm font-semibold ${QUALITY_STYLES[quality] || 'text-gray-400'}`}>
      {quality}
    </span>
  );
}
