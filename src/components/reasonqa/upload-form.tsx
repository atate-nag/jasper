'use client';

import { useState, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { AnalysisMode } from '@/lib/reasonqa/types';

const ACCEPTED = '.pdf,.docx,.pptx,.txt,.md';

// Estimate text chars from file size — binary formats (PDF/DOCX/PPTX) compress heavily
function estimateTextChars(fileSize: number, fileName: string): number {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  // Binary formats: text is typically 20-40% of file size
  if (ext === 'pdf' || ext === 'docx' || ext === 'pptx') {
    return Math.round(fileSize * 0.3);
  }
  // Plain text: chars ≈ bytes
  return fileSize;
}

function estimateTokens(charCount: number): number {
  return Math.ceil((charCount / 4)); // ~4 chars per token
}

// Pricing per 1M tokens (USD)
const SONNET_IN = 3;
const SONNET_OUT = 15;
const OPUS_IN = 15;
const OPUS_OUT = 75;
const HAIKU_IN = 0.80;
const HAIKU_OUT = 4;

interface Estimate {
  timeMinLow: number;
  timeMinHigh: number;
  costLow: number;
  costHigh: number;
}

function estimateFull(textChars: number): Estimate {
  const docTokens = estimateTokens(textChars);

  // Pass 1 (Sonnet): doc + prompt in, nodes out
  const p1In = docTokens + 2000;
  const p1Out = Math.min(docTokens * 0.8, 14000);
  // Pass 2 (Sonnet): doc + nodes + prompt in, edges out
  const p2In = docTokens + p1Out + 2000;
  const p2Out = Math.min(p1Out * 0.6, 14000);
  // Pass 3 (Opus): doc + nodes + edges + corpus + interpretive context + prompt
  const corpusTokens = 8000; // fetched source material
  const interpretiveTokens = 5000; // citation treatment context
  const p3In = docTokens + p1Out + p2Out + corpusTokens + interpretiveTokens + 3000;
  const p3Out = Math.min(p1Out * 0.8, 14000);
  // Interpretive context: ~50-100 Haiku calls at ~600 tokens each
  const haikuCalls = 60;
  const haikuIn = haikuCalls * 500;
  const haikuOut = haikuCalls * 80;

  const costSonnet = ((p1In + p2In) / 1e6) * SONNET_IN + ((p1Out + p2Out) / 1e6) * SONNET_OUT;
  const costOpus = (p3In / 1e6) * OPUS_IN + (p3Out / 1e6) * OPUS_OUT;
  const costHaiku = (haikuIn / 1e6) * HAIKU_IN + (haikuOut / 1e6) * HAIKU_OUT;
  const totalCost = costSonnet + costOpus + costHaiku;

  // Time: each Sonnet pass ~1-2min, Opus ~2-4min, corpus+interpretive ~2-3min (parallel with passes)
  // Effective total: P1 + max(P2, corpus+interpretive) + P3
  const p1TimeMin = 1 + docTokens / 8000; // ~8k tok/min for Sonnet
  const p2TimeMin = 1 + docTokens / 8000;
  const corpusTimeMin = 2; // search + fetch + classify
  const p3TimeMin = 2 + docTokens / 4000; // ~4k tok/min for Opus
  const totalTimeMin = p1TimeMin + Math.max(p2TimeMin, corpusTimeMin) + p3TimeMin;

  return {
    costLow: totalCost * 0.6,
    costHigh: totalCost * 1.8,
    timeMinLow: Math.max(4, totalTimeMin * 0.7),
    timeMinHigh: Math.max(8, totalTimeMin * 1.5),
  };
}

function estimateQuick(textChars: number): Estimate {
  const docTokens = estimateTokens(textChars);
  const inTokens = docTokens + 2000;
  const outTokens = Math.min(docTokens * 0.5, 14000);
  const cost = (inTokens / 1e6) * SONNET_IN + (outTokens / 1e6) * SONNET_OUT;

  return {
    costLow: cost * 0.6,
    costHigh: cost * 1.8,
    timeMinLow: 0.5,
    timeMinHigh: Math.max(2, 1 + docTokens / 6000),
  };
}

function formatCostRange(low: number, high: number): string {
  if (high < 0.01) return '<$0.01';
  return `$${low.toFixed(2)}–$${high.toFixed(2)}`;
}

function formatTimeRange(low: number, high: number): string {
  const fmt = (m: number) => {
    if (m < 1) return `${Math.round(m * 60)}s`;
    return `${Math.round(m)}min`;
  };
  return `${fmt(low)}–${fmt(high)}`;
}

export function UploadForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<AnalysisMode>('full');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgradeUrl, setUpgradeUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const estimates = useMemo(() => {
    if (!file) return null;
    const textChars = estimateTextChars(file.size, file.name);
    return {
      full: estimateFull(textChars),
      quick: estimateQuick(textChars),
    };
  }, [file]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;

    setLoading(true);
    setError(null);

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('mode', mode);

      const res = await fetch('/api/reasonqa/analyse', {
        method: 'POST',
        body: form,
      });

      const data = await res.json();
      if (!res.ok) {
        if (data.upgradeUrl) {
          setError(data.error);
          setUpgradeUrl(data.upgradeUrl);
        } else {
          setError(data.error || 'Upload failed');
        }
        setLoading(false);
        return;
      }

      // Pipeline runs via Inngest — redirect to polling page
      window.location.href = `/reasonqa/analysis/${data.id}`;
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* File drop zone */}
      <div
        className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors ${
          dragOver
            ? 'border-blue-500 bg-blue-950/20'
            : 'border-gray-700 bg-gray-900'
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') fileRef.current?.click(); }}
      >
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
        {file ? (
          <div className="text-center">
            <p className="font-medium text-white">{file.name}</p>
            <p className="mt-1 text-sm text-gray-400">
              {(file.size / 1024).toFixed(0)} KB
            </p>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-gray-400">Drop a document here or click to select</p>
            <p className="mt-1 text-sm text-gray-600">PDF, DOCX, PPTX, TXT, or Markdown</p>
          </div>
        )}
      </div>

      {/* Mode selection — only show after file is selected */}
      {file && estimates && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-400">Choose analysis depth</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {/* Full analysis */}
            <button
              type="button"
              onClick={() => setMode('full')}
              className={`rounded-lg border p-4 text-left transition-colors ${
                mode === 'full'
                  ? 'border-blue-500 bg-blue-950/20'
                  : 'border-gray-700 bg-gray-900 hover:border-gray-600'
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="font-medium text-white">Full Analysis</p>
                {mode === 'full' && (
                  <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs text-white">Selected</span>
                )}
              </div>
              <p className="mt-1 text-xs text-gray-400">
                Three-pass pipeline: claim extraction, graph construction, Opus verification with corpus lookup
              </p>
              <div className="mt-3 flex gap-4 text-xs text-gray-500">
                <span>{formatTimeRange(estimates.full.timeMinLow, estimates.full.timeMinHigh)}</span>
                <span>{formatCostRange(estimates.full.costLow, estimates.full.costHigh)}</span>
              </div>
            </button>

            {/* Quick analysis */}
            <button
              type="button"
              onClick={() => setMode('quick')}
              className={`rounded-lg border p-4 text-left transition-colors ${
                mode === 'quick'
                  ? 'border-blue-500 bg-blue-950/20'
                  : 'border-gray-700 bg-gray-900 hover:border-gray-600'
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="font-medium text-white">Quick Scan</p>
                {mode === 'quick' && (
                  <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs text-white">Selected</span>
                )}
              </div>
              <p className="mt-1 text-xs text-gray-400">
                Single-pass: key claims, major issues, and overall assessment. No graph or corpus lookup.
              </p>
              <div className="mt-3 flex gap-4 text-xs text-gray-500">
                <span>{formatTimeRange(estimates.quick.timeMinLow, estimates.quick.timeMinHigh)}</span>
                <span>{formatCostRange(estimates.quick.costLow, estimates.quick.costHigh)}</span>
              </div>
            </button>
          </div>
          <p className="text-xs text-gray-600">
            Estimates based on document size ({(file.size / 1024).toFixed(0)} KB). Actual costs depend on document complexity.
          </p>
        </div>
      )}

      {error && (
        <div className="text-sm text-red-400">
          <p>{error}</p>
          {upgradeUrl && (
            <a href={upgradeUrl} className="mt-1 inline-block text-blue-400 hover:underline">
              Upgrade to Pro &rarr;
            </a>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={!file || loading}
        className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading
          ? 'Uploading...'
          : file
            ? `Run ${mode === 'full' ? 'Full Analysis' : 'Quick Scan'}`
            : 'Select a document'}
      </button>

      {loading && (
        <p className="text-center text-sm text-gray-500">
          Uploading and starting analysis...
        </p>
      )}
    </form>
  );
}
