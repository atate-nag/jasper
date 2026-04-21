// Incremental re-analysis: change mapping, selective pipeline passes, issue delta.

import type {
  ClaimNode, Edge, Pass1Output, Pass2Output, Pass3Output,
  CitationVerification, StructuralIssue, InterpretiveIssue,
  OverallAssessment, IncrementalMeta, IssueDelta,
} from './types';
import type { DiffResult } from './diff';
import { computeTextSimilarity } from './diff';

// ── Paragraph → Node Mapping ────────────────────────────────────

/** Parse "7-9, 14" → [7, 8, 9, 14] */
export function parseSourceParagraphs(s: string | undefined): number[] {
  if (!s) return [];
  const result: number[] = [];
  for (const part of s.split(',')) {
    const trimmed = part.trim();
    const range = trimmed.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (range) {
      const start = parseInt(range[1], 10);
      const end = parseInt(range[2], 10);
      for (let i = start; i <= end; i++) result.push(i);
    } else {
      const n = parseInt(trimmed, 10);
      if (!isNaN(n)) result.push(n);
    }
  }
  return result;
}

export interface AffectedNodesResult {
  affectedNodeIds: string[];
  unchangedNodeIds: string[];
  removedNodeIds: string[];
}

/** Identify which nodes are affected by the paragraph diff. */
export function mapChangesToNodes(
  nodes: ClaimNode[],
  edges: Edge[],
  diff: DiffResult,
): AffectedNodesResult {
  const modifiedParas = new Set(diff.modified.map(m => m[0]));
  const removedParas = new Set(diff.removed);
  const changedParas = new Set([...modifiedParas, ...removedParas]);

  const directlyAffected = new Set<string>();
  const removed = new Set<string>();
  const unchanged = new Set<string>();

  for (const node of nodes) {
    const paras = parseSourceParagraphs(node.sourceParagraphs);
    if (paras.length === 0) {
      // No paragraph info — conservatively treat as affected
      directlyAffected.add(node.id);
      continue;
    }
    const allRemoved = paras.every(p => removedParas.has(p));
    if (allRemoved) {
      removed.add(node.id);
    } else if (paras.some(p => changedParas.has(p))) {
      directlyAffected.add(node.id);
    } else {
      unchanged.add(node.id);
    }
  }

  // Also flag downstream nodes (nodes supported by affected nodes)
  const downstream = findDownstreamNodes(directlyAffected, edges);
  for (const id of downstream) {
    if (unchanged.has(id)) {
      unchanged.delete(id);
      directlyAffected.add(id);
    }
  }

  return {
    affectedNodeIds: [...directlyAffected],
    unchangedNodeIds: [...unchanged],
    removedNodeIds: [...removed],
  };
}

function findDownstreamNodes(affectedIds: Set<string>, edges: Edge[]): Set<string> {
  const downstream = new Set<string>();
  const queue = [...affectedIds];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const edge of edges) {
      if (edge.fromId === id && !affectedIds.has(edge.toId) && !downstream.has(edge.toId)) {
        downstream.add(edge.toId);
        queue.push(edge.toId);
      }
    }
  }
  return downstream;
}

// ── Incremental Pass 1 Prompt ───────────────────────────────────

export function buildIncrementalPass1Prompt(
  revisedText: string,
  unchangedNodes: ClaimNode[],
  affectedParagraphIndices: number[],
): { systemPrompt: string; userMessage: string } {
  const unchangedSummary = unchangedNodes.map(n =>
    `${n.id}: "${n.text.substring(0, 120)}..." (type=${n.type}, paras=${n.sourceParagraphs || '?'})`
  ).join('\n');

  const systemPrompt = `You are a legal reasoning analyst performing an INCREMENTAL re-extraction.

The user has revised a previously analysed document. Some paragraphs have changed.
The following nodes from the previous analysis are UNCHANGED — do NOT re-extract them:

${unchangedSummary}

Your job: extract NEW or MODIFIED claims from the CHANGED SECTIONS ONLY.

For each new/modified claim, provide the same fields as a standard extraction:
id, text, type (F/M/V/P), citationStatus, citationSource, qualifier, edgeDrafts, sourceSection, codingNotes, sourceParagraphs, sourceWordCount.

For IDs:
- If a claim REPLACES an existing one, use the SAME ID (e.g. if P007 was modified, the replacement is still P007).
- If a claim is entirely NEW, use the next available ID after the highest existing one.

Return JSON: { "newNodes": [...], "modifiedNodeIds": ["P007", ...] }
"modifiedNodeIds" lists the IDs of old nodes that have been replaced by nodes in newNodes.`;

  const userMessage = `REVISED DOCUMENT:\n\n${revisedText}\n\nParagraphs that changed (1-based indices): ${affectedParagraphIndices.join(', ')}\n\nExtract claims from the changed sections only.`;

  return { systemPrompt, userMessage };
}

