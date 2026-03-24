import { getProfile, upsertProfile } from '@/lib/backbone/profile';
import { getRecentConversations } from '@/lib/backbone/conversations';
import { NextRequest } from 'next/server';

export async function GET(req: NextRequest): Promise<Response> {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) {
    return Response.json({ error: 'userId is required' }, { status: 400 });
  }

  const action = req.nextUrl.searchParams.get('action') ?? 'profile';

  switch (action) {
    case 'profile': {
      const profile = await getProfile(userId);
      return Response.json({ profile });
    }
    case 'memories': {
      const { getAllMemories } = await import('@/lib/backbone/memory');
      const memories = await getAllMemories(userId);
      return Response.json({ memories });
    }
    case 'conversations': {
      const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '10');
      const conversations = await getRecentConversations(userId, limit);
      return Response.json({ conversations });
    }
    default:
      return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}

export async function POST(req: Request): Promise<Response> {
  const body = await req.json();
  const { userId, profile } = body as { userId: string; profile: Record<string, unknown> };

  if (!userId) {
    return Response.json({ error: 'userId is required' }, { status: 400 });
  }

  const updated = await upsertProfile(userId, profile);
  return Response.json({ profile: updated });
}
