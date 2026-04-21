// Paragraph-level document diffing for incremental re-analysis.
// Purely algorithmic — no LLM calls. No external dependencies.

import { createHash } from 'crypto';

// ── Types ───────────────────────────────────────────────────────

export interface Paragraph {
  index: number;      // 1-based
  text: string;
  hash: string;       // SHA-256 of normalized text
  wordCount: number;
}

export interface DiffResult {
  unchanged: Array<[oldIdx: number, newIdx: number]>;
  modified: Array<[oldIdx: number, newIdx: number, similarity: number]>;
  added: number[];      // new paragraph indices
  removed: number[];    // old paragraph indices
  changeRatio: number;  // 0-1, fraction of old paragraphs that changed
}

// ── Paragraph Splitting ─────────────────────────────────────────

const NUMBERED_PARA_RE = /^(?:\d+\.\s|(?:[a-z]\)\s)|(?:\([a-z0-9]+\)\s))/;

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function hashText(text: string): string {
  return createHash('sha256').update(normalizeText(text)).digest('hex');
}

export function splitIntoParagraphs(text: string): Paragraph[] {
  // Split on double-newlines or numbered paragraph boundaries
  const raw = text.split(/\n\s*\n/).flatMap(block => {
    const trimmed = block.trim();
    if (!trimmed) return [];
    // If block contains numbered paragraphs on separate lines, split further
    const lines = trimmed.split('\n');
    if (lines.length > 1 && lines.filter(l => NUMBERED_PARA_RE.test(l.trim())).length >= 2) {
      const paras: string[] = [];
      let current = '';
      for (const line of lines) {
        if (NUMBERED_PARA_RE.test(line.trim()) && current.trim()) {
          paras.push(current.trim());
          current = line;
        } else {
          current += '\n' + line;
        }
      }
      if (current.trim()) paras.push(current.trim());
      return paras;
    }
    return [trimmed];
  });

  return raw
    .filter(t => t.length > 0)
    .map((text, i) => ({
      index: i + 1,
      text,
      hash: hashText(text),
      wordCount: text.split(/\s+/).length,
    }));
}

// ── Similarity ──────────────────────────────────────────────────

function wordSet(text: string): Set<string> {
  return new Set(normalizeText(text).split(/\s+/).filter(w => w.length > 0));
}

/** Jaccard similarity on word sets. Returns 0-1. */
export function computeTextSimilarity(a: string, b: string): number {
  const setA = wordSet(a);
  const setB = wordSet(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection++;
  }
  return intersection / (setA.size + setB.size - intersection);
}

// ── Diff Algorithm ──────────────────────────────────────────────

/**
 * Diff two documents at paragraph level.
 *
 * 1. Hash-match identical paragraphs
 * 2. LCS on hash sequences for ordering
 * 3. Fuzzy-match remaining via Jaccard (threshold 0.7 = "modified")
 */
export function diffParagraphs(oldParas: Paragraph[], newParas: Paragraph[]): DiffResult {
  const unchanged: Array<[number, number]> = [];
  const modified: Array<[number, number, number]> = [];
  const added: number[] = [];
  const removed: number[] = [];

  // Step 1: find exact hash matches using LCS to preserve ordering
  const oldHashes = oldParas.map(p => p.hash);
  const newHashes = newParas.map(p => p.hash);
  const lcsMatches = lcsIndices(oldHashes, newHashes);

  const matchedOld = new Set(lcsMatches.map(m => m[0]));
  const matchedNew = new Set(lcsMatches.map(m => m[1]));

  for (const [oi, ni] of lcsMatches) {
    unchanged.push([oldParas[oi].index, newParas[ni].index]);
  }

  // Step 2: fuzzy-match unmatched paragraphs
  const unmatchedOld = oldParas.filter((_, i) => !matchedOld.has(i));
  const unmatchedNew = newParas.filter((_, i) => !matchedNew.has(i));

  const usedOld = new Set<number>();
  const usedNew = new Set<number>();

  // Build similarity matrix and greedily match best pairs
  const pairs: Array<{ oi: number; ni: number; sim: number }> = [];
  for (const op of unmatchedOld) {
    for (const np of unmatchedNew) {
      const sim = computeTextSimilarity(op.text, np.text);
      if (sim >= 0.3) pairs.push({ oi: op.index, ni: np.index, sim });
    }
  }
  pairs.sort((a, b) => b.sim - a.sim);

  for (const { oi, ni, sim } of pairs) {
    if (usedOld.has(oi) || usedNew.has(ni)) continue;
    usedOld.add(oi);
    usedNew.add(ni);
    if (sim >= 0.95) {
      // Near-identical — treat as unchanged (minor formatting/typo)
      unchanged.push([oi, ni]);
    } else {
      modified.push([oi, ni, sim]);
    }
  }

  // Step 3: remaining unmatched = added/removed
  for (const op of unmatchedOld) {
    if (!usedOld.has(op.index)) removed.push(op.index);
  }
  for (const np of unmatchedNew) {
    if (!usedNew.has(np.index)) added.push(np.index);
  }

  const totalOld = oldParas.length || 1;
  const changeRatio = (modified.length + removed.length + added.length) / (totalOld + added.length);

  return { unchanged, modified, added, removed, changeRatio };
}

// ── LCS on index sequences ──────────────────────────────────────

/** Returns pairs of [oldIndex, newIndex] for the longest common subsequence. */
function lcsIndices(a: string[], b: string[]): Array<[number, number]> {
  const m = a.length;
  const n = b.length;
  // DP table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  // Backtrack
  const result: Array<[number, number]> = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.push([i - 1, j - 1]);
      i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return result.reverse();
}