// ── Pass 1 Merge ────────────────────────────────────────────────

export function mergePass1(
  unchangedNodes: ClaimNode[],
  removedNodeIds: string[],
  incrementalNodes: ClaimNode[],
  modifiedNodeIds: string[],
): { mergedNodes: ClaimNode[]; nodeIdMapping: Record<string, string> } {
  const nodeIdMapping: Record<string, string> = {};
  const removedSet = new Set(removedNodeIds);
  const modifiedSet = new Set(modifiedNodeIds);

  // Start with unchanged nodes (minus removed ones)
  const merged = unchangedNodes.filter(n => !removedSet.has(n.id) && !modifiedSet.has(n.id));

  // Map old IDs to themselves for unchanged nodes
  for (const n of merged) nodeIdMapping[n.id] = n.id;

  // Add incremental nodes
  for (const n of incrementalNodes) {
    merged.push(n);
    // If this replaces an old node, it already has the same ID
    if (modifiedSet.has(n.id)) {
      nodeIdMapping[n.id] = n.id;
    }
  }

  // For removed nodes, map to empty (they no longer exist)
  for (const id of removedNodeIds) {
    nodeIdMapping[id] = '';
  }

  return { mergedNodes: merged, nodeIdMapping };
}

// ── Incremental Pass 2 Prompt ───────────────────────────────────

export function buildIncrementalPass2Prompt(
  revisedText: string,
  mergedNodes: ClaimNode[],
  existingEdges: Edge[],
  affectedNodeIds: string[],
): { systemPrompt: string; userMessage: string } {
  const affectedSet = new Set(affectedNodeIds);

  const keptEdges = existingEdges.filter(
    e => !affectedSet.has(e.fromId) && !affectedSet.has(e.toId)
  );

  const nodesJson = JSON.stringify(mergedNodes.map(n => ({
    id: n.id, text: n.text.substring(0, 200), type: n.type,
  })));

  const keptEdgesJson = JSON.stringify(keptEdges.map(e => ({
    id: e.id, from: e.fromId, to: e.toId, type: e.type,
  })));

  const systemPrompt = `You are a legal reasoning analyst performing INCREMENTAL edge construction.

The following edges between UNCHANGED nodes are preserved — do NOT recreate them:
${keptEdgesJson}

Build edges ONLY for connections involving these new/modified nodes: ${affectedNodeIds.join(', ')}

Edge types: S (Support), W (Warrant), J (Justification), E (Elaboration)
Explicitness: EX (explicit in text) or IM (implicit/inferred)

Return JSON: { "edges": [{ "id": "E_xxx", "fromId": "Pxxx", "toId": "Pxxx", "type": "S", "explicitness": "EX", "notes": "..." }], "structuralIssues": [...] }

For structuralIssues, only report issues involving the new/modified nodes.`;

  const userMessage = `DOCUMENT:\n${revisedText.substring(0, 5000)}...\n\nALL NODES:\n${nodesJson}\n\nBuild edges for the affected nodes.`;

  return { systemPrompt, userMessage };
}

// ── Pass 2 Merge ────────────────────────────────────────────────

export function mergePass2(
  existingEdges: Edge[],
  incrementalEdges: Edge[],
  affectedNodeIds: string[],
  removedNodeIds: string[],
): Edge[] {
  const affectedSet = new Set(affectedNodeIds);
  const removedSet = new Set(removedNodeIds);

  // Keep edges between unchanged nodes (and not involving removed nodes)
  const kept = existingEdges.filter(
    e => !affectedSet.has(e.fromId) && !affectedSet.has(e.toId)
      && !removedSet.has(e.fromId) && !removedSet.has(e.toId)
  );

  return [...kept, ...incrementalEdges];
}

// ── Incremental Pass 3 Prompt ───────────────────────────────────

export function buildIncrementalPass3Prompt(
  revisedText: string,
  mergedNodes: ClaimNode[],
  corpus: string,
  affectedNodeIds: string[],
  existingVerifications: CitationVerification[],
): { systemPrompt: string; userMessage: string } {
  const affectedSet = new Set(affectedNodeIds);
  const keptVerifications = existingVerifications.filter(v => !affectedSet.has(v.nodeId));

  const keptSummary = keptVerifications.map(v =>
    `${v.nodeId}: ${v.status}${v.notes ? ' — ' + v.notes.substring(0, 80) : ''}`
  ).join('\n');

  const nodesToVerify = mergedNodes.filter(n => affectedSet.has(n.id));
  const nodesJson = JSON.stringify(nodesToVerify.map(n => ({
    id: n.id, text: n.text, type: n.type,
    citationStatus: n.citationStatus, citationSource: n.citationSource,
  })));

  const systemPrompt = `You are a legal citation verification specialist performing INCREMENTAL verification.

The following verifications from the previous analysis are UNCHANGED — do not re-verify:
${keptSummary}

Verify ONLY the following new/modified nodes against the corpus provided.

Return JSON matching the standard Pass 3 schema but ONLY for the nodes listed below.`;

  const userMessage = `DOCUMENT:\n${revisedText.substring(0, 3000)}...\n\nCORPUS:\n${corpus.substring(0, 10000)}...\n\nNODES TO VERIFY:\n${nodesJson}`;

  return { systemPrompt, userMessage };
}

