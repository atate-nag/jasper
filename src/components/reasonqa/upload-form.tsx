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
  const [dialectical, setDialectical] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgradeUrl, setUpgradeUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [revisionCandidates, setRevisionCandidates] = useState<Array<{
    id: string; title: string; version: number; createdAt: string; similarity: number;
  }> | null>(null);

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
      if (dialectical) form.append('dialectical', 'true');

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

      // Revision detected — show candidates instead of starting analysis
      if (data.revisionDetected && data.candidates?.length > 0) {
        setRevisionCandidates(data.candidates);
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

  async function handleIncremental(parentAnalysisId: string) {
    if (!file) return;
    setLoading(true);
    setError(null);
    setRevisionCandidates(null);

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('mode', 'full');
      form.append('parentAnalysisId', parentAnalysisId);

      const res = await fetch('/api/reasonqa/analyse', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Upload failed');
        setLoading(false);
        return;
      }
      window.location.href = `/reasonqa/analysis/${data.id}`;
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  function handleNewAnalysis() {
    setRevisionCandidates(null);
    // Re-submit as new (the form will submit normally on next click)
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
        className={`flex flex-col items-center justify-center rounded border-2 border-dashed p-12 transition-colors ${
          dragOver
            ? 'border-[#1B2A4A] bg-[#E8ECF4]'
            : 'border-[#D1D5DB] bg-[#F8F9FA]'
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
            <p className="font-medium text-[#1A1A2E]">{file.name}</p>
            <p className="mt-1 text-sm text-[#8B8BA3]">
              {(file.size / 1024).toFixed(0)} KB
            </p>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-[#4A4A68]">Drop a document here or click to select</p>
            <p className="mt-1 text-sm text-[#8B8BA3]">PDF, DOCX, PPTX, TXT, or Markdown</p>
          </div>
        )}
      </div>

      <p className="text-xs leading-relaxed text-[#8B8BA3]">Your document is deleted from our servers immediately after analysis completes. Only the generated report is retained in your account. Document text is processed via Anthropic&apos;s API under zero data retention &mdash; your content is not logged or stored by any third party. You can permanently delete any report at any time.</p>

      {/* Mode selection */}
      {file && estimates && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-[#4A4A68]">Choose analysis depth</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMode('full')}
              className={`rounded border p-4 text-left transition-all ${
                mode === 'full'
                  ? 'border-[#1B2A4A] bg-[#E8ECF4] shadow-[0_1px_2px_rgba(0,0,0,0.05)]'
                  : 'border-[#E5E7EB] bg-white hover:border-[#D1D5DB]'
              }`}
            >
              <p className="font-medium text-[#1A1A2E]">Full Analysis</p>
              <p className="mt-1 text-xs text-[#4A4A68]">
                Claim extraction, graph construction, verification with corpus lookup, argument reconstruction
              </p>
              {mode === 'full' && (
                <label className="mt-3 flex items-center gap-2 text-xs text-[#4A4A68]" onClick={e => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={dialectical}
                    onChange={e => setDialectical(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-[#D1D5DB] accent-[#1B2A4A]"
                  />
                  Include dialectical synthesis (counter-argument + objective case)
                </label>
              )}
              <p className="mt-2 text-xs text-[#8B8BA3]">
                Typically {formatTimeRange(estimates.full.timeMinLow, dialectical ? estimates.full.timeMinHigh + 5 : estimates.full.timeMinHigh)}
              </p>
            </button>

            <button
              type="button"
              onClick={() => setMode('quick')}
              className={`rounded border p-4 text-left transition-all ${
                mode === 'quick'
                  ? 'border-[#1B2A4A] bg-[#E8ECF4] shadow-[0_1px_2px_rgba(0,0,0,0.05)]'
                  : 'border-[#E5E7EB] bg-white hover:border-[#D1D5DB]'
              }`}
            >
              <p className="font-medium text-[#1A1A2E]">Quick Scan</p>
              <p className="mt-1 text-xs text-[#4A4A68]">
                Single-pass: key claims, major issues, and overall assessment. No graph or corpus lookup.
              </p>
              <p className="mt-3 text-xs text-[#8B8BA3]">
                Typically {formatTimeRange(estimates.quick.timeMinLow, estimates.quick.timeMinHigh)}
              </p>
            </button>
          </div>
          <p className="text-xs text-[#8B8BA3]">
            Time estimates based on document size.
          </p>
        </div>
      )}

      {/* Revision detection */}
      {revisionCandidates && revisionCandidates.length > 0 && (
        <div className="rounded border border-[#1B2A4A] bg-[#E8ECF4] p-4">
          <p className="text-sm font-medium text-[#1A1A2E]">
            This looks like a revised version of a previously analysed document.
          </p>
          <div className="mt-3 space-y-2">
            {revisionCandidates.map(c => (
              <button
                key={c.id}
                onClick={() => handleIncremental(c.id)}
                disabled={loading}
                className="w-full rounded border border-[#D1D5DB] bg-white px-4 py-3 text-left hover:border-[#1B2A4A] disabled:opacity-50"
              >
                <p className="text-sm font-medium text-[#1A1A2E]">
                  Update &ldquo;{c.title}&rdquo; (v{c.version})
                </p>
                <p className="mt-0.5 text-xs text-[#8B8BA3]">
                  Incremental analysis &mdash; re-checks only changed sections. ~2 min, doesn&apos;t count against your monthly limit.
                </p>
              </button>
            ))}
          </div>
          <button
            onClick={handleNewAnalysis}
            className="mt-3 text-xs text-[#8B8BA3] hover:text-[#1A1A2E]"
          >
            Analyse as new document instead
          </button>
        </div>
      )}

      {error && (
        <div className="text-sm text-[#A63D40]">
          <p>{error}</p>
          {upgradeUrl && (
            <a href={upgradeUrl} className="mt-1 inline-block text-[#1B2A4A] hover:underline">
              Upgrade to Pro &rarr;
            </a>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={!file || loading}
        className="w-full rounded bg-[#1B2A4A] px-4 py-3 text-sm font-medium text-white hover:bg-[#263D6A] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading
          ? 'Uploading...'
          : file
            ? `Run ${mode === 'full' ? 'Full Analysis' : 'Quick Scan'}`
            : 'Select a document'}
      </button>

      {loading && (
        <p className="text-center text-sm text-[#8B8BA3]">
          Uploading and starting analysis...
        </p>
      )}
    </form>
  );
}
