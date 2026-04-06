// Extract critical reasoning chains from pipeline output for DAG visualisation.
// Walks backward from conclusion nodes through reasoning edges (S/W/J, not E).

import type { ClaimNode, Edge, Pass3Output } from '@/lib/reasonqa/types';

export interface ChainData {
  conclusionId: string;
  path: string[];      // ordered root → conclusion
  depth: number;
  weakestLink?: { fromId: string; toId: string; reason: string };
  groundingQuality?: number;
}

export interface VisNode {
  id: string;
  text: string;
  type: 'F' | 'M' | 'V' | 'P';
  verificationStatus?: string;
  issues: Array<{ severity: string; description: string }>;
  x: number;
  y: number;
}

export interface VisEdge {
  id: string;
  fromId: string;
  toId: string;
  type: 'S' | 'W' | 'J' | 'E';
  isWeakLink: boolean;
  points: Array<{ x: number; y: number }>;
}

const MIN_CHAIN_DEPTH = 3;
const MAX_CHAINS = 5;

export function extractCriticalChains(
  nodes: ClaimNode[],
  edges: Edge[],
  pass3?: Pass3Output | null,
): ChainData[] {
  const nodeSet = new Set(nodes.map(n => n.id));

  // Build reverse adjacency (reasoning edges only: S, W, J)
  const inEdges = new Map<string, string[]>();
  for (const e of edges) {
    if (e.type === 'E') continue;
    if (!nodeSet.has(e.fromId) || !nodeSet.has(e.toId)) continue;
    const ins = inEdges.get(e.toId) || [];
    ins.push(e.fromId);
    inEdges.set(e.toId, ins);
  }

  // Find conclusion nodes: have incoming reasoning edges but no outgoing reasoning edges
  const hasOutgoing = new Set<string>();
  for (const e of edges) {
    if (e.type === 'E') continue;
    if (nodeSet.has(e.fromId)) hasOutgoing.add(e.fromId);
  }
  const conclusions = nodes
    .filter(n => !hasOutgoing.has(n.id) && (inEdges.get(n.id)?.length || 0) > 0)
    .map(n => n.id);

  // Walk backward from each conclusion to find the longest path
  const chains: ChainData[] = [];
  for (const concId of conclusions) {
    const longestPath = findLongestPath(concId, inEdges, nodeSet);
    if (longestPath.length >= MIN_CHAIN_DEPTH) {
      // Find weakest link from pass3 chain assessments
      const p3Chain = pass3?.chainAssessments?.find(c => c.terminalNodeId === concId);
      chains.push({
        conclusionId: concId,
        path: longestPath,
        depth: longestPath.length,
        weakestLink: p3Chain?.weakestLink,
        groundingQuality: p3Chain?.groundingQuality,
      });
    }
  }

  // Sort by depth (deepest first), limit
  chains.sort((a, b) => b.depth - a.depth);
  return chains.slice(0, MAX_CHAINS);
}

function findLongestPath(
  nodeId: string,
  inEdges: Map<string, string[]>,
  nodeSet: Set<string>,
): string[] {
  // BFS/DFS to find longest path backward, with cycle protection
  const visited = new Set<string>();
  const memo = new Map<string, string[]>();

  function dfs(id: string): string[] {
    if (memo.has(id)) return memo.get(id)!;
    if (visited.has(id)) return [id]; // cycle
    visited.add(id);

    const parents = inEdges.get(id) || [];
    let longest: string[] = [];
    for (const parent of parents) {
      if (!nodeSet.has(parent)) continue;
      const parentPath = dfs(parent);
      if (parentPath.length > longest.length) {
        longest = parentPath;
      }
    }

    const result = [...longest, id];
    memo.set(id, result);
    visited.delete(id);
    return result;
  }

  return dfs(nodeId);
}
