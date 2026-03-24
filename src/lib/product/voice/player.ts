import { spawn, execSync } from 'child_process';

function findPlayer(): string | null {
  for (const cmd of ['play', 'mpv', 'ffplay', 'afplay']) {
    try {
      execSync(`which ${cmd}`, { stdio: 'ignore' });
      return cmd;
    } catch { continue; }
  }
  return null;
}

const ARGS: Record<string, string[]> = {
  play: ['-t', 'mp3', '-q', '-'],
  mpv: ['--no-terminal', '--no-video', '-'],
  ffplay: ['-nodisp', '-autoexit', '-i', '-'],
  afplay: [],
};

let cached: string | null | undefined;

export async function playAudio(mp3: Buffer): Promise<void> {
  if (cached === undefined) cached = findPlayer();
  if (!cached) {
    console.error('[voice] No audio player found. Install sox, mpv, or ffmpeg.');
    return;
  }

  if (cached === 'afplay') {
    const { writeFile, unlink } = await import('fs/promises');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const { randomUUID } = await import('crypto');
    const tmpPath = join(tmpdir(), `jasper-play-${randomUUID()}.mp3`);
    await writeFile(tmpPath, mp3);
    return new Promise((resolve) => {
      const proc = spawn('afplay', [tmpPath], { stdio: ['ignore', 'ignore', 'ignore'] });
      proc.on('close', async () => { await unlink(tmpPath).catch(() => {}); resolve(); });
      proc.on('error', () => resolve());
    });
  }

  return new Promise((resolve) => {
    const proc = spawn(cached!, ARGS[cached!], { stdio: ['pipe', 'ignore', 'ignore'] });
    proc.stdin.write(mp3);
    proc.stdin.end();
    proc.on('close', () => resolve());
    proc.on('error', () => resolve());
  });
}
