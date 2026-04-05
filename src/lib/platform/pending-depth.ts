interface PendingDepth {
  thread: string;
  dimension: 'connection' | 'tension' | 'both';
  score: number;
  generatedAt: number;
  turnNumber: number;
}

const pendingDepthStore = new Map<string, PendingDepth>();

export function storePendingDepth(
  userId: string,
  result: { thread: string; dimension: string; score: number },
  turnNumber: number,
): void {
  pendingDepthStore.set(userId, {
    thread: result.thread,
    dimension: result.dimension as PendingDepth['dimension'],
    score: result.score,
    generatedAt: Date.now(),
    turnNumber,
  });
  console.log(`[depth-scoring] Stored pending depth (score ${result.score}, ${result.dimension}): "${result.thread}"`);
}

export function consumePendingDepth(
  userId: string,
  currentTurn: number,
): PendingDepth | null {
  const pending = pendingDepthStore.get(userId);
  if (!pending) return null;

  // Only use if from the immediately previous turn
  if (currentTurn - pending.turnNumber > 1) {
    pendingDepthStore.delete(userId);
    return null;
  }

  // Only use if generated within last 30 seconds
  if (Date.now() - pending.generatedAt > 30000) {
    pendingDepthStore.delete(userId);
    return null;
  }

  pendingDepthStore.delete(userId);
  console.log(`[depth-scoring] Consuming pending depth: "${pending.thread}"`);
  return pending;
}

export function clearPendingDepth(userId: string): void {
  pendingDepthStore.delete(userId);
}

export type { PendingDepth };
