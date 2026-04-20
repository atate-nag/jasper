'use client';

import { useState, useMemo, useCallback } from 'react';
import type { Analysis } from '@/lib/reasonqa/types';
import { extractCriticalChains, type ChainData, type VisNode, type VisEdge } from './chain-extract';
import { computeLayout } from './layout';

// Colours — muted light-theme palette
const TYPE_FILL: Record<string, string> = {
  F: '#F1F3F5',
  M: '#FDF6E3',
  V: '#E8ECF4',
  P: '#E8F5E9',
};
const TYPE_STROKE: Record<string, string> = {
  F: '#8B8BA3',
  M: '#B8860B',
  V: '#1B2A4A',
  P: '#2D7D46',
};
const VERIFICATION_STROKE: Record<string, { color: string; dash: string }> = {
  VERIFIED: { color: '#2D7D46', dash: '' },
  PARTIAL: { color: '#B8860B', dash: '4 2' },
  FAILED: { color: '#A63D40', dash: '' },
  UNGROUNDED: { color: '#8B8BA3', dash: '2 2' },
  UNTRACEABLE: { color: '#A63D40', dash: '6 2' },
  SOURCE_DOCUMENT: { color: '#5B7BA3', dash: '' },
};
const SEVERITY_COLOR: Record<string, string> = {
  high: '#A63D40',
  medium: '#B8860B',
  low: '#8B8BA3',
};

const NODE_W = 180;
const NODE_H = 56;

interface Props {
  analysis: Analysis;
}

