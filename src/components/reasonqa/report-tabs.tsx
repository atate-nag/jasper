'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Analysis, SourceReference } from '@/lib/reasonqa/types';
import { QualityBadge } from './status-badge';
import { exportAnalysisPDF } from './export-pdf';
import { ReasoningChainView } from './dag/reasoning-chain-view';

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
      className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-300 hover:border-gray-600 hover:text-white disabled:opacity-50"
      title="Re-run corpus lookup and verification (keeps Pass 1 + Pass 2)"
    >
      {loading ? 'Re-verifying...' : 'Re-verify'}
    </button>
  );
}

function SourceRefBadges({ nodeId, nodeSourceMap }: { nodeId: string; nodeSourceMap: Map<string, string[]> }) {
  const refs = nodeSourceMap.get(nodeId);
  if (!refs || refs.length === 0) return null;
  return (
    <>
      {refs.map(r => (
        <span key={r} className="rounded bg-blue-900/40 px-1.5 py-0.5 text-xs font-mono text-blue-300">
          [{r}]
        </span>
      ))}
    </>
  );
}

type Tab = 'issues' | 'claims' | 'structure' | 'verification' | 'sources';

const SEVERITY_STYLES: Record<string, string> = {
  high: 'border-red-800 bg-red-950/30',
  medium: 'border-yellow-800 bg-yellow-950/30',
  low: 'border-gray-700 bg-gray-900',
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
  F: 'bg-blue-900/50 text-blue-300',
  M: 'bg-purple-900/50 text-purple-300',
  V: 'bg-amber-900/50 text-amber-300',
  P: 'bg-green-900/50 text-green-300',
};

const VERIFICATION_STYLES: Record<string, string> = {
  VERIFIED: 'text-green-400',
  PARTIAL: 'text-yellow-400',
  FAILED: 'text-red-400',
  UNGROUNDED: 'text-orange-400',
  UNTRACEABLE: 'text-gray-500',
};

