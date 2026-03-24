export class AudioPlaybackQueue {
  private audioContext: AudioContext | null = null;
  private queue: Map<number, string> = new Map(); // index -> base64 audio
  private nextToPlay: number = 0;
  private isPlaying: boolean = false;
  private onPlaybackStart?: () => void;
  private onPlaybackEnd?: () => void;

  constructor(options?: { onPlaybackStart?: () => void; onPlaybackEnd?: () => void }) {
    this.onPlaybackStart = options?.onPlaybackStart;
    this.onPlaybackEnd = options?.onPlaybackEnd;
  }

  private getAudioContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }
    return this.audioContext;
  }

  // Must be called from a user gesture (click/tap) on iOS
  initFromGesture(): void {
    this.getAudioContext();
  }

  async enqueue(index: number, base64Audio: string): Promise<void> {
    this.queue.set(index, base64Audio);
    this.tryPlayNext();
  }

  private async tryPlayNext(): Promise<void> {
    if (this.isPlaying) return;

    const base64 = this.queue.get(this.nextToPlay);
    if (!base64) return;

    this.isPlaying = true;
    this.queue.delete(this.nextToPlay);

    try {
      const ctx = this.getAudioContext();
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));

      if (this.nextToPlay === 0) {
        this.onPlaybackStart?.();
      }

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      source.onended = () => {
        this.nextToPlay++;
        this.isPlaying = false;

        if (this.queue.size === 0) {
          this.onPlaybackEnd?.();
        } else {
          this.tryPlayNext();
        }
      };

      source.start();
    } catch (err) {
      console.error('[audio] Playback error:', err);
      this.nextToPlay++;
      this.isPlaying = false;
      this.tryPlayNext();
    }
  }

  reset(): void {
    this.queue.clear();
    this.nextToPlay = 0;
    this.isPlaying = false;
  }
}
