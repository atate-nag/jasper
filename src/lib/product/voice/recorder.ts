import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

export interface RecordingOptions {
  silenceThreshold?: string;
  silenceDuration?: string;
  maxDuration?: number;
}

export async function recordUntilSilence(opts: RecordingOptions = {}): Promise<string> {
  const { silenceThreshold = '1%', silenceDuration = '1.5', maxDuration = 30 } = opts;
  const outPath = join(tmpdir(), `jasper-${randomUUID()}.wav`);

  return new Promise((resolve, reject) => {
    const proc = spawn('rec', [
      outPath, 'rate', '16000', 'channels', '1',
      'silence', '1', '0.1', silenceThreshold, '1', silenceDuration, silenceThreshold,
      'trim', '0', String(maxDuration),
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve(outPath);
      else reject(new Error(`rec exited ${code}: ${stderr}`));
    });
    proc.on('error', (err) => {
      reject(new Error(`rec not found. Install sox: brew install sox. ${err.message}`));
    });
    setTimeout(() => { proc.kill('SIGTERM'); }, (maxDuration + 2) * 1000);
  });
}

export async function recordUntilEnter(maxDuration = 120): Promise<string> {
  const outPath = join(tmpdir(), `jasper-${randomUUID()}.wav`);

  return new Promise((resolve, reject) => {
    const proc = spawn('rec', [
      outPath, 'rate', '16000', 'channels', '1', 'trim', '0', String(maxDuration),
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    const onData = (data: Buffer) => {
      const str = data.toString();
      if (str.includes('\n') || str.includes('\r')) proc.kill('SIGTERM');
    };

    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);

    proc.on('close', (code) => {
      process.stdin.removeListener('data', onData);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      if (code === 0 || code === null || code === 143) resolve(outPath);
      else reject(new Error(`rec exited ${code}: ${stderr}`));
    });
    proc.on('error', (err) => {
      process.stdin.removeListener('data', onData);
      reject(new Error(`rec not found. ${err.message}`));
    });
    setTimeout(() => { proc.kill('SIGTERM'); }, (maxDuration + 2) * 1000);
  });
}
