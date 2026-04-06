'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { AnalysisStatus, PassStats } from '@/lib/reasonqa/types';

// Pricing per 1M tokens (USD)
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
  weight: number; // relative weight for progress bar
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

export function AnalysisPoller({
  id,
  initialStatus,
  createdAt,
  initialStats,
  reverify,
}: {
  id: string;
  initialStatus: AnalysisStatus;
  createdAt: string;
  initialStats?: PassStats | null;
  reverify?: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<AnalysisStatus>(initialStatus);
  const [stats, setStats] = useState<PassStats | null>(initialStats || null);
  const [error, setError] = useState<string | null>(null);
  const startTime = useRef(new Date(createdAt).getTime());
  const [elapsedMs, setElapsedMs] = useState(Date.now() - startTime.current);

  const STEPS = reverify ? REVERIFY_STEPS : FULL_STEPS;
  const TOTAL_WEIGHT = STEPS.reduce((s, step) => s + step.weight, 0);

  // Elapsed time ticker — anchored to analysis created_at
  useEffect(() => {
    if (status === 'complete' || status === 'error') return;
    const timer = setInterval(() => setElapsedMs(Date.now() - startTime.current), 1000);
    return () => clearInterval(timer);
  }, [status]);

  // Pipeline runs via Inngest — poller just watches status.

  // Poll for status
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
          // Hard reload to ensure fresh server render with complete data
          window.location.reload();
        }
      } catch { /* retry */ }
    }, 2000);

    return () => clearInterval(interval);
  }, [id, status, router]);

  // Progress calculation — interpolate within active step using elapsed time
  const currentIdx = STEPS.findIndex(s => s.key === status);
  const completedWeight = STEPS.slice(0, currentIdx).reduce((s, step) => s + step.weight, 0);
  const currentStep = STEPS[currentIdx] || STEPS[0];

  // Estimate how far through the current step we are
  // Use average of completed pass durations, or a default of 60s for the first pass
  const completedMs = (stats?.pass1?.durationMs || 0) + (stats?.pass2?.durationMs || 0) + (stats?.pass3?.durationMs || 0);
  const completedPassCount = [stats?.pass1, stats?.pass2, stats?.pass3].filter(Boolean).length;
  const avgPassMs = completedPassCount > 0 ? completedMs / completedPassCount : 60_000;

  // Time spent in current step = total elapsed - sum of completed pass durations
  const timeInCurrentStep = Math.max(0, elapsedMs - completedMs);
  // Estimated duration of current step based on its weight relative to known pass durations
  const estimatedStepMs = currentStep.weight > 0 ? avgPassMs * (currentStep.weight / 25) : avgPassMs;
  // Fraction through current step (cap at 95% — never show 100% until actually done)
  const stepFraction = Math.min(0.95, timeInCurrentStep / Math.max(estimatedStepMs, 1));
  const interpolatedWeight = completedWeight + currentStep.weight * stepFraction;
  const progress = status === 'error' ? 0 : status === 'complete' ? 100 : Math.round((interpolatedWeight / TOTAL_WEIGHT) * 100);

  // Time estimate based on completed passes
  const completedStepWeight = completedWeight;
  const remainingWeight = TOTAL_WEIGHT - interpolatedWeight;
  let estimatedRemainingMs = 0;
  if (completedMs > 0 && completedStepWeight > 0) {
    const msPerWeight = completedMs / completedStepWeight;
    estimatedRemainingMs = msPerWeight * remainingWeight;
  }

  // Token and cost totals
  const totalInputTokens = (stats?.pass1?.inputTokens || 0) + (stats?.pass2?.inputTokens || 0) + (stats?.pass3?.inputTokens || 0);
  const totalOutputTokens = (stats?.pass1?.outputTokens || 0) + (stats?.pass2?.outputTokens || 0) + (stats?.pass3?.outputTokens || 0);
  const totalCost = stats ? estimateCost(stats) : 0;

  // Only show stuck warning if the status hasn't changed for a long time.
  // If passes are completing, the pipeline is working even if it's slow.
  const lastChangeRef = useRef(startTime.current);
  const prevStatusRef = useRef(initialStatus);
  if (status !== prevStatusRef.current) {
    prevStatusRef.current = status;
    lastChangeRef.current = Date.now();
  }
  const msSinceLastChange = elapsedMs > 0 ? Date.now() - lastChangeRef.current : 0;
  const isStuck = msSinceLastChange > 300_000 && status !== 'complete' && status !== 'error'; // same status for 5min

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center pt-16">
        <div className="rounded-full bg-red-900/50 px-3 py-1 text-sm text-red-300">Error</div>
        <p className="mt-4 text-sm text-gray-500">{error || 'Analysis failed'}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md pt-12">
      {/* Current step */}
      <div className="text-center">
        <p className="text-lg font-medium text-white">{currentStep.label}</p>
        <p className="mt-1 text-sm text-gray-400">{currentStep.description}</p>
      </div>

      {/* Progress bar */}
      <div className="mt-6 h-2 overflow-hidden rounded-full bg-gray-800">
        <div
          className="h-full rounded-full bg-blue-600 transition-all duration-700"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between text-xs text-gray-600">
        <span>{progress}%</span>
        <span>{formatDuration(elapsedMs)} elapsed</span>
      </div>

      {/* Time estimate — only show once we have real data from at least one pass */}
      {completedPassCount > 0 && status !== 'complete' && estimatedRemainingMs > 0 && (
        <p className="mt-3 text-center text-sm text-gray-600">
          estimated ~{formatDuration(estimatedRemainingMs)} remaining (may vary)
        </p>
      )}

      {/* Stuck warning with retry options */}
      {isStuck && (
        <div className="mt-4 text-center">
          <p className="text-sm text-yellow-500">
            This analysis appears to have stalled.
          </p>
          <div className="mt-3 flex justify-center gap-3">
            {(status === 'pass3' || status === 'metrics') && (
              <button
                onClick={() => {
                  // Create a re-verify from this analysis
                  fetch('/api/reasonqa/reverify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ analysisId: id }),
                  }).then(res => res.json()).then(data => {
                    if (data.id) window.location.href = `/reasonqa/analysis/${data.id}`;
                  }).catch(() => {});
                }}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
              >
                Retry verification only
              </button>
            )}
            <a
              href="/reasonqa/analyse"
              className="rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-sm text-gray-300 hover:border-gray-600 hover:text-white"
            >
              Start over
            </a>
          </div>
        </div>
      )}

      {/* Step breakdown */}
      <div className="mt-8 space-y-2">
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
              {/* Status indicator */}
              <div className={`h-2 w-2 rounded-full ${
                isDone ? 'bg-green-500' : isActive ? 'bg-blue-500 animate-pulse' : 'bg-gray-700'
              }`} />

              {/* Label */}
              <span className={`flex-1 text-sm ${
                isDone ? 'text-gray-400' : isActive ? 'text-white' : 'text-gray-600'
              }`}>
                {step.label}
              </span>

              {/* Stats (if done) */}
              {passStat && (
                <span className="text-xs text-gray-600">
                  {formatDuration(passStat.durationMs)}
                  {' · '}
                  {formatTokens(passStat.inputTokens + passStat.outputTokens)} tok
                </span>
              )}

              {/* Corpus stats */}
              {step.key === 'pass2' && stats?.corpus && isDone && (
                <span className="text-xs text-gray-600">
                  {stats.corpus.found}/{stats.corpus.fetched} sources
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Token/cost summary */}
      {(totalInputTokens > 0 || totalOutputTokens > 0) && (
        <div className="mt-6 flex justify-center gap-6 border-t border-gray-800 pt-4 text-xs text-gray-600">
          <span>{formatTokens(totalInputTokens)} in</span>
          <span>{formatTokens(totalOutputTokens)} out</span>
          {totalCost > 0 && <span>${totalCost.toFixed(3)}</span>}
        </div>
      )}
    </div>
  );
}
