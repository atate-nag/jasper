// Deterministic DAG metric computation — no LLM involved.

import type { ClaimNode, Edge, DAGMetrics } from './types';

export function computeDAGMetrics(nodes: ClaimNode[], edges: Edge[]): DAGMetrics {
  // Count node types
  const nodesByType = { F: 0, M: 0, V: 0, P: 0 };
  for (const n of nodes) {
    if (n.type in nodesByType) nodesByType[n.type]++;
  }

  // Count edge types (reasoning = S+W+J, elaboration = E)
  const edgesByType = { S: 0, W: 0, J: 0, E: 0 };
  for (const e of edges) {
    if (e.type in edgesByType) edgesByType[e.type]++;
  }

  const totalEdges = edges.length;
  const reasoningEdges = edgesByType.S + edgesByType.W + edgesByType.J;
  const reasoningPercent = totalEdges > 0 ? Math.round((reasoningEdges / totalEdges) * 100) : 0;
  const elaborationPercent = totalEdges > 0 ? Math.round((edgesByType.E / totalEdges) * 100) : 0;

  // Build adjacency lists for reasoning edges only (S, W, J)
  const nodeIds = new Set(nodes.map(n => n.id));
  const outEdges = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const id of nodeIds) {
    outEdges.set(id, []);
    inDegree.set(id, 0);
  }

  for (const e of edges) {
    if (e.type === 'E') continue; // Skip elaboration for structural analysis
    if (!nodeIds.has(e.fromId) || !nodeIds.has(e.toId)) continue;
    outEdges.get(e.fromId)!.push(e.toId);
    inDegree.set(e.toId, (inDegree.get(e.toId) || 0) + 1);
  }

  // Max chain depth via BFS from each root (in-degree 0)
  let maxChainDepth = 0;
  const depth = new Map<string, number>();

  // Topological order via Kahn's algorithm (handles cycles gracefully)
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) {
      queue.push(id);
      depth.set(id, 0);
    }
  }

  let processed = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    processed++;
    const currentDepth = depth.get(current) || 0;

    for (const next of outEdges.get(current) || []) {
      const newDepth = currentDepth + 1;
      if (newDepth > (depth.get(next) || 0)) {
        depth.set(next, newDepth);
      }
      if (newDepth > maxChainDepth) {
        maxChainDepth = newDepth;
      }

      inDegree.set(next, (inDegree.get(next) || 0) - 1);
      if (inDegree.get(next) === 0) {
        queue.push(next);
      }
    }
  }

  // If we couldn't process all nodes, there are cycles — depth is approximate
  if (processed < nodeIds.size) {
    console.warn(`[metrics] Graph has cycles — ${nodeIds.size - processed} nodes in cycles`);
  }

  // Convergence points: nodes with 2+ incoming reasoning edges
  const convergenceInDegree = new Map<string, number>();
  for (const e of edges) {
    if (e.type === 'E') continue;
    if (!nodeIds.has(e.toId)) continue;
    convergenceInDegree.set(e.toId, (convergenceInDegree.get(e.toId) || 0) + 1);
  }
  const convergencePoints = [...convergenceInDegree.entries()]
    .filter(([, deg]) => deg >= 2)
    .map(([id]) => id);

  // Orphan nodes: P or V nodes with no incoming reasoning edges
  const hasIncomingReasoning = new Set<string>();
  for (const e of edges) {
    if (e.type === 'E') continue;
    hasIncomingReasoning.add(e.toId);
  }
  const hasOutgoingReasoning = new Set<string>();
  for (const e of edges) {
    if (e.type === 'E') continue;
    hasOutgoingReasoning.add(e.fromId);
  }
  const orphanNodes = nodes
    .filter(n => !hasIncomingReasoning.has(n.id) && !hasOutgoingReasoning.has(n.id))
    .map(n => n.id);

  // Prescription Reachability: % of P nodes reachable from at least one F node
  // via S/W/J chains. A well-structured document should approach 100%.
  const pNodes = nodes.filter(n => n.type === 'P');
  let prescriptionReachableCount = 0;
  if (pNodes.length > 0) {
    // Build forward adjacency from reasoning edges
    const fwd = new Map<string, string[]>();
    for (const e of edges) {
      if (e.type === 'E') continue;
      if (!nodeIds.has(e.fromId) || !nodeIds.has(e.toId)) continue;
      const outs = fwd.get(e.fromId) || [];
      outs.push(e.toId);
      fwd.set(e.fromId, outs);
    }
    // BFS from all F nodes
    const fRoots = nodes.filter(n => n.type === 'F').map(n => n.id);
    const reachable = new Set<string>();
    const queue = [...fRoots];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (reachable.has(cur)) continue;
      reachable.add(cur);
      for (const next of fwd.get(cur) || []) {
        if (!reachable.has(next)) queue.push(next);
      }
    }
    prescriptionReachableCount = pNodes.filter(p => reachable.has(p.id)).length;
  }
  const prescriptionReachabilityPercent = pNodes.length > 0
    ? Math.round((prescriptionReachableCount / pNodes.length) * 100)
    : 100; // no prescriptions → vacuously 100%

  return {
    totalNodes: nodes.length,
    nodesByType,
    totalEdges,
    edgesByType,
    reasoningPercent,
    elaborationPercent,
    maxChainDepth,
    convergencePoints,
    orphanNodes,
    prescriptionReachabilityPercent,
  };
}
