// Compute hierarchical DAG layout using dagre.

import dagre from '@dagrejs/dagre';
import type { ClaimNode, Edge, StructuralIssue } from '@/lib/reasonqa/types';
import type { ChainData, VisNode, VisEdge } from './chain-extract';

const NODE_WIDTH = 180;
const NODE_HEIGHT = 56;
const RANK_SEP = 60;
const NODE_SEP = 30;

export interface LayoutResult {
  nodes: VisNode[];
  edges: VisEdge[];
  width: number;
  height: number;
}

export function computeLayout(
  allNodes: ClaimNode[],
  allEdges: Edge[],
  chains: ChainData[],
  issues: StructuralIssue[],
  verifications: Array<{ nodeId: string; status: string }>,
): LayoutResult {
  // Collect node IDs that appear in any chain
  const chainNodeIds = new Set<string>();
  for (const chain of chains) {
    for (const id of chain.path) chainNodeIds.add(id);
  }

  if (chainNodeIds.size === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  // Collect edges between chain nodes (reasoning edges only)
  const chainEdges = allEdges.filter(
    e => e.type !== 'E' && chainNodeIds.has(e.fromId) && chainNodeIds.has(e.toId)
  );

  // Build weak link set
  const weakLinks = new Set<string>();
  for (const chain of chains) {
    if (chain.weakestLink) {
      weakLinks.add(`${chain.weakestLink.fromId}->${chain.weakestLink.toId}`);
    }
  }

  // Build issue map: nodeId → issues
  const issueMap = new Map<string, Array<{ severity: string; description: string }>>();
  for (const issue of issues) {
    for (const nid of issue.nodeIds) {
      const existing = issueMap.get(nid) || [];
      existing.push({ severity: issue.severity, description: issue.description });
      issueMap.set(nid, existing);
    }
  }

  // Build verification map
  const verMap = new Map(verifications.map(v => [v.nodeId, v.status]));

  // Create dagre graph
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: 'TB',
    ranksep: RANK_SEP,
    nodesep: NODE_SEP,
    marginx: 20,
    marginy: 20,
  });
  g.setDefaultEdgeLabel(() => ({}));

  const nodeMap = new Map(allNodes.map(n => [n.id, n]));

  for (const id of chainNodeIds) {
    g.setNode(id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  for (const e of chainEdges) {
    g.setEdge(e.fromId, e.toId);
  }

  dagre.layout(g);

  // Extract positioned nodes
  const visNodes: VisNode[] = [];
  for (const id of chainNodeIds) {
    const pos = g.node(id);
    const node = nodeMap.get(id);
    if (!pos || !node) continue;
    visNodes.push({
      id,
      text: node.text,
      type: node.type,
      verificationStatus: verMap.get(id),
      issues: issueMap.get(id) || [],
      x: pos.x,
      y: pos.y,
    });
  }

  // Extract positioned edges
  const visEdges: VisEdge[] = chainEdges.map(e => {
    const edgeData = g.edge(e.fromId, e.toId);
    const points = edgeData?.points || [
      { x: g.node(e.fromId)?.x || 0, y: (g.node(e.fromId)?.y || 0) + NODE_HEIGHT / 2 },
      { x: g.node(e.toId)?.x || 0, y: (g.node(e.toId)?.y || 0) - NODE_HEIGHT / 2 },
    ];
    return {
      id: e.id,
      fromId: e.fromId,
      toId: e.toId,
      type: e.type,
      isWeakLink: weakLinks.has(`${e.fromId}->${e.toId}`),
      points,
    };
  });

  const graphLabel = g.graph();
  const width = (graphLabel?.width || 600) + 40;
  const height = (graphLabel?.height || 400) + 40;

  return { nodes: visNodes, edges: visEdges, width, height };
}
