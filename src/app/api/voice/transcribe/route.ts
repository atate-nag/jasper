import { createClient } from '@/lib/supabase/server';

export const maxDuration = 30;

export async function POST(req: Request): Promise<Response> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return new Response('Unauthorized', { status: 401 });

  const formData = await req.formData();
  const audioFile = formData.get('audio') as File;
  if (!audioFile) return Response.json({ error: 'No audio file' }, { status: 400 });

  const whisperForm = new FormData();
  whisperForm.append('file', audioFile);
  whisperForm.append('model', 'whisper-1');
  whisperForm.append('language', 'en');
  whisperForm.append('response_format', 'text');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: whisperForm,
  });

  if (!response.ok) {
    const err = await response.text();
    return Response.json({ error: `Whisper error: ${err}` }, { status: 500 });
  }

  const text = await response.text();
  return Response.json({ text: text.trim() });
}
