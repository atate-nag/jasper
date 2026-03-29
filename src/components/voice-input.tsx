'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

// Web Speech API types — not yet in lib.dom for all browsers
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

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

// Check if the browser supports the Web Speech API
function getSpeechRecognition(): (new () => SpeechRecognition) | null {
  if (typeof window === 'undefined') return null;
  return (
    (window as unknown as Record<string, unknown>).SpeechRecognition ||
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition
  ) as (new () => SpeechRecognition) | null;
}

interface VoiceInputProps {
  onTranscript: (text: string) => void;
}

export function VoiceInput({ onTranscript }: VoiceInputProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [useNative, setUseNative] = useState(false);

  // Whisper fallback refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Native speech recognition refs
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const nativeResultRef = useRef<string>('');

  // Detect native speech support on mount
  useEffect(() => {
    const SpeechRec = getSpeechRecognition();
    if (SpeechRec) {
      setUseNative(true);
      console.log('[voice] Using native SpeechRecognition');
    } else {
      console.log('[voice] Native SpeechRecognition not available — using Whisper');
    }
  }, []);

  // ── Native SpeechRecognition (instant, no network) ──────────────

  const startNativeRecording = useCallback(() => {
    const SpeechRec = getSpeechRecognition();
    if (!SpeechRec) return;

    const recognition = new SpeechRec();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-GB';
    recognitionRef.current = recognition;
    nativeResultRef.current = '';

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = '';
      let interimTranscript = '';
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }
      nativeResultRef.current = finalTranscript || interimTranscript;
      // Show interim results as status
      if (interimTranscript && !finalTranscript) {
        setStatusText(interimTranscript.slice(0, 60) + (interimTranscript.length > 60 ? '...' : ''));
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('[voice] Native recognition error:', event.error);
      if (event.error === 'no-speech') {
        setStatusText('No speech detected — try again');
        setTimeout(() => setStatusText(null), 2000);
      }
    };

    recognition.onend = () => {
      const text = nativeResultRef.current.trim();
      setStatusText(null);
      if (text && isValidSpeech(text)) {
        onTranscript(text);
      } else if (text) {
        // Had text but it was filtered
        setStatusText('Couldn\u2019t catch that — try again');
        setTimeout(() => setStatusText(null), 2000);
      }
      setIsRecording(false);
    };

    recognition.start();
    setIsRecording(true);
    setStatusText(null);
  }, [onTranscript]);

  const stopNativeRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      // onend handler will fire and process the result
    }
  }, []);

  // ── Whisper fallback (for browsers without SpeechRecognition) ───

  const startWhisperRecording = useCallback(async () => {
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
          setStatusText('Too short — try again');
          setTimeout(() => setStatusText(null), 2000);
          return;
        }

        setIsTranscribing(true);
        setStatusText(null);
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15000);

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

  const stopWhisperRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, []);

  // ── Unified start/stop ──────────────────────────────────────────

  const startRecording = useCallback(() => {
    if (useNative) {
      startNativeRecording();
    } else {
      startWhisperRecording();
    }
  }, [useNative, startNativeRecording, startWhisperRecording]);

  const stopRecording = useCallback(() => {
    if (useNative) {
      stopNativeRecording();
    } else {
      stopWhisperRecording();
    }
  }, [useNative, stopNativeRecording, stopWhisperRecording]);

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
