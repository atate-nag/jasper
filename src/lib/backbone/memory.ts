// Mem0 integration — DISABLED.
// Memory extraction is handled by conversation segments (recall.ts)
// and profile classification (classify.ts). Mem0 had persistent issues:
// missing peer deps, no writable filesystem on Vercel, wrong default model.

export interface MemoryResult {
  id?: string;
  memory: string;
  score?: number;
}

export async function searchMemories(
  _userId: string,
  _query: string,
  _limit: number = 10,
): Promise<MemoryResult[]> {
  return [];
}

export async function addToMemory(
  _userId: string,
  _messages: { role: string; content: string }[],
): Promise<void> {
  // No-op — segments and profile classifier handle memory
}

export async function getAllMemories(
  _userId: string,
): Promise<MemoryResult[]> {
  return [];
}
