interface PendingConnection {
  thread: string;
  connection: string;
  generatedAt: number;
  turnNumber: number;
}

const pendingConnections = new Map<string, PendingConnection>();

export function storePendingConnection(
  userId: string,
  result: { thread: string; connection: string },
  turnNumber: number,
): void {
  pendingConnections.set(userId, {
    thread: result.thread,
    connection: result.connection,
    generatedAt: Date.now(),
    turnNumber,
  });
  console.log(`[relational-check] Stored connection: "${result.connection}" (thread: ${result.thread})`);
}

export function consumePendingConnection(
  userId: string,
  currentTurn: number,
): PendingConnection | null {
  const pending = pendingConnections.get(userId);
  if (!pending) return null;
  if (currentTurn - pending.turnNumber > 2) {
    pendingConnections.delete(userId);
    return null;
  }
  if (Date.now() - pending.generatedAt > 60000) {
    pendingConnections.delete(userId);
    return null;
  }
  pendingConnections.delete(userId);
  console.log(`[relational-check] Consuming connection: "${pending.connection}"`);
  return pending;
}
