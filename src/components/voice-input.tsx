'use client';

import { useState, useRef, useCallback } from 'react';

const WHISPER_HALLUCINATIONS = [
  /thanks for watching/i,
  /like and subscribe/i,
  /see you in the next video/i,
  /please subscribe/i,
  /thanks for listening/i,
  /\bsubscribe\b.*\bchannel\b/i,
  /\bbell\b.*\bnotification/i,
  /thank you for watching/i,
  /don't forget to subscribe/i,
  /hit the like button/i,
];

function isValidSpeech(transcription: string): boolean {
  const cleaned = transcription
    .replace(/[.\s,!?;:\-–—…'"()[\]{}]/g, '')
    .trim();
  if (cleaned.length < 3) return false;
  if (WHISPER_HALLUCINATIONS.some(p => p.test(transcription))) return false;
  return true;
}

interface VoiceInputProps {
  onTranscript: (text: string) => void;
}

export function VoiceInput({ onTranscript }: VoiceInputProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (audioBlob.size < 5000) {
          // Too short — Whisper returns 500 on tiny files
          setStatusText('Too short — try again');
          setTimeout(() => setStatusText(null), 2000);
          return;
        }

        setIsTranscribing(true);
        setStatusText(null);
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

          const formData = new FormData();
          formData.append('audio', audioBlob, 'recording.webm');

          const res = await fetch('/api/voice/transcribe', {
            method: 'POST',
            body: formData,
            signal: controller.signal,
          });
          clearTimeout(timeout);

          if (res.ok) {
            const { text } = await res.json();
            if (text && isValidSpeech(text)) {
              onTranscript(text.trim());
            } else {
              setStatusText('Couldn\u2019t catch that — try again');
              setTimeout(() => setStatusText(null), 2000);
            }
          } else {
            console.error('Transcription error:', res.status);
            setStatusText('Transcription failed — try again');
            setTimeout(() => setStatusText(null), 2000);
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            console.error('Transcription timed out');
            setStatusText('Timed out — try again');
          } else {
            console.error('Transcription failed:', err);
            setStatusText('Transcription failed — try again');
          }
          setTimeout(() => setStatusText(null), 2000);
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Microphone access denied:', err);
    }
  }, [onTranscript]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, []);

  return (
    <div className="px-6 py-3 border-t border-gray-800 flex items-center gap-3">
      <button
        onMouseDown={startRecording}
        onMouseUp={stopRecording}
        onTouchStart={startRecording}
        onTouchEnd={stopRecording}
        disabled={isTranscribing}
        className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
          isRecording
            ? 'bg-red-500 scale-110 animate-pulse'
            : isTranscribing
              ? 'bg-yellow-600'
              : 'bg-blue-600 hover:bg-blue-700'
        } text-white text-xl disabled:opacity-50`}
      >
        🎤
      </button>
      <span className={`text-sm ${statusText ? 'text-yellow-500' : 'text-gray-500'}`}>
        {statusText || (isRecording ? 'Recording... release to send' : isTranscribing ? 'Transcribing...' : 'Hold to speak')}
      </span>
    </div>
  );
}