export function ReportTabs({ analysis }: { analysis: Analysis }) {
  const [tab, setTab] = useState<Tab>('issues');
  const { pass1_output: p1, pass2_output: p2, metrics_output: m, pass3_output: p3, sources } = analysis;

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
  const tabs: { key: Tab; label: string }[] = [
    { key: 'issues', label: `Issues (${(p2?.structuralIssues?.length || 0) + (p3?.interpretiveIssues?.length || 0)})` },
    { key: 'claims', label: `Claims (${p1?.nodes?.length || 0})` },
    { key: 'structure', label: 'Structure' },
    { key: 'verification', label: 'Verification' },
    ...(hasSources ? [{ key: 'sources' as Tab, label: `Sources (${sources!.length})` }] : []),
  ];

  return (
    <div>
      {/* Summary header */}
      <div className="flex flex-wrap items-center gap-4 border-b border-gray-800 pb-6">
        <h1 className="text-xl font-bold text-white">
          {analysis.title || 'Untitled document'}
        </h1>
        <QualityBadge quality={p3?.assessment?.quality || null} />
        {m && (
          <span className="text-sm text-gray-500">
            {m.totalNodes} claims &middot; {m.totalEdges} connections
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <ReverifyButton analysisId={analysis.id} />
          <button
            onClick={() => exportAnalysisPDF(analysis)}
            className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-300 hover:border-gray-600 hover:text-white"
          >
            Export PDF
          </button>
        </div>
      </div>

      {/* Summary paragraph */}
      {p3?.assessment?.summary && (
        <p className="mt-4 text-sm leading-relaxed text-gray-300">
          {p3.assessment.summary}
        </p>
      )}

      {/* Tabs */}
      <div className="mt-6 flex gap-1 border-b border-gray-800">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? 'border-b-2 border-blue-500 text-white'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="mt-6">
        {tab === 'issues' && <IssuesTab issues={[...(p2?.structuralIssues || []), ...(p3?.interpretiveIssues || [])]} nodes={p1?.nodes || []} nodeSourceMap={nodeSourceMap} />}
        {tab === 'claims' && <ClaimsTab nodes={p1?.nodes || []} verifications={p3?.verifications || []} nodeSourceMap={nodeSourceMap} />}
        {tab === 'structure' && <StructureTab metrics={m} analysis={analysis} />}
        {tab === 'verification' && <VerificationTab pass3={p3} nodeSourceMap={nodeSourceMap} />}
        {tab === 'sources' && <SourcesTab sources={sources || []} />}
      </div>
    </div>
  );
}

function IssuesTab({
  issues,
  nodes,
  nodeSourceMap,
}: {
  issues: NonNullable<Analysis['pass2_output']>['structuralIssues'];
  nodes: NonNullable<Analysis['pass1_output']>['nodes'];
  nodeSourceMap: Map<string, string[]>;
}) {
  if (issues.length === 0) {
    return <p className="text-gray-500">No structural issues found.</p>;
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Sort by severity: high first
  const sorted = [...issues].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
  });

  return (
    <div className="space-y-4">
      {sorted.map((issue, i) => (
        <div
          key={i}
          className={`rounded-lg border p-4 ${SEVERITY_STYLES[issue.severity] || SEVERITY_STYLES.low}`}
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase text-gray-400">
              {issue.severity}
            </span>
            <span className="text-xs text-gray-600">{ISSUE_TYPE_LABELS[issue.issueType] || issue.issueType}</span>
            {INTERPRETIVE_ISSUE_TYPES.has(issue.issueType) && (
              <span className="rounded bg-purple-900/40 px-1.5 py-0.5 text-xs text-purple-300">interpretive</span>
            )}
          </div>
          <p className="mt-2 text-sm text-gray-200">{issue.description}</p>
          {issue.suggestedFix && (
            <p className="mt-2 text-sm text-gray-400">
              <span className="font-medium text-gray-300">Fix: </span>
              {issue.suggestedFix}
            </p>
          )}
          {issue.nodeIds.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {issue.nodeIds.map((id) => {
                const node = nodeMap.get(id);
                return (
                  <span key={id} className="inline-flex items-center gap-1">
                    <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400" title={node?.text}>
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
          <div key={n.id} className="rounded-lg border border-gray-800 bg-gray-900 p-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-gray-500">{n.id}</span>
              <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${TYPE_STYLES[n.type] || ''}`}>
                {TYPE_LABELS[n.type] || n.type}
              </span>
              {n.citationStatus !== 'None' && (
                <span className="text-xs text-gray-500">
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
            <p className="mt-1 text-sm text-gray-300">{n.text}</p>
          </div>
        );
      })}
    </div>
  );
}

function StructureTab({ metrics, analysis }: { metrics: Analysis['metrics_output']; analysis: Analysis }) {
  if (!metrics) {
    return <p className="text-gray-500">Metrics not yet computed.</p>;
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
          <h3 className="mb-4 text-sm font-medium text-gray-400">Reasoning Structure</h3>
          <ReasoningChainView analysis={analysis} />
        </div>
      )}

      {/* Metrics grid */}
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-gray-800 bg-gray-900 p-4">
            <p className="text-2xl font-bold text-white">{s.value}</p>
            <p className="mt-1 text-xs text-gray-500">{s.label}</p>
          </div>
        ))}
      </div>

      {metrics.orphanNodes.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-medium text-gray-400">Orphan Claims</h3>
          <p className="mt-1 text-sm text-gray-500">
            These claims are disconnected from the argument structure:{' '}
            {metrics.orphanNodes.join(', ')}
          </p>
        </div>
      )}

      {metrics.convergencePoints.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-gray-400">Convergence Points</h3>
          <p className="mt-1 text-sm text-gray-500">
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
    return <p className="text-gray-500">Verification not yet complete.</p>;
  }

  const { verifications, chainAssessments, assessment } = pass3;

  return (
    <div className="space-y-8">
      {/* Overall assessment */}
      <div>
        <h3 className="text-sm font-medium text-gray-400">Overall Assessment</h3>
        <div className="mt-2 grid gap-3 sm:grid-cols-4">
          <Stat label="Verified" value={assessment.totalVerified} color="text-green-400" />
          <Stat label="Partial" value={assessment.totalPartial} color="text-yellow-400" />
          <Stat label="Failed" value={assessment.totalFailed} color="text-red-400" />
          <Stat label="Ungrounded" value={assessment.totalUngrounded} color="text-orange-400" />
        </div>
      </div>

      {/* Corrections needed */}
      {assessment.correctionsNeeded.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-400">Corrections Needed</h3>
          <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-gray-300">
            {assessment.correctionsNeeded.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ol>
        </div>
      )}

      {/* Reasoning chains */}
      {chainAssessments.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-400">Reasoning Chains</h3>
          <div className="mt-2 space-y-3">
            {chainAssessments.map((chain, i) => (
              <div key={i} className="rounded-lg border border-gray-800 bg-gray-900 p-3">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-gray-500">
                    {chain.terminalNodeId}
                  </span>
                  <span className="text-xs text-gray-400">
                    Depth {chain.chainDepth} &middot; {chain.groundingQuality}% grounded
                  </span>
                </div>
                <p className="mt-1 text-sm text-gray-400">
                  Weakest link: {chain.weakestLink.fromId} &rarr; {chain.weakestLink.toId} &mdash; {chain.weakestLink.reason}
                </p>
                {chain.counterArguments.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs text-gray-500">Counter-arguments:</p>
                    <ul className="list-inside list-disc text-xs text-gray-500">
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
        <h3 className="text-sm font-medium text-gray-400">
          Citation Verifications ({verifications.length})
        </h3>
        <div className="mt-2 space-y-2">
          {verifications.map((v, i) => (
            <div key={i} className="flex items-start gap-3 rounded border border-gray-800 bg-gray-900 p-3">
              <span className="text-xs font-mono text-gray-500">{v.nodeId}</span>
              <SourceRefBadges nodeId={v.nodeId} nodeSourceMap={nodeSourceMap} />
              <span className={`text-xs font-medium ${VERIFICATION_STYLES[v.status] || ''}`}>
                {v.status}
              </span>
              {v.failureMode && (
                <span className="text-xs text-gray-600">{v.failureMode}</span>
              )}
              <p className="flex-1 text-xs text-gray-400">{v.notes}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SourcesTab({ sources }: { sources: SourceReference[] }) {
  if (sources.length === 0) {
    return <p className="text-gray-500">No external sources were looked up for this analysis.</p>;
  }

  const found = sources.filter(s => s.found);
  const notFound = sources.filter(s => !s.found);

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-400">
        {found.length} of {sources.length} cited sources were retrieved from authoritative databases.
      </p>

      {found.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-400">Retrieved Sources</h3>
          <div className="mt-2 space-y-3">
            {found.map((src) => (
              <div key={src.refId} className="rounded-lg border border-gray-800 bg-gray-900 p-4">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-blue-900/40 px-2 py-0.5 text-xs font-mono font-semibold text-blue-300">
                    [{src.refId}]
                  </span>
                  <span className="text-xs text-green-400">RETRIEVED</span>
                  <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-500">
                    {src.citationType}
                  </span>
                </div>
                <p className="mt-2 text-sm text-gray-200">{src.citationRaw}</p>
                {src.nodeIds.length > 0 && (
                  <p className="mt-1 text-xs text-gray-500">
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
                  <p className="mt-2 text-xs leading-relaxed text-gray-500">
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
          <h3 className="text-sm font-medium text-gray-400">Not Found</h3>
          <div className="mt-2 space-y-2">
            {notFound.map((src) => (
              <div key={src.refId} className="rounded-lg border border-gray-800 bg-gray-900/50 p-3">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-gray-800 px-2 py-0.5 text-xs font-mono text-gray-500">
                    [{src.refId}]
                  </span>
                  <span className="text-xs text-orange-400">NOT FOUND</span>
                </div>
                <p className="mt-1 text-sm text-gray-400">{src.citationRaw}</p>
                {src.nodeIds.length > 0 && (
                  <p className="mt-1 text-xs text-gray-600">
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

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-3 text-center">
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}
