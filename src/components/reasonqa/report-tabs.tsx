'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Analysis, SourceReference, StructuralIssue, InterpretiveIssue } from '@/lib/reasonqa/types';
import { QualityBadge } from './status-badge';
import { exportAnalysisPDF } from './export-pdf';
import { ReasoningChainView } from './dag/reasoning-chain-view';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <button
      onClick={handleCopy}
      className="ml-auto shrink-0 rounded p-1 text-[#8B8BA3] hover:bg-[#F1F3F5] hover:text-[#4A4A68]"
      title="Copy finding"
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
      )}
    </button>
  );
}

function formatFindingForCopy(type: string, description: string, fix?: string): string {
  let text = `[ReasonQA \u2014 ${type}] ${description}`;
  if (fix) text += `\nFix: ${fix}`;
  return text;
}

function ReverifyButton({ analysisId }: { analysisId: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleReverify() {
    setLoading(true);
    try {
      const res = await fetch('/api/reasonqa/reverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisId }),
      });
      if (res.ok) {
        const { id } = await res.json();
        // Redirect to polling page — it triggers the reverify pipeline on mount
        window.location.href = `/reasonqa/analysis/${id}`;
        return;
      }
    } catch { /* ignore */ }
    setLoading(false);
  }

  return (
    <button
      onClick={handleReverify}
      disabled={loading}
      className="rounded border border-[#1B2A4A] bg-white px-3 py-1.5 text-sm text-[#1B2A4A] hover:bg-[#F8F9FA] disabled:opacity-50"
      title="Re-run corpus lookup and verification (keeps Pass 1 + Pass 2)"
    >
      {loading ? 'Re-verifying...' : 'Re-verify'}
    </button>
  );
}

function DialecticalButton({ analysisId }: { analysisId: string }) {
  const [loading, setLoading] = useState(false);

  async function handleDialectical() {
    setLoading(true);
    try {
      const res = await fetch(`/api/reasonqa/run-dialectical/${analysisId}`, { method: 'POST' });
      if (res.ok) {
        // Page will detect pass5 status and show the dialectical progress poller
        window.location.href = `/reasonqa/analysis/${analysisId}`;
        return;
      }
    } catch { /* ignore */ }
    setLoading(false);
  }

  return (
    <button
      onClick={handleDialectical}
      disabled={loading}
      className="rounded border border-[#1B2A4A] bg-white px-3 py-1.5 text-sm text-[#1B2A4A] hover:bg-[#F8F9FA] disabled:opacity-50"
      title="Run dialectical synthesis — counter-argument, objective case, robustness testing"
    >
      {loading ? 'Running...' : 'Dialectical'}
    </button>
  );
}

function SourceRefBadges({ nodeId, nodeSourceMap }: { nodeId: string; nodeSourceMap: Map<string, string[]> }) {
  const refs = nodeSourceMap.get(nodeId);
  if (!refs || refs.length === 0) return null;
  return (
    <>
      {refs.map(r => (
        <span key={r} className="rounded bg-[#E8ECF4] px-1.5 py-0.5 text-xs text-[#1B2A4A]">
          [{r}]
        </span>
      ))}
    </>
  );
}

type Tab = 'verification' | 'counter-authority' | 'issues' | 'claims' | 'structure' | 'sources' | 'dialectical';

const SEVERITY_STYLES: Record<string, string> = {
  high: 'border-l-[#A63D40]',
  medium: 'border-l-[#B8860B]',
  low: 'border-l-[#8B8BA3]',
};

const ISSUE_TYPE_LABELS: Record<string, string> = {
  missing_warrant: 'Missing warrant',
  unsupported_conclusion: 'Unsupported conclusion',
  unsupported_prescription: 'Unsupported prescription',
  circular_reasoning: 'Circular reasoning',
  qualifier_mismatch: 'Qualifier mismatch',
  contradiction: 'Contradiction',
  over_reliance: 'Over-reliance on single source',
  janus_faced_evidence: 'Janus-faced authority',
  overrelied_contested: 'Overrelied & contested authority',
  eroded_authority: 'Eroded authority',
  uncited_counter_authority: 'Uncited counter-authority',
  stale_authority: 'Stale authority',
};

const INTERPRETIVE_ISSUE_TYPES = new Set([
  'janus_faced_evidence', 'overrelied_contested', 'eroded_authority',
  'uncited_counter_authority', 'stale_authority',
]);

const TYPE_LABELS: Record<string, string> = {
  F: 'Factual',
  M: 'Mechanism',
  V: 'Value',
  P: 'Prescriptive',
};

