import { createClient } from '@/lib/supabase/server';

export const maxDuration = 30;

export async function POST(req: Request): Promise<Response> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return new Response('Unauthorized', { status: 401 });

  const { text } = await req.json();
  if (!text) return Response.json({ error: 'No text' }, { status: 400 });

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'tts-1',
      input: text,
      voice: 'fable',
      speed: 1.2,
      response_format: 'mp3',
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    return Response.json({ error: `TTS error: ${err}` }, { status: 500 });
  }

  return new Response(response.body, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-cache',
    },
  });
}
