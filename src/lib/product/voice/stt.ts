import { readFile, unlink } from 'fs/promises';
import { basename } from 'path';

export async function transcribe(audioPath: string): Promise<string> {
  const audioBuffer = await readFile(audioPath);

  const form = new FormData();
  const audioBlob = new Blob([audioBuffer], { type: 'audio/wav' });
  form.append('file', audioBlob, basename(audioPath));
  form.append('model', 'whisper-1');
  form.append('language', 'en');
  form.append('response_format', 'text');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: form,
  });

  await unlink(audioPath).catch(() => {});

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Whisper ${res.status}: ${err}`);
  }

  const text = await res.text();
  return text.trim();
}