const TYPE_STYLES: Record<string, string> = {
  F: 'bg-[#F1F3F5] text-[#4A4A68]',
  M: 'bg-[#FDF6E3] text-[#8B6914]',
  V: 'bg-[#E8ECF4] text-[#1B2A4A]',
  P: 'bg-[#E8F5E9] text-[#2D7D46]',
};

const VERIFICATION_STYLES: Record<string, string> = {
  VERIFIED: 'text-[#2D7D46]',
  PARTIAL: 'text-[#B8860B]',
  FAILED: 'text-[#A63D40]',
  UNGROUNDED: 'text-[#8B8BA3]',
  UNTRACEABLE: 'text-[#A63D40]',
  SOURCE_DOCUMENT: 'text-[#5B7BA3]',
};

export function ReportTabs({ analysis }: { analysis: Analysis }) {
  const [tab, setTab] = useState<Tab>('verification');
  const { pass1_output: p1, pass2_output: p2, metrics_output: m, pass3_output: p3, pass4_output: p4, sources } = analysis;

  // Build a lookup: nodeId → source refIds
  const nodeSourceMap = new Map<string, string[]>();
  for (const src of sources || []) {
    for (const nid of src.nodeIds) {
      const refs = nodeSourceMap.get(nid) || [];
      refs.push(src.refId);
      nodeSourceMap.set(nid, refs);
    }
  }

  const hasSources = sources && sources.length > 0;

  // Split issues into counter-authority (interpretive) vs structural
  const allIssues = [...(p2?.structuralIssues || []), ...(p3?.interpretiveIssues || [])];
  const suppressedSet = new Set(p4?.suppressedIssueIndices || []);
  const counterAuthorityIssues = allIssues.filter((issue, i) => !suppressedSet.has(i) && INTERPRETIVE_ISSUE_TYPES.has(issue.issueType));
  const structuralOnlyIssues = allIssues.filter((issue) => !INTERPRETIVE_ISSUE_TYPES.has(issue.issueType));
  const structuralCount = structuralOnlyIssues.filter((_, i) => !suppressedSet.has(i)).length;

  // Verification certificate counts
  const verifications = p3?.verifications || [];
  const verifiedCount = verifications.filter(v => v.status === 'VERIFIED').length;
  const partialCount = verifications.filter(v => v.status === 'PARTIAL').length;
  const failedCount = verifications.filter(v => v.status === 'FAILED').length;
  const untraceableCount = verifications.filter(v => v.status === 'UNTRACEABLE').length;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'verification', label: `Verification (${verifications.length})` },
    ...(counterAuthorityIssues.length > 0 ? [{ key: 'counter-authority' as Tab, label: `Counter-Authorities (${counterAuthorityIssues.length})` }] : []),
    { key: 'issues', label: `Structural Issues (${structuralCount})` },
    { key: 'claims', label: `Claims (${p1?.nodes?.length || 0})` },
    { key: 'structure', label: 'Structure' },
    ...(hasSources ? [{ key: 'sources' as Tab, label: `Sources (${sources!.length})` }] : []),
    ...(analysis.pass9_output ? [{ key: 'dialectical' as Tab, label: 'Dialectical' }] : []),
  ];

  return (
    <div>
      {/* Top disclaimer */}
      <p className="mb-4 text-xs leading-relaxed text-[#C4C4D4]">
        This analysis is generated by AI and may contain errors. It is not legal advice. Verify all findings independently before reliance. Counter-authorities identified through automated search should be confirmed against primary sources.
      </p>

      {/* Summary header */}
      <div className="flex flex-wrap items-center gap-4 border-b border-[#E5E7EB] pb-6">
        <h1 className="text-xl font-semibold text-[#1A1A2E]" style={{ fontFamily: 'var(--font-serif)' }}>
          {analysis.title || 'Untitled document'}
        </h1>
        <QualityBadge quality={p4?.qualityAdjustment?.adjustedRating || p3?.assessment?.quality || null} />
        {m && (
          <span className="text-sm text-[#8B8BA3]">
            {m.totalNodes} claims &middot; {m.totalEdges} connections
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <ReverifyButton analysisId={analysis.id} />
          {!analysis.pass9_output && analysis.pass4_output && (
            <DialecticalButton analysisId={analysis.id} />
          )}
          <button
            onClick={() => exportAnalysisPDF(analysis)}
            className="rounded border border-[#1B2A4A] bg-white px-3 py-1.5 text-sm text-[#1B2A4A] hover:bg-[#F8F9FA]"
          >
            Export PDF
          </button>
        </div>
      </div>

      {/* Verification certificate */}
      {verifications.length > 0 && (
        <div className="mt-4 rounded border border-[#E5E7EB] bg-[#FAFBFC] px-4 py-3 text-sm" style={{ fontFamily: 'var(--font-mono)' }}>
          <span className="font-semibold text-[#1A1A2E]">VERIFICATION:</span>{' '}
          {verifications.length} citations checked
          {verifiedCount > 0 && <> &middot; <span className="text-green-700">{verifiedCount} verified</span></>}
          {partialCount > 0 && <> &middot; <span className="text-amber-700">{partialCount} partial</span></>}
          {failedCount > 0 && <> &middot; <span className="text-[#A63D40]">{failedCount} failed</span></>}
          {untraceableCount > 0 && <> &middot; <span className="text-[#8B8BA3]">{untraceableCount} untraceable</span></>}
          {counterAuthorityIssues.length > 0 && <> &middot; <span className="text-[#B8860B]">{counterAuthorityIssues.length} counter-authorit{counterAuthorityIssues.length === 1 ? 'y' : 'ies'} identified</span></>}
        </div>
      )}

      {/* Summary paragraph */}
      {p3?.assessment?.summary && (
        <p className="mt-6 text-[#1A1A2E] leading-[1.75]" style={{ fontFamily: 'var(--font-serif)', fontSize: '1.05rem' }}>
          {p3.assessment.summary}
        </p>
      )}

      {/* Pass 4: Argument intent + quality adjustment */}
      {p4 && (
        <div className="mt-4 space-y-2">
          {p4.argumentIntent && (
            <p className="text-sm text-[#4A4A68]">
              <span className="font-semibold text-[#1A1A2E]">Argument intent: </span>
              {p4.argumentIntent}
            </p>
          )}
          {p4.qualityAdjustment && p4.qualityAdjustment.adjustedRating !== p4.qualityAdjustment.originalRating && (
            <p className="text-sm text-[#4A4A68]">
              <span className="font-semibold text-[#1A1A2E]">Quality adjusted: </span>
              {p4.qualityAdjustment.originalRating} → {p4.qualityAdjustment.adjustedRating}
              <span className="text-[#8B8BA3]"> — {p4.qualityAdjustment.reason}</span>
            </p>
          )}
          {p4.suppressionCount > 0 && (
            <p className="text-xs text-[#8B8BA3]">
              {p4.suppressionCount} over-formalized issue{p4.suppressionCount > 1 ? 's' : ''} suppressed from the report.
            </p>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="mt-8 flex gap-1 border-b border-[#E5E7EB]">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? 'border-b-2 border-[#1B2A4A] text-[#1A1A2E]'
                : 'text-[#8B8BA3] hover:text-[#4A4A68]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="mt-6">
        {tab === 'counter-authority' && <CounterAuthorityTab issues={counterAuthorityIssues} nodes={p1?.nodes || []} nodeSourceMap={nodeSourceMap} />}
        {tab === 'issues' && <IssuesTab issues={structuralOnlyIssues} nodes={p1?.nodes || []} nodeSourceMap={nodeSourceMap} pass4={p4} />}
        {tab === 'claims' && <ClaimsTab nodes={p1?.nodes || []} verifications={p3?.verifications || []} nodeSourceMap={nodeSourceMap} />}
        {tab === 'structure' && <StructureTab metrics={m} analysis={analysis} />}
        {tab === 'verification' && <VerificationTab pass3={p3} nodeSourceMap={nodeSourceMap} />}
        {tab === 'sources' && <SourcesTab sources={sources || []} />}
        {tab === 'dialectical' && analysis.pass9_output && <DialecticalTab analysis={analysis} />}
      </div>

      {/* Bottom disclaimer */}
      <div className="mt-10 border-t border-[#E5E7EB] pt-4 text-xs leading-relaxed text-[#C4C4D4]">
        <p>
          Generated by ReasonQA on {new Date(analysis.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}. This report analyses the structural integrity of legal reasoning in the uploaded document. It does not constitute legal advice, an opinion on the merits, or a guarantee of completeness. The analysis may miss issues that a qualified legal professional would identify. All findings should be independently verified.
        </p>
      </div>
    </div>
  );
}

const CRITICALITY_STYLES: Record<string, string> = {
  CRITICAL: 'bg-[#A63D40] text-white',
  SIGNIFICANT: 'bg-[#B8860B] text-white',
  CONTEXTUAL: 'bg-[#E5E7EB] text-[#4A4A68]',
};

function IssuesTab({
  issues,
  nodes,
  nodeSourceMap,
  pass4,
}: {
  issues: NonNullable<Analysis['pass2_output']>['structuralIssues'];
  nodes: NonNullable<Analysis['pass1_output']>['nodes'];
  nodeSourceMap: Map<string, string[]>;
  pass4?: Analysis['pass4_output'];
}) {
  if (issues.length === 0) {
    return <p className="text-[#8B8BA3]">No structural issues found.</p>;
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Sort by severity: high first
  // Build criticality map from Pass 4
  const suppressedSet = new Set(pass4?.suppressedIssueIndices || []);
  const critMap = new Map<number, { criticality: string; consequenceChain?: string; overFormalized?: boolean }>();
  for (const ca of pass4?.criticalityAssessments || []) {
    critMap.set(ca.issueIndex, ca);
  }

  // Filter suppressed, sort by criticality then severity
  const critOrder: Record<string, number> = { CRITICAL: 0, SIGNIFICANT: 1, CONTEXTUAL: 2 };
  const sevOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const filtered = issues.filter((_, i) => !suppressedSet.has(i));
  const sorted = [...filtered].sort((a, b) => {
    const aIdx = issues.indexOf(a);
    const bIdx = issues.indexOf(b);
    const aCrit = critMap.get(aIdx)?.criticality || 'CONTEXTUAL';
    const bCrit = critMap.get(bIdx)?.criticality || 'CONTEXTUAL';
    const critDiff = (critOrder[aCrit] ?? 3) - (critOrder[bCrit] ?? 3);
    if (critDiff !== 0) return critDiff;
    return (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3);
  });

  return (
    <div className="space-y-4">
      {sorted.map((issue, i) => {
        const origIdx = issues.indexOf(issue);
        const crit = critMap.get(origIdx);
        return (
        <div
          key={i}
          className={`border-l-4 bg-[#FAFBFC] py-3 pl-4 pr-4 ${SEVERITY_STYLES[issue.severity] || SEVERITY_STYLES.low}`}
        >
          <div className="flex items-center gap-2">
            {crit && (
              <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${CRITICALITY_STYLES[crit.criticality] || ''}`}>
                {crit.criticality}
              </span>
            )}
            <span className="text-xs font-semibold uppercase tracking-wide text-[#8B8BA3]">
              {issue.severity}
            </span>
            <span className="text-xs text-[#8B8BA3]">{ISSUE_TYPE_LABELS[issue.issueType] || issue.issueType}</span>
            {INTERPRETIVE_ISSUE_TYPES.has(issue.issueType) && (
              <span className="rounded bg-[#E8ECF4] px-1.5 py-0.5 text-xs font-medium text-[#1B2A4A]">interpretive</span>
            )}
            <CopyButton text={formatFindingForCopy(ISSUE_TYPE_LABELS[issue.issueType] || issue.issueType, issue.description, issue.suggestedFix)} />
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-[#4A4A68]">{issue.description}</p>
          {crit?.consequenceChain && (
            <p className="mt-2 rounded border-l-2 border-[#A63D40] bg-[#F8F0F0] py-2 pl-3 pr-3 text-xs leading-relaxed text-[#4A4A68]">
              <span className="font-semibold text-[#A63D40]">Consequence: </span>
              {crit.consequenceChain}
            </p>
          )}
          {issue.suggestedFix && (
            <p className="mt-2 rounded bg-[#F1F3F5] px-3 py-2 text-sm text-[#4A4A68]">
              <span className="font-medium text-[#1A1A2E]">Fix: </span>
              {issue.suggestedFix}
            </p>
          )}
          {issue.nodeIds.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {issue.nodeIds.map((id) => {
                const node = nodeMap.get(id);
                return (
                  <span key={id} className="inline-flex items-center gap-1">
                    <span className="rounded bg-[#F1F3F5] px-1.5 py-0.5 text-xs text-[#4A4A68]" title={node?.text}>
                      {id}
                    </span>
                    <SourceRefBadges nodeId={id} nodeSourceMap={nodeSourceMap} />
                  </span>
                );
              })}
            </div>
          )}
        </div>
        );
      })}

      {/* Suppressed issues — visible but clearly marked */}
      {pass4 && suppressedSet.size > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-xs text-[#8B8BA3] hover:text-[#4A4A68]">
            {suppressedSet.size} suppressed issue{suppressedSet.size > 1 ? 's' : ''} (over-formalized)
          </summary>
          <div className="mt-2 space-y-2">
            {issues.filter((_, i) => suppressedSet.has(i)).map((issue, i) => {
              const origIdx = issues.indexOf(issue);
              const ca = pass4.criticalityAssessments?.find(c => c.issueIndex === origIdx);
              return (
                <div key={i} className="border-l-2 border-[#E5E7EB] bg-[#FAFBFC] py-2 pl-3 pr-3 opacity-60">
                  <p className="text-xs text-[#8B8BA3]">
                    <span className="font-medium">[Suppressed]</span> {issue.issueType}: {issue.description?.substring(0, 150)}
                  </p>
                  {ca?.suppressionReason && (
                    <p className="mt-1 text-xs text-[#8B8BA3]">Reason: {ca.suppressionReason}</p>
                  )}
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}

function CounterAuthorityTab({
  issues,
  nodes,
  nodeSourceMap,
}: {
  issues: (StructuralIssue | InterpretiveIssue)[];
  nodes: NonNullable<Analysis['pass1_output']>['nodes'];
  nodeSourceMap: Map<string, string[]>;
}) {
  if (issues.length === 0) {
    return <p className="text-[#8B8BA3]">No counter-authorities identified.</p>;
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const sevOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const sorted = [...issues].sort((a, b) => (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3));

  return (
    <div className="space-y-4">
      <p className="text-xs text-[#8B8BA3]">
        Identified through automated case law search. Verify independently before reliance.
      </p>
      {sorted.map((issue, i) => (
        <div
          key={i}
          className={`border-l-4 bg-[#FAFBFC] py-3 pl-4 pr-4 ${SEVERITY_STYLES[issue.severity] || SEVERITY_STYLES.low}`}
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-[#8B8BA3]">
              {issue.severity}
            </span>
            <span className="text-xs text-[#8B8BA3]">{ISSUE_TYPE_LABELS[issue.issueType] || issue.issueType}</span>
            <CopyButton text={formatFindingForCopy(`Counter-Authority \u2014 ${ISSUE_TYPE_LABELS[issue.issueType] || issue.issueType}`, issue.description, issue.suggestedFix ? `${issue.suggestedFix}\n(Identified via automated search \u2014 verify independently)` : undefined)} />
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-[#4A4A68]">{issue.description}</p>
          {issue.suggestedFix && (
            <p className="mt-2 rounded bg-[#F1F3F5] px-3 py-2 text-sm text-[#4A4A68]">
              <span className="font-medium text-[#1A1A2E]">Fix: </span>
              {issue.suggestedFix}
            </p>
          )}
          {issue.nodeIds.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {issue.nodeIds.map((id) => {
                const node = nodeMap.get(id);
                return (
                  <span key={id} className="inline-flex items-center gap-1">
                    <span className="rounded bg-[#F1F3F5] px-1.5 py-0.5 text-xs text-[#4A4A68]" title={node?.text}>
                      {id}
                    </span>
                    <SourceRefBadges nodeId={id} nodeSourceMap={nodeSourceMap} />
                  </span>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ClaimsTab({
  nodes,
  verifications,
  nodeSourceMap,
}: {
  nodes: NonNullable<Analysis['pass1_output']>['nodes'];
  verifications: NonNullable<Analysis['pass3_output']>['verifications'];
  nodeSourceMap: Map<string, string[]>;
}) {
  const vMap = new Map(verifications.map((v) => [v.nodeId, v]));

  return (
    <div className="space-y-2">
      {nodes.map((n) => {
        const v = vMap.get(n.id);
        return (
          <div key={n.id} className="border-b border-[#E5E7EB] bg-white px-3 py-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#8B8BA3]">{n.id}</span>
              <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${TYPE_STYLES[n.type] || ''}`}>
                {TYPE_LABELS[n.type] || n.type}
              </span>
              {n.citationStatus !== 'None' && (
                <span className="text-xs text-[#8B8BA3]">
                  {n.citationStatus}: {n.citationSource || '?'}
                </span>
              )}
              <SourceRefBadges nodeId={n.id} nodeSourceMap={nodeSourceMap} />
              {v && (
                <span className={`ml-auto text-xs font-medium ${VERIFICATION_STYLES[v.status] || ''}`}>
                  {v.status}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-[#4A4A68]">{n.text}</p>
          </div>
        );
      })}
    </div>
  );
}

function StructureTab({ metrics, analysis }: { metrics: Analysis['metrics_output']; analysis: Analysis }) {
  if (!metrics) {
    return <p className="text-[#8B8BA3]">Metrics not yet computed.</p>;
  }

  const stats = [
    { label: 'Total claims', value: metrics.totalNodes },
    { label: 'Total connections', value: metrics.totalEdges },
    { label: 'Reasoning edges', value: `${metrics.reasoningPercent}%` },
    { label: 'Elaboration edges', value: `${metrics.elaborationPercent}%` },
    { label: 'Max chain depth', value: metrics.maxChainDepth },
    { label: 'Convergence points', value: metrics.convergencePoints.length },
    { label: 'Orphan claims', value: metrics.orphanNodes.length },
    { label: 'Prescription reachability', value: `${metrics.prescriptionReachabilityPercent ?? 0}%` },
  ];

  return (
    <div className="space-y-8">
      {/* Reasoning Structure DAG */}
      {analysis.pass1_output && analysis.pass2_output && (
        <div>
          <h3 className="mb-4 text-sm font-medium text-[#8B8BA3]">Reasoning Structure</h3>
          <ReasoningChainView analysis={analysis} />
        </div>
      )}

      {/* Metrics grid */}
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-[#E5E7EB] bg-[#F8F9FA] p-4">
            <p className="text-2xl font-bold text-[#1A1A2E]">{s.value}</p>
            <p className="mt-1 text-xs text-[#8B8BA3]">{s.label}</p>
          </div>
        ))}
      </div>

      {metrics.orphanNodes.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-medium text-[#8B8BA3]">Orphan Claims</h3>
          <p className="mt-1 text-sm text-[#8B8BA3]">
            These claims are disconnected from the argument structure:{' '}
            {metrics.orphanNodes.join(', ')}
          </p>
        </div>
      )}

      {metrics.convergencePoints.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-[#8B8BA3]">Convergence Points</h3>
          <p className="mt-1 text-sm text-[#8B8BA3]">
            Claims supported by multiple independent lines of reasoning:{' '}
            {metrics.convergencePoints.join(', ')}
          </p>
        </div>
      )}
    </div>
  );
}

function VerificationTab({ pass3, nodeSourceMap }: { pass3: Analysis['pass3_output']; nodeSourceMap: Map<string, string[]> }) {
  if (!pass3) {
    return <p className="text-[#8B8BA3]">Verification not yet complete.</p>;
  }

  const { verifications, chainAssessments, assessment } = pass3;

  return (
    <div className="space-y-8">
      {/* Overall assessment */}
      <div>
        <h3 className="text-sm font-medium text-[#8B8BA3]">Overall Assessment</h3>
        <div className="mt-2 grid gap-3 sm:grid-cols-4">
          <Stat label="Verified" value={assessment.totalVerified} color="text-green-400" />
          <Stat label="Partial" value={assessment.totalPartial} color="text-yellow-400" />
          <Stat label="Failed" value={assessment.totalFailed} color="text-red-400" />
          <Stat label="Source doc" value={verifications.filter(v => v.status === 'SOURCE_DOCUMENT').length} color="text-cyan-400" />
          <Stat label="Ungrounded" value={assessment.totalUngrounded} color="text-orange-400" />
        </div>
      </div>

      {/* Corrections needed */}
      {assessment.correctionsNeeded.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-[#8B8BA3]">Corrections Needed</h3>
          <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-[#4A4A68]">
            {assessment.correctionsNeeded.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ol>
        </div>
      )}

      {/* Reasoning chains */}
      {chainAssessments.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-[#8B8BA3]">Reasoning Chains</h3>
          <div className="mt-2 space-y-3">
            {chainAssessments.map((chain, i) => (
              <div key={i} className="border-b border-[#E5E7EB] bg-white px-3 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-[#8B8BA3]">
                    {chain.terminalNodeId}
                  </span>
                  <span className="text-xs text-[#8B8BA3]">
                    Depth {chain.chainDepth} &middot; {chain.groundingQuality}% grounded
                  </span>
                </div>
                <p className="mt-1 text-sm text-[#8B8BA3]">
                  Weakest link: {chain.weakestLink.fromId} &rarr; {chain.weakestLink.toId} &mdash; {chain.weakestLink.reason}
                </p>
                {chain.counterArguments.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs text-[#8B8BA3]">Counter-arguments:</p>
                    <ul className="list-inside list-disc text-xs text-[#8B8BA3]">
                      {chain.counterArguments.map((ca, j) => (
                        <li key={j}>{ca}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-citation verifications */}
      <div>
        <h3 className="text-sm font-medium text-[#8B8BA3]">
          Citation Verifications ({verifications.length})
        </h3>
        <div className="mt-2 space-y-2">
          {verifications.map((v, i) => (
            <div key={i} className="flex items-start gap-3 rounded border border-[#E5E7EB] bg-[#F8F9FA] p-3">
              <span className="text-xs text-[#8B8BA3]">{v.nodeId}</span>
              <SourceRefBadges nodeId={v.nodeId} nodeSourceMap={nodeSourceMap} />
              <span className={`text-xs font-medium ${VERIFICATION_STYLES[v.status] || ''}`}>
                {v.status}
              </span>
              {v.failureMode && (
                <span className="text-xs text-[#8B8BA3]">{v.failureMode}</span>
              )}
              <p className="flex-1 text-xs text-[#8B8BA3]">{v.notes}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SourcesTab({ sources }: { sources: SourceReference[] }) {
  if (sources.length === 0) {
    return <p className="text-[#8B8BA3]">No external sources were looked up for this analysis.</p>;
  }

  const found = sources.filter(s => s.found);
  const notFound = sources.filter(s => !s.found);

  return (
    <div className="space-y-6">
      <p className="text-sm text-[#8B8BA3]">
        {found.length} of {sources.length} cited sources were retrieved from authoritative databases.
      </p>

      {found.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-[#8B8BA3]">Retrieved Sources</h3>
          <div className="mt-2 space-y-3">
            {found.map((src) => (
              <div key={src.refId} className="rounded-lg border border-[#E5E7EB] bg-[#F8F9FA] p-4">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-blue-900/40 px-2 py-0.5 text-xs font-mono font-semibold text-blue-300">
                    [{src.refId}]
                  </span>
                  <span className="text-xs text-green-400">RETRIEVED</span>
                  <span className="rounded bg-[#F1F3F5] px-1.5 py-0.5 text-xs text-[#8B8BA3]">
                    {src.citationType}
                  </span>
                </div>
                <p className="mt-2 text-sm text-[#1A1A2E]">{src.citationRaw}</p>
                {src.nodeIds.length > 0 && (
                  <p className="mt-1 text-xs text-[#8B8BA3]">
                    Cited by: {src.nodeIds.join(', ')}
                  </p>
                )}
                {src.url && (
                  <a
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 block text-xs text-blue-400 hover:underline"
                  >
                    {src.url}
                  </a>
                )}
                {src.textPreview && (
                  <p className="mt-2 text-xs leading-relaxed text-[#8B8BA3]">
                    {src.textPreview}
                    {src.textPreview.length >= 500 ? '...' : ''}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {notFound.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-[#8B8BA3]">Not Found</h3>
          <div className="mt-2 space-y-2">
            {notFound.map((src) => (
              <div key={src.refId} className="rounded-lg border border-[#E5E7EB] bg-[#F8F9FA]/50 p-3">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-[#F1F3F5] px-2 py-0.5 text-xs text-[#8B8BA3]">
                    [{src.refId}]
                  </span>
                  <span className="text-xs text-orange-400">NOT FOUND</span>
                </div>
                <p className="mt-1 text-sm text-[#8B8BA3]">{src.citationRaw}</p>
                {src.nodeIds.length > 0 && (
                  <p className="mt-1 text-xs text-[#8B8BA3]">
                    Cited by: {src.nodeIds.join(', ')}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DialecticalTab({ analysis }: { analysis: Analysis }) {
  const p7 = analysis.pass7_output;
  const p8 = analysis.pass8_output;
  const p9 = analysis.pass9_output;
  if (!p9) return null;

  const fascCount = p8?.perturbations?.filter(p => p.isFascinationThreshold).length || 0;
  const criticalNodes = p9.scores?.filter(s => s.criticality > 0.7) || [];
  const contestedNodes = p9.scores?.filter(s => s.statusInC === 'contested') || [];
  const rejectedNodes = p9.scores?.filter(s => s.statusInC === 'rejected') || [];

  return (
    <div className="space-y-6">
      {/* Synthesis summary */}
      {p9.summary && (
        <p className="text-sm leading-relaxed text-[#4A4A68]" style={{ fontFamily: 'var(--font-serif)' }}>
          {p9.summary}
        </p>
      )}

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded border border-[#E5E7EB] bg-[#FAFBFC] p-3 text-center">
          <p className="text-xl font-semibold text-[#2D7D46]">{p7?.acceptedFromA?.length || 0}</p>
          <p className="text-xs text-[#8B8BA3]">Accepted</p>
        </div>
        <div className="rounded border border-[#E5E7EB] bg-[#FAFBFC] p-3 text-center">
          <p className="text-xl font-semibold text-[#A63D40]">{rejectedNodes.length}</p>
          <p className="text-xs text-[#8B8BA3]">Rejected</p>
        </div>
        <div className="rounded border border-[#E5E7EB] bg-[#FAFBFC] p-3 text-center">
          <p className="text-xl font-semibold text-[#B8860B]">{contestedNodes.length}</p>
          <p className="text-xs text-[#8B8BA3]">Contested</p>
        </div>
        <div className="rounded border border-[#E5E7EB] bg-[#FAFBFC] p-3 text-center">
          <p className="text-xl font-semibold text-[#5B7BA3]">{fascCount}</p>
          <p className="text-xs text-[#8B8BA3]">Fascination thresholds</p>
        </div>
      </div>

      {/* Load-bearing nodes */}
      {p7?.loadBearingNodes && p7.loadBearingNodes.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-[#8B8BA3]">Load-Bearing Nodes</h3>
          <div className="mt-2 space-y-3">
            {p7.loadBearingNodes.map((n, i) => {
              const score = p9.scores?.find(s => s.nodeId === n.nodeId);
              const isFascination = p8?.perturbations?.some(p => p.proposition === n.nodeId && p.isFascinationThreshold);
              return (
                <div key={i} className="border-l-4 border-l-[#1B2A4A] bg-[#FAFBFC] py-3 pl-4 pr-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#8B8BA3]" style={{ fontFamily: 'var(--font-mono)' }}>{n.nodeId}</span>
                    {score && (
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                        score.statusInC === 'rejected' ? 'bg-[#A63D40]/10 text-[#A63D40]' :
                        score.statusInC === 'contested' ? 'bg-[#B8860B]/10 text-[#B8860B]' :
                        'bg-[#2D7D46]/10 text-[#2D7D46]'
                      }`}>
                        {score.statusInC}
                      </span>
                    )}
                    {isFascination && (
                      <span className="rounded bg-[#E8ECF4] px-1.5 py-0.5 text-xs text-[#1B2A4A]">fascination threshold</span>
                    )}
                    {score && (
                      <span className="ml-auto text-xs text-[#8B8BA3]">criticality: {(score.criticality * 100).toFixed(0)}%</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-[#4A4A68]">{n.reason}</p>
                  <p className="mt-1 text-xs text-[#8B8BA3]">Resolution: {n.resolution}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* High-criticality nodes */}
      {criticalNodes.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-[#8B8BA3]">Highest Criticality</h3>
          <div className="mt-2 space-y-2">
            {criticalNodes.sort((a, b) => b.criticality - a.criticality).slice(0, 10).map((s, i) => (
              <div key={i} className="flex items-start gap-3 border-b border-[#F1F3F5] py-2">
                <span className="text-xs text-[#8B8BA3]" style={{ fontFamily: 'var(--font-mono)' }}>{s.nodeId}</span>
                <div className="h-2 w-16 self-center overflow-hidden rounded-full bg-[#F1F3F5]">
                  <div className="h-full rounded-full bg-[#A63D40]" style={{ width: `${s.criticality * 100}%` }} />
                </div>
                <span className="text-xs text-[#8B8BA3]">{(s.criticality * 100).toFixed(0)}%</span>
                <p className="flex-1 text-xs text-[#4A4A68]">{s.interpretation}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Perturbation results */}
      {p8?.perturbations && p8.perturbations.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-[#8B8BA3]">Robustness Testing</h3>
          <div className="mt-2 space-y-2">
            {p8.perturbations.map((p, i) => (
              <div key={i} className="border-b border-[#F1F3F5] py-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#8B8BA3]" style={{ fontFamily: 'var(--font-mono)' }}>{p.proposition}</span>
                  <span className={`text-xs ${
                    p.coherenceImpact === 'fundamental' ? 'text-[#A63D40]' :
                    p.coherenceImpact === 'moderate' ? 'text-[#B8860B]' : 'text-[#8B8BA3]'
                  }`}>
                    {p.coherenceImpact} impact
                  </span>
                  {p.isFascinationThreshold && (
                    <span className="rounded bg-[#E8ECF4] px-1.5 py-0.5 text-xs text-[#1B2A4A]">fascination</span>
                  )}
                </div>
                <p className="mt-1 text-xs text-[#4A4A68]">{p.alternativeSynthesis.substring(0, 200)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="border-b border-[#E5E7EB] bg-white px-3 py-3 text-center">
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-[#8B8BA3]">{label}</p>
    </div>
  );
}