// ── Pass 3 Merge ────────────────────────────────────────────────

export function mergePass3(
  existingPass3: Pass3Output,
  incrementalVerifications: CitationVerification[],
  affectedNodeIds: string[],
  removedNodeIds: string[],
): Pass3Output {
  const affectedSet = new Set(affectedNodeIds);
  const removedSet = new Set(removedNodeIds);

  // Keep verifications for unchanged nodes
  const keptVerifications = existingPass3.verifications.filter(
    v => !affectedSet.has(v.nodeId) && !removedSet.has(v.nodeId)
  );

  const allVerifications = [...keptVerifications, ...incrementalVerifications];

  // Recompute assessment
  const totalVerified = allVerifications.filter(v => v.status === 'VERIFIED').length;
  const totalPartial = allVerifications.filter(v => v.status === 'PARTIAL').length;
  const totalFailed = allVerifications.filter(v => v.status === 'FAILED').length;
  const totalUngrounded = allVerifications.filter(v => v.status === 'UNGROUNDED').length;

  return {
    verifications: allVerifications,
    chainAssessments: existingPass3.chainAssessments, // Will be recomputed by Pass 4
    interpretiveIssues: existingPass3.interpretiveIssues, // Recomputed by corpus
    assessment: {
      ...existingPass3.assessment,
      totalVerified,
      totalPartial,
      totalFailed,
      totalUngrounded,
    },
  };
}

// ── Issue Delta Detection ───────────────────────────────────────

type AnyIssue = StructuralIssue | InterpretiveIssue;

function issueFingerprint(issue: AnyIssue): string {
  return `${issue.issueType}:${issue.nodeIds.sort().join(',')}`;
}

export function computeIssueDelta(
  parentIssues: AnyIssue[],
  currentIssues: AnyIssue[],
  nodeIdMapping: Record<string, string>,
): IssueDelta {
  // Remap parent issue node IDs through the mapping
  const remappedParent = parentIssues.map(issue => ({
    ...issue,
    mappedNodeIds: issue.nodeIds.map(id => nodeIdMapping[id] || id).filter(Boolean).sort(),
    fingerprint: `${issue.issueType}:${issue.nodeIds.map(id => nodeIdMapping[id] || id).filter(Boolean).sort().join(',')}`,
  }));

  const currentFingerprints = new Map(
    currentIssues.map(issue => [issueFingerprint(issue), issue])
  );

  const resolved: IssueDelta['resolved'] = [];
  const unchanged: IssueDelta['unchanged'] = [];
  const modified: IssueDelta['modified'] = [];
  const matchedCurrent = new Set<string>();

  for (const pi of remappedParent) {
    const match = currentFingerprints.get(pi.fingerprint);
    if (!match) {
      // Check for partial match (same type, overlapping nodes)
      let found = false;
      for (const [fp, ci] of currentFingerprints) {
        if (matchedCurrent.has(fp)) continue;
        if (ci.issueType === pi.issueType) {
          const overlap = ci.nodeIds.some(id => pi.mappedNodeIds.includes(id));
          if (overlap) {
            const descChanged = computeTextSimilarity(pi.description, ci.description) < 0.8;
            if (descChanged) {
              modified.push({
                issueType: ci.issueType,
                nodeIds: ci.nodeIds,
                change: `Severity or description changed`,
              });
            } else {
              unchanged.push({ issueType: ci.issueType, nodeIds: ci.nodeIds });
            }
            matchedCurrent.add(fp);
            found = true;
            break;
          }
        }
      }
      if (!found) {
        resolved.push({
          issueType: pi.issueType,
          description: pi.description,
          nodeIds: pi.nodeIds,
        });
      }
    } else {
      unchanged.push({ issueType: match.issueType, nodeIds: match.nodeIds });
      matchedCurrent.add(pi.fingerprint);
    }
  }

  // New issues = current issues not matched
  const newIssues: IssueDelta['new'] = [];
  for (const [fp, ci] of currentFingerprints) {
    if (!matchedCurrent.has(fp)) {
      newIssues.push({
        issueType: ci.issueType,
        description: ci.description,
        nodeIds: ci.nodeIds,
        severity: ci.severity,
      });
    }
  }

  return {
    resolved,
    new: newIssues,
    unchanged,
    modified,
    qualityChange: null, // Set by caller after Pass 4
  };
}
