import { createClient } from '@/lib/supabase/server';

// In-memory store for last observe data per user (server-side only)
// This is ephemeral — cleared on server restart. Fine for dev.
const lastObserve = new Map<string, unknown>();

export function setObserveData(userId: string, data: unknown): void {
  lastObserve.set(userId, data);
}

export async function GET(): Promise<Response> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const data = lastObserve.get(user.id);
  if (!data) {
    return Response.json({});
  }

  return Response.json(data);
}
