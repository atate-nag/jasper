'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useRef, useEffect, useState, useMemo, useCallback, type FormEvent } from 'react';
import { VoiceInput } from './voice-input';
import { AudioPlaybackQueue } from './audio-playback-queue';

function getTextContent(message: { parts?: Array<{ type: string; text?: string }> }): string {
  if (!message.parts) return '';
  return message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text' && typeof p.text === 'string')
    .map(p => p.text)
    .join('');
}

interface ObserveData {
  intent: string;
  valence: number;
  arousal: number;
  posture: string;
  length: string;
  challenge: boolean;
  dispreferred: boolean;
  confidence: number;
  rationale: string;
  policy: string;
  model: string;
  tier: string;
  temperature: number;
  maxTokens: number;
  recallTier: string;
  recallQuery: string | null;
  steerLatencyMs: number;
}

const CLONE_OPENER = "Hey. I'm Jasper. Good to meet you.";

interface ChatUIProps {
  isClone?: boolean;
  isFirstVisit?: boolean;
  userName?: string | null;
}

export function ChatUI({ isClone = false, isFirstVisit = false, userName = null }: ChatUIProps = {}) {
  const transport = useMemo(() => new DefaultChatTransport({ api: '/api/chat' }), []);
  const { messages, sendMessage, status } = useChat({ transport });
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const audioQueueRef = useRef<AudioPlaybackQueue | null>(null);
  const [input, setInput] = useState('');
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceMessages, setVoiceMessages] = useState<Array<{ id: string; role: string; text: string }>>(() => {
    if (isClone && isFirstVisit) {
      // First-ever conversation — hardcoded introduction
      return [{ id: 'clone-opener', role: 'assistant', text: CLONE_OPENER }];
    }
    return [];
  });
  const [voiceStreaming, setVoiceStreaming] = useState(false);
  const [observeMode, setObserveMode] = useState(false);
  const [observeLog, setObserveLog] = useState<ObserveData[]>([]);

  const isLoading = status === 'streaming' || status === 'submitted';

  // Fetch model-generated opener for returning clone users
  useEffect(() => {
    if (isClone && !isFirstVisit && voiceMessages.length === 0) {
      fetch('/api/chat/opener', { method: 'POST' })
        .then(res => res.json())
        .then(data => {
          if (data.opener) {
            setVoiceMessages([{ id: 'clone-opener', role: 'assistant', text: data.opener }]);
          }
        })
        .catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll for observe data by fetching headers from a lightweight endpoint
  // Alternative: intercept via custom fetch wrapper
  const fetchObserve = useCallback(async () => {
    if (!observeMode) return;
    try {
      const res = await fetch('/api/observe');
      if (res.ok) {
        const data = await res.json();
        if (data && data.intent) {
          setObserveLog(prev => [...prev.slice(-19), data]);
        }
      }
    } catch { /* ignore */ }
  }, [observeMode]);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, voiceMessages, observeLog]);

  // Fetch observe data after each response completes
  useEffect(() => {
    if (observeMode && !isLoading && messages.length > 0) {
      fetchObserve();
    }
  }, [isLoading, messages.length, observeMode, fetchObserve]);

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // TTS is now handled by sentence-level streaming via /api/chat/voice
  // See handleVoiceSubmit for the implementation

  async function handleVoiceSubmit(userText: string) {
    if (!audioQueueRef.current) {
      audioQueueRef.current = new AudioPlaybackQueue();
      audioQueueRef.current.initFromGesture();
    }
    audioQueueRef.current.reset();

    // Add user message to voice messages
    const userMsgId = `voice-user-${Date.now()}`;
    const assistantMsgId = `voice-assistant-${Date.now()}`;
    setVoiceMessages(prev => [...prev, { id: userMsgId, role: 'user', text: userText }]);
    setVoiceMessages(prev => [...prev, { id: assistantMsgId, role: 'assistant', text: '' }]);
    setVoiceStreaming(true);

    try {
      // Build message history from both useChat messages and voice messages
      const allMessages = [
        ...messages.map(m => ({ role: m.role, parts: m.parts })),
        ...voiceMessages.filter(m => m.text).map(m => ({ role: m.role, parts: [{ type: 'text', text: m.text }] })),
        { role: 'user', parts: [{ type: 'text', text: userText }] },
      ];

      const res = await fetch('/api/chat/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: allMessages }),
      });

      if (!res.ok || !res.body) {
        setVoiceStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop()!;

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') break;

          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'text') {
              // Append text to the assistant message for display
              setVoiceMessages(prev =>
                prev.map(m => m.id === assistantMsgId
                  ? { ...m, text: m.text + parsed.content }
                  : m
                )
              );
            }
            if (parsed.type === 'audio') {
              audioQueueRef.current?.enqueue(parsed.index, parsed.audio);
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (err) {
      console.error('[voice] Stream error:', err);
    } finally {
      setVoiceStreaming(false);
    }
  }

  function handleVoiceTranscript(text: string) {
    if (voiceEnabled) {
      handleVoiceSubmit(text); // voice route only — handles both text and audio
    } else {
      sendMessage({ text });
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading || voiceStreaming) return;
    if (voiceEnabled) {
      handleVoiceSubmit(input);
    } else {
      sendMessage({ text: input });
    }
    setInput('');
  }

  // Keyboard shortcut: Ctrl+Shift+O to toggle observe
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && e.shiftKey && e.key === 'O') {
        e.preventDefault();
        setObserveMode(v => !v);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <h1 className="text-lg font-medium">Jasper</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setObserveMode(v => !v)}
            className={`text-sm px-3 py-1 rounded-full transition-colors ${
              observeMode ? 'bg-yellow-600 text-white' : 'bg-gray-800 text-gray-500'
            }`}
          >
            {observeMode ? 'Observe' : 'Observe'}
          </button>
          <button
            onClick={() => {
              setVoiceEnabled(v => {
                const newVal = !v;
                if (newVal && !audioQueueRef.current) {
                  audioQueueRef.current = new AudioPlaybackQueue();
                  audioQueueRef.current.initFromGesture();
                }
                return newVal;
              });
            }}
            className={`text-sm px-3 py-1 rounded-full transition-colors ${
              voiceEnabled ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400'
            }`}
          >
            {voiceEnabled ? 'Voice on' : 'Voice off'}
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Messages */}
        <div ref={scrollRef} className={`flex-1 overflow-y-auto px-6 py-4 space-y-6 flex flex-col ${observeMode ? 'w-2/3' : 'w-full'}`} style={{ flexDirection: 'column' }}>
          {messages.length === 0 && voiceMessages.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <p className="text-gray-600 text-lg">Say something.</p>
            </div>
          )}
          {/* Regular chat messages */}
          {messages.map((m) => {
            const text = getTextContent(m);
            if (!text) return null;
            return (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                    m.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-100'
                  }`}
                >
                  <p className="whitespace-pre-wrap leading-relaxed">{text}</p>
                </div>
              </div>
            );
          })}
          {/* Voice mode messages */}
          {voiceMessages.map((m) => {
            if (!m.text) return null;
            return (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                    m.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-100'
                  }`}
                >
                  <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
                </div>
              </div>
            );
          })}
          {(isLoading || voiceStreaming) && (
            <div className="flex justify-start">
              <div className="bg-gray-800 rounded-2xl px-4 py-3">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Observe panel */}
        {observeMode && (
          <div className="w-1/3 border-l border-gray-800 overflow-y-auto bg-gray-900 p-4 text-xs font-mono">
            <h2 className="text-yellow-500 font-bold mb-3">Observe</h2>
            {observeLog.length === 0 && (
              <p className="text-gray-600">Send a message to see steering data.</p>
            )}
            {observeLog.map((obs, i) => (
              <div key={i} className="mb-4 border-b border-gray-800 pb-3">
                <div className="text-yellow-400">Turn {i + 1}</div>
                <div className="mt-1 space-y-1">
                  <div><span className="text-gray-500">intent:</span> {obs.intent}</div>
                  <div><span className="text-gray-500">posture:</span> {obs.posture}</div>
                  <div><span className="text-gray-500">valence:</span> {obs.valence} <span className="text-gray-500">arousal:</span> {obs.arousal}</div>
                  <div><span className="text-gray-500">confidence:</span> {obs.confidence}</div>
                  <div><span className="text-gray-500">challenge:</span> {obs.challenge ? 'yes' : 'no'} <span className="text-gray-500">dispreferred:</span> {obs.dispreferred ? 'yes' : 'no'}</div>
                  <div className="text-yellow-400 mt-1">
                    <span className="text-gray-500">policy:</span> {obs.policy}
                  </div>
                  <div><span className="text-gray-500">model:</span> {obs.model} ({obs.tier})</div>
                  <div><span className="text-gray-500">temp:</span> {obs.temperature} <span className="text-gray-500">max:</span> {obs.maxTokens}</div>
                  <div><span className="text-gray-500">recall:</span> {obs.recallTier === 'none' ? 'none' : `${obs.recallTier}: "${obs.recallQuery}"`}</div>
                  <div><span className="text-gray-500">steer:</span> {obs.steerLatencyMs}ms</div>
                  <div className="text-gray-400 mt-1 italic text-[10px] leading-tight">
                    {obs.rationale.substring(0, 150)}{obs.rationale.length > 150 ? '...' : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Voice input */}
      {voiceEnabled && <VoiceInput onTranscript={handleVoiceTranscript} />}

      {/* Text input */}
      <form onSubmit={handleSubmit} className="px-6 py-4 border-t border-gray-800">
        <div className="flex gap-3">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            disabled={isLoading || voiceStreaming}
            className="flex-1 px-4 py-3 bg-gray-900 border border-gray-800 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading || voiceStreaming || !input.trim()}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-xl text-white font-medium transition-colors"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
