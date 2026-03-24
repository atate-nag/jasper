import { synthesise } from './tts';
import { playAudio } from './player';

export function createSpeechStream(): {
  push: (token: string) => void;
  end: () => void;
  done: () => Promise<void>;
} {
  let buffer = '';
  let sentenceCount = 0;
  let playChain: Promise<void> = Promise.resolve();
  let resolveAll: () => void;
  let allChunksQueued = false;
  let chunksQueued = 0;
  let chunksPlayed = 0;

  const allDone = new Promise<void>((resolve) => { resolveAll = resolve; });

  function checkAllDone(): void {
    if (allChunksQueued && chunksPlayed >= chunksQueued) resolveAll();
  }

  function queueChunk(text: string): void {
    if (text.trim().length < 3) return;
    chunksQueued++;
    const ttsPromise = synthesise(text.trim()).catch(() => Buffer.alloc(0));
    playChain = playChain.then(async () => {
      const mp3 = await ttsPromise;
      if (mp3.length > 0) await playAudio(mp3);
      chunksPlayed++;
      checkAllDone();
    });
  }

  return {
    push(token: string): void {
      buffer += token;
      const sentenceEnd = buffer.match(/[.!?]["')\]]?\s+(?=[A-Z\u{1F300}-\u{1F9FF}])/u);
      if (sentenceEnd && sentenceEnd.index !== undefined) {
        sentenceCount++;
        const threshold = chunksQueued === 0 ? 1 : 2;
        if (sentenceCount >= threshold) {
          let lastBoundary = 0;
          const regex = /[.!?]["')\]]?\s+(?=[A-Z\u{1F300}-\u{1F9FF}])/gu;
          let match;
          while ((match = regex.exec(buffer)) !== null) {
            lastBoundary = match.index + match[0].length;
          }
          if (lastBoundary > 0) {
            const chunk = buffer.slice(0, lastBoundary);
            buffer = buffer.slice(lastBoundary);
            sentenceCount = 0;
            queueChunk(chunk);
          }
        }
      }
    },

    end(): void {
      if (buffer.trim().length > 0) {
        queueChunk(buffer);
        buffer = '';
      }
      allChunksQueued = true;
      if (chunksQueued === 0) resolveAll();
      else checkAllDone();
    },

    done(): Promise<void> {
      return allDone;
    },
  };
}
