import { createClient } from '@/lib/supabase/server';
import { logUsage } from '@/lib/usage';

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

  try {
    console.log(`[transcribe] File: ${audioFile.name}, size: ${audioFile.size}, type: ${audioFile.type}`);

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: whisperForm,
    });

    if (!response.ok) {
      const err = await response.text();
      console.error(`[transcribe] Whisper error: ${err}`);
      return Response.json({ error: `Whisper ${response.status}: ${err}` }, { status: 500 });
    }

    const text = await response.text();
    const trimmed = text.trim();
    console.log(`[transcribe] Result (${trimmed.length} chars): "${trimmed.slice(0, 200)}"`);

    // Whisper pricing: $0.006/min. Estimate duration from file size (~16KB/s for webm audio)
    const estimatedSeconds = Math.max(1, audioFile.size / 16000);
    logUsage({
      inputTokens: Math.round(estimatedSeconds), // store seconds as "tokens" for cost calc
      outputTokens: 0,
      model: 'whisper-1',
      provider: 'openai',
    }, 'transcribe', user.id);

    return Response.json({ text: trimmed });
  } catch (err) {
    console.error('[transcribe] Unhandled error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
