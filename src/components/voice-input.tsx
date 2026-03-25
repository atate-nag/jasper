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
        if (audioBlob.size < 1000) return; // too short

        setIsTranscribing(true);
        try {
          const formData = new FormData();
          formData.append('audio', audioBlob, 'recording.webm');

          const res = await fetch('/api/voice/transcribe', {
            method: 'POST',
            body: formData,
          });

          if (res.ok) {
            const { text } = await res.json();
            if (text && isValidSpeech(text)) {
              onTranscript(text.trim());
            }
          }
        } catch (err) {
          console.error('Transcription failed:', err);
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
      <span className="text-sm text-gray-500">
        {isRecording ? 'Recording... release to send' : isTranscribing ? 'Transcribing...' : 'Hold to speak'}
      </span>
    </div>
  );
}
