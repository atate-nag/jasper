'use client';

import { useEffect, useState, useRef } from 'react';
import type { AnalysisStatus, PassStats } from '@/lib/reasonqa/types';

const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-opus-4-6': { input: 15, output: 75 },
};

function estimateCost(stats: PassStats): number {
  let cost = 0;
  for (const pass of [stats.pass1, stats.pass2, stats.pass3]) {
    if (!pass) continue;
    const p = PRICING[pass.model];
    if (!p) continue;
    cost += (pass.inputTokens / 1_000_000) * p.input;
    cost += (pass.outputTokens / 1_000_000) * p.output;
  }
  return cost;
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

interface StepConfig {
  key: AnalysisStatus;
  label: string;
  description: string;
  weight: number;
}

const FULL_STEPS: StepConfig[] = [
  { key: 'pending', label: 'Preparing', description: 'Parsing your document...', weight: 1 },
  { key: 'pass1', label: 'Extracting claims', description: 'Identifying every proposition in the document', weight: 25 },
  { key: 'pass2', label: 'Mapping reasoning', description: 'Building the argument structure and fetching cited sources', weight: 25 },
  { key: 'metrics', label: 'Analysing structure', description: 'Computing structural metrics from the reasoning graph', weight: 2 },
  { key: 'pass3', label: 'Verifying', description: 'Checking citations, reasoning chains, and overall quality', weight: 40 },
  { key: 'complete', label: 'Complete', description: 'Analysis complete', weight: 7 },
];

const REVERIFY_STEPS: StepConfig[] = [
  { key: 'pass3', label: 'Re-verifying', description: 'Fetching sources and re-checking citations, reasoning, and quality', weight: 85 },
  { key: 'complete', label: 'Complete', description: 'Re-verification complete', weight: 15 },
];

const DIALECTICAL_STEPS: StepConfig[] = [
  { key: 'pass5', label: 'Classifying schemes', description: 'Identifying argumentation patterns in each claim', weight: 10 },
  { key: 'pass6', label: 'Constructing counter-argument', description: 'Building the strongest opposing case', weight: 25 },
  { key: 'pass7', label: 'Synthesising', description: 'Constructing the objectively strongest position', weight: 25 },
  { key: 'pass8', label: 'Testing robustness', description: 'Checking whether the synthesis survives challenge', weight: 20 },
  { key: 'pass9', label: 'Mapping criticality', description: 'Scoring each claim against the objective case', weight: 15 },
  { key: 'complete', label: 'Complete', description: 'Dialectical analysis complete', weight: 5 },
];

export function AnalysisPoller({
  id,
  initialStatus,
  createdAt,
  initialStats,
  reverify,
  dialectical,
  documentName,
  docType,
  mode,
}: {
  id: string;
  initialStatus: AnalysisStatus;
  createdAt: string;
  initialStats?: PassStats | null;
  reverify?: boolean;
  dialectical?: boolean;
  documentName?: string;
  docType?: string;
  mode?: string;
}) {
  const [status, setStatus] = useState<AnalysisStatus>(initialStatus);
  const [stats, setStats] = useState<PassStats | null>(initialStats || null);
  const [error, setError] = useState<string | null>(null);
  const startTime = useRef(new Date(createdAt).getTime());
  const [elapsedMs, setElapsedMs] = useState(Date.now() - startTime.current);

  const STEPS = dialectical ? DIALECTICAL_STEPS : reverify ? REVERIFY_STEPS : FULL_STEPS;
  const TOTAL_WEIGHT = STEPS.reduce((s, step) => s + step.weight, 0);

  useEffect(() => {
    if (status === 'complete' || status === 'error') return;
    const timer = setInterval(() => setElapsedMs(Date.now() - startTime.current), 1000);
    return () => clearInterval(timer);
  }, [status]);

  useEffect(() => {
    if (status === 'complete' || status === 'error') return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/reasonqa/analysis/${id}`);
        if (!res.ok) return;
        const data = await res.json();
        setStatus(data.status);
        if (data.pass_stats) setStats(data.pass_stats);
        if (data.status === 'error') setError(data.error_message);
        if (data.status === 'complete') {
          clearInterval(interval);
          window.location.reload();
        }
      } catch { /* retry */ }
    }, 2000);
    return () => clearInterval(interval);
  }, [id, status]);

  // Progress
  const currentIdx = STEPS.findIndex(s => s.key === status);
  const completedWeight = STEPS.slice(0, currentIdx).reduce((s, step) => s + step.weight, 0);
  const currentStep = STEPS[currentIdx] || STEPS[0];
  const completedMs = (stats?.pass1?.durationMs || 0) + (stats?.pass2?.durationMs || 0) + (stats?.pass3?.durationMs || 0);
  const completedPassCount = [stats?.pass1, stats?.pass2, stats?.pass3].filter(Boolean).length;
  const avgPassMs = completedPassCount > 0 ? completedMs / completedPassCount : 60_000;
  const timeInCurrentStep = Math.max(0, elapsedMs - completedMs);
  const estimatedStepMs = currentStep.weight > 0 ? avgPassMs * (currentStep.weight / 25) : avgPassMs;
  const stepFraction = Math.min(0.95, timeInCurrentStep / Math.max(estimatedStepMs, 1));
  const interpolatedWeight = completedWeight + currentStep.weight * stepFraction;
  const progress = status === 'error' ? 0 : status === 'complete' ? 100 : Math.round((interpolatedWeight / TOTAL_WEIGHT) * 100);

  let estimatedRemainingMs = 0;
  if (completedMs > 0 && completedWeight > 0) {
    estimatedRemainingMs = (completedMs / completedWeight) * (TOTAL_WEIGHT - interpolatedWeight);
  }

  const totalInputTokens = (stats?.pass1?.inputTokens || 0) + (stats?.pass2?.inputTokens || 0) + (stats?.pass3?.inputTokens || 0);
  const totalOutputTokens = (stats?.pass1?.outputTokens || 0) + (stats?.pass2?.outputTokens || 0) + (stats?.pass3?.outputTokens || 0);
  const totalCost = stats ? estimateCost(stats) : 0;

  const lastChangeRef = useRef(startTime.current);
  const prevStatusRef = useRef(initialStatus);
  if (status !== prevStatusRef.current) {
    prevStatusRef.current = status;
    lastChangeRef.current = Date.now();
  }
  const msSinceLastChange = elapsedMs > 0 ? Date.now() - lastChangeRef.current : 0;
  const isStuck = msSinceLastChange > 300_000 && status !== 'complete' && status !== 'error';

  const uploadTime = new Date(createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const modeLabel = mode === 'quick' ? 'Quick Scan' : 'Full Analysis';

  if (status === 'error') {
    return (
      <div className="mx-auto max-w-xl pt-12">
        <div className="border-b border-[#E5E7EB] pb-4">
          <h1 className="text-lg font-semibold text-[#1A1A2E]" style={{ fontFamily: 'var(--font-serif)' }}>
            {documentName || 'Untitled document'}
          </h1>
          <p className="mt-1 text-sm text-[#8B8BA3]">
            {docType?.toUpperCase()} &middot; Uploaded {uploadTime} &middot; {modeLabel}
          </p>
        </div>
        <div className="mt-8 text-center">
          <p className="font-medium text-[#A63D40]">Analysis failed</p>
          <p className="mt-2 text-sm text-[#8B8BA3]">{error}</p>
          <a
            href="/reasonqa/analyse"
            className="mt-4 inline-block rounded border border-[#D1D5DB] px-4 py-2 text-sm text-[#4A4A68] hover:border-[#1B2A4A]"
          >
            Try again
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl pt-8">
      {/* Document header */}
      <div className="border-b border-[#E5E7EB] pb-4">
        <h1 className="text-lg font-semibold text-[#1A1A2E]" style={{ fontFamily: 'var(--font-serif)' }}>
          {documentName || 'Untitled document'}
        </h1>
        <p className="mt-1 text-sm text-[#8B8BA3]">
          {docType?.toUpperCase()} &middot; Uploaded {uploadTime} &middot; {modeLabel}
        </p>
      </div>

      {/* Active step description — prominent, serif */}
      <div className="mt-8 text-center">
        <p className="text-xl text-[#1A1A2E]" style={{ fontFamily: 'var(--font-serif)', lineHeight: 1.4 }}>
          {currentStep.description}
        </p>
      </div>

      {/* Progress bar */}
      <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-[#E5E7EB]">
        <div
          className="h-full rounded-full bg-[#1B2A4A] transition-all duration-700"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between text-xs text-[#8B8BA3]">
        <span>{progress}%</span>
        <span>{formatDuration(elapsedMs)} elapsed</span>
      </div>

      {/* Time estimate or default expectation */}
      <p className="mt-2 text-center text-xs text-[#8B8BA3]">
        {completedPassCount > 0 && estimatedRemainingMs > 0
          ? `Estimated ~${formatDuration(estimatedRemainingMs)} remaining`
          : reverify
            ? 'Typically completes in 3-5 minutes'
            : mode === 'quick'
              ? 'Typically completes in 1-3 minutes'
              : 'Typically completes in 8-12 minutes'
        }
      </p>
      <p className="mt-3 text-center text-xs text-[#C4C4D4]">
        Your document is being processed and will be deleted from our servers when analysis completes.
      </p>

      {/* Step sequence */}
      <div className="mt-10 space-y-3">
        {STEPS.filter(s => s.key !== 'complete').map((step, i) => {
          const stepIdx = STEPS.findIndex(s => s.key === step.key);
          const isDone = currentIdx > stepIdx;
          const isActive = currentIdx === stepIdx;
          const passStat = step.key === 'pass1' ? stats?.pass1
            : step.key === 'pass2' ? stats?.pass2
            : step.key === 'pass3' ? stats?.pass3
            : null;

          return (
            <div key={i} className="flex items-center gap-3">
              {/* Step indicator */}
              <div className="flex h-5 w-5 items-center justify-center">
                {isDone ? (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="#2D7D46" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : isActive ? (
                  <div className="h-3 w-3 rounded-full bg-[#1B2A4A] animate-pulse" />
                ) : (
                  <div className="h-2.5 w-2.5 rounded-full border-[1.5px] border-[#C4C4D4]" />
                )}
              </div>

              {/* Label */}
              <span className={`flex-1 text-sm ${
                isDone ? 'text-[#4A4A68]' : isActive ? 'font-semibold text-[#1A1A2E]' : 'text-[#C4C4D4]'
              }`}>
                {step.label}
              </span>

              {/* Duration (no token counts — internal detail) */}
              {passStat && (
                <span className="text-xs text-[#8B8BA3]">{formatDuration(passStat.durationMs)}</span>
              )}
              {step.key === 'pass2' && stats?.corpus && isDone && (
                <span className="text-xs text-[#8B8BA3]">{stats.corpus.found} source{stats.corpus.found !== 1 ? 's' : ''} retrieved</span>
              )}
            </div>
          );
        })}
      </div>


      {/* Stuck warning */}
      {isStuck && (
        <div className="mt-6 rounded border border-[#B8860B]/30 bg-[#FDF6E3] px-4 py-3 text-center">
          <p className="text-sm text-[#8B6914]">This analysis appears to have stalled.</p>
          <div className="mt-3 flex justify-center gap-3">
            {(status === 'pass3' || status === 'metrics') && (
              <button
                onClick={() => {
                  fetch('/api/reasonqa/reverify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ analysisId: id }),
                  }).then(res => res.json()).then(data => {
                    if (data.id) window.location.href = `/reasonqa/analysis/${data.id}`;
                  }).catch(() => {});
                }}
                className="rounded bg-[#1B2A4A] px-4 py-2 text-sm text-white hover:bg-[#263D6A]"
              >
                Retry verification
              </button>
            )}
            <a
              href="/reasonqa/analyse"
              className="rounded border border-[#D1D5DB] px-4 py-2 text-sm text-[#4A4A68] hover:border-[#1B2A4A]"
            >
              Start over
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