export function ReasoningChainView({ analysis }: Props) {
  const { pass1_output: p1, pass2_output: p2, pass3_output: p3 } = analysis;
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [activeChains, setActiveChains] = useState<Set<string> | null>(null); // null = all

  const chains = useMemo(() => {
    if (!p1?.nodes || !p2?.edges) return [];
    return extractCriticalChains(p1.nodes, p2.edges, p3);
  }, [p1, p2, p3]);

  // Filter chains by active selection
  const visibleChains = useMemo(() => {
    if (!activeChains) return chains;
    return chains.filter(c => activeChains.has(c.conclusionId));
  }, [chains, activeChains]);

  const layout = useMemo(() => {
    if (!p1?.nodes || !p2?.edges || visibleChains.length === 0) {
      return { nodes: [], edges: [], width: 0, height: 0 };
    }
    return computeLayout(
      p1.nodes,
      p2.edges,
      visibleChains,
      p2.structuralIssues || [],
      p3?.verifications || [],
    );
  }, [p1, p2, p3, visibleChains]);

  // Highlighted chain (all nodes in chains passing through hovered node)
  const highlightedNodes = useMemo(() => {
    if (!hoveredNode) return new Set<string>();
    const set = new Set<string>();
    for (const chain of visibleChains) {
      if (chain.path.includes(hoveredNode)) {
        for (const id of chain.path) set.add(id);
      }
    }
    return set;
  }, [hoveredNode, visibleChains]);

  const selectedNodeData = useMemo(() => {
    if (!selectedNode || !p1?.nodes) return null;
    const node = p1.nodes.find(n => n.id === selectedNode);
    if (!node) return null;
    const verification = p3?.verifications?.find(v => v.nodeId === selectedNode);
    const inEdges = (p2?.edges || []).filter(e => e.toId === selectedNode && e.type !== 'E');
    const outEdges = (p2?.edges || []).filter(e => e.fromId === selectedNode && e.type !== 'E');
    const issues = (p2?.structuralIssues || []).filter(i => i.nodeIds.includes(selectedNode));
    return { node, verification, inEdges, outEdges, issues };
  }, [selectedNode, p1, p2, p3]);

  const toggleChain = useCallback((conclusionId: string) => {
    setActiveChains(prev => {
      const current = prev || new Set(chains.map(c => c.conclusionId));
      const next = new Set(current);
      if (next.has(conclusionId)) {
        next.delete(conclusionId);
        if (next.size === 0) return null; // show all if none selected
      } else {
        next.add(conclusionId);
      }
      return next;
    });
  }, [chains]);

  if (chains.length === 0) {
    return (
      <p className="text-sm text-[#8B8BA3]">
        No reasoning chains deep enough to visualise (minimum depth: 3).
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Chain selector */}
      {chains.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-[#8B8BA3] self-center">Chains:</span>
          {chains.map(chain => {
            const isActive = !activeChains || activeChains.has(chain.conclusionId);
            return (
              <button
                key={chain.conclusionId}
                onClick={() => toggleChain(chain.conclusionId)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-[#E8ECF4] text-[#1B2A4A] border border-[#1B2A4A]'
                    : 'bg-[#F8F9FA] text-[#8B8BA3] border border-[#E5E7EB]'
                }`}
              >
                {chain.conclusionId} (depth {chain.depth})
              </button>
            );
          })}
        </div>
      )}

      {/* SVG DAG */}
      <div className="overflow-x-auto rounded border border-[#E5E7EB] bg-[#FAFBFC] p-4">
        <svg
          width={Math.max(layout.width, 300)}
          height={Math.max(layout.height, 200)}
          className="mx-auto"
        >
          {/* Edges */}
          {layout.edges.map(edge => (
            <EdgePath
              key={edge.id}
              edge={edge}
              dimmed={hoveredNode !== null && !highlightedNodes.has(edge.fromId) && !highlightedNodes.has(edge.toId)}
            />
          ))}
          {/* Nodes */}
          {layout.nodes.map(node => (
            <NodeCard
              key={node.id}
              node={node}
              selected={selectedNode === node.id}
              dimmed={hoveredNode !== null && !highlightedNodes.has(node.id)}
              onClick={() => setSelectedNode(selectedNode === node.id ? null : node.id)}
              onMouseEnter={() => setHoveredNode(node.id)}
              onMouseLeave={() => setHoveredNode(null)}
            />
          ))}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-[#8B8BA3]">
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: TYPE_STROKE.F }} /> Factual</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: TYPE_STROKE.V }} /> Value</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: TYPE_STROKE.M }} /> Mechanism</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: TYPE_STROKE.P }} /> Prescriptive</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-4 rounded-sm border-t-2" style={{ borderColor: '#A63D40' }} /> Weak link</span>
      </div>
      <p className="text-xs text-[#8B8BA3]">
        Showing the main reasoning chains from evidence (top) to conclusions (bottom). Red edges indicate the weakest link in each chain. Click any node for details.
      </p>

      {/* Detail panel */}
      {selectedNodeData && (
        <NodeDetailPanel
          data={selectedNodeData}
          onClose={() => setSelectedNode(null)}
        />
      )}
    </div>
  );
}

// ── Node rendering ───────────────────────────────────────────

function NodeCard({
  node,
  selected,
  dimmed,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: {
  node: VisNode;
  selected: boolean;
  dimmed: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const x = node.x - NODE_W / 2;
  const y = node.y - NODE_H / 2;
  const fill = TYPE_FILL[node.type] || TYPE_FILL.F;
  const stroke = TYPE_STROKE[node.type] || TYPE_STROKE.F;
  const vStatus = node.verificationStatus ? VERIFICATION_STROKE[node.verificationStatus] : null;
  const borderColor = vStatus?.color || stroke;
  const borderDash = vStatus?.dash || '';
  const topIssue = node.issues[0];

  return (
    <g
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{ cursor: 'pointer', opacity: dimmed ? 0.25 : 1, transition: 'opacity 0.2s' }}
    >
      <rect
        x={x}
        y={y}
        width={NODE_W}
        height={NODE_H}
        rx={8}
        fill={fill}
        stroke={selected ? '#60A5FA' : borderColor}
        strokeWidth={selected ? 2.5 : 1.5}
        strokeDasharray={borderDash}
      />
      {/* ID label */}
      <text x={x + 8} y={y + 16} fill={stroke} fontSize={11} fontWeight="bold" fontFamily="monospace">
        {node.id}
      </text>
      {/* Truncated claim text */}
      <text x={x + 8} y={y + 32} fill="#4A4A68" fontSize={10} fontFamily="sans-serif">
        {node.text.length > 28 ? node.text.slice(0, 28) + '...' : node.text}
      </text>
      {/* Verification badge */}
      {node.verificationStatus && (
        <text x={x + NODE_W - 8} y={y + 16} fill={borderColor} fontSize={8} textAnchor="end" fontFamily="sans-serif">
          {node.verificationStatus}
        </text>
      )}
      {/* Issue badge */}
      {topIssue && (
        <circle
          cx={x + NODE_W - 8}
          cy={y + NODE_H - 10}
          r={5}
          fill={SEVERITY_COLOR[topIssue.severity] || SEVERITY_COLOR.low}
        />
      )}
    </g>
  );
}

// ── Edge rendering ───────────────────────────────────────────

function EdgePath({ edge, dimmed }: { edge: VisEdge; dimmed: boolean }) {
  const points = edge.points;
  if (points.length < 2) return null;

  // Build smooth path
  let d: string;
  if (points.length === 2) {
    d = `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  } else {
    d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${points[i].x} ${points[i].y}`;
    }
  }

  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const angle = Math.atan2(last.y - prev.y, last.x - prev.x);

  return (
    <g style={{ opacity: dimmed ? 0.15 : 1, transition: 'opacity 0.2s' }}>
      <path
        d={d}
        fill="none"
        stroke={edge.isWeakLink ? '#A63D40' : '#D1D5DB'}
        strokeWidth={edge.isWeakLink ? 2.5 : 1.2}
        strokeDasharray={edge.isWeakLink ? '' : ''}
      />
      {/* Arrowhead */}
      <polygon
        points={`0,-4 8,0 0,4`}
        fill={edge.isWeakLink ? '#A63D40' : '#D1D5DB'}
        transform={`translate(${last.x},${last.y}) rotate(${(angle * 180) / Math.PI})`}
      />
    </g>
  );
}

// ── Detail panel ─────────────────────────────────────────────

function NodeDetailPanel({
  data,
  onClose,
}: {
  data: {
    node: { id: string; text: string; type: string; citationStatus: string; citationSource?: string; qualifier: string };
    verification?: { status: string; notes: string; failureMode?: string } | null;
    inEdges: Array<{ fromId: string; type: string }>;
    outEdges: Array<{ toId: string; type: string }>;
    issues: Array<{ description: string; severity: string; suggestedFix?: string }>;
  };
  onClose: () => void;
}) {
  const { node, verification, inEdges, outEdges, issues } = data;
  const typeLabel: Record<string, string> = { F: 'Factual', M: 'Mechanism', V: 'Value', P: 'Prescriptive' };

  return (
    <div className="rounded border border-[#E5E7EB] bg-[#F8F9FA] p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-bold text-[#1A1A2E]">{node.id}</span>
          <span className="rounded bg-[#F1F3F5] px-1.5 py-0.5 text-xs text-[#8B8BA3]">
            {typeLabel[node.type] || node.type}
          </span>
          <span className="text-xs text-[#8B8BA3]">{node.qualifier}</span>
        </div>
        <button onClick={onClose} className="text-xs text-[#8B8BA3] hover:text-[#1A1A2E]">Close</button>
      </div>
      <p className="mt-2 text-sm text-[#1A1A2E]">{node.text}</p>

      {node.citationStatus !== 'None' && (
        <p className="mt-2 text-xs text-[#8B8BA3]">
          Citation: {node.citationStatus} — {node.citationSource || 'unknown'}
        </p>
      )}

      {verification && (
        <div className="mt-3 rounded bg-[#F1F3F5] p-2">
          <p className="text-xs font-medium text-[#8B8BA3]">
            Verification: <span style={{ color: VERIFICATION_STROKE[verification.status]?.color || '#6B7280' }}>{verification.status}</span>
            {verification.failureMode && <span className="text-[#8B8BA3]"> ({verification.failureMode})</span>}
          </p>
          <p className="mt-1 text-xs text-[#8B8BA3]">{verification.notes}</p>
        </div>
      )}

      {issues.length > 0 && (
        <div className="mt-3 space-y-1">
          {issues.map((issue, i) => (
            <div key={i} className="text-xs">
              <span className="font-medium" style={{ color: SEVERITY_COLOR[issue.severity] || '#6B7280' }}>
                {issue.severity.toUpperCase()}
              </span>
              <span className="text-[#8B8BA3]"> — {issue.description}</span>
              {issue.suggestedFix && <p className="text-[#8B8BA3] mt-0.5">Fix: {issue.suggestedFix}</p>}
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex gap-4 text-xs text-[#8B8BA3]">
        {inEdges.length > 0 && (
          <span>Supported by: {inEdges.map(e => e.fromId).join(', ')}</span>
        )}
        {outEdges.length > 0 && (
          <span>Supports: {outEdges.map(e => e.toId).join(', ')}</span>
        )}
      </div>
    </div>
  );
}
