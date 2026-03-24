'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useRef, useEffect, useState, useMemo, type FormEvent } from 'react';
import { VoiceInput } from './voice-input';

function getTextContent(message: { parts?: Array<{ type: string; text?: string }> }): string {
  if (!message.parts) return '';
  return message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text' && typeof p.text === 'string')
    .map(p => p.text)
    .join('');
}

export function ChatUI() {
  const transport = useMemo(() => new DefaultChatTransport({ api: '/api/chat' }), []);
  const { messages, sendMessage, status } = useChat({ transport });
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState('');
  const [voiceEnabled, setVoiceEnabled] = useState(false);

  const isLoading = status === 'streaming' || status === 'submitted';

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // TTS for assistant responses
  const lastAssistantRef = useRef<string>('');
  useEffect(() => {
    if (!voiceEnabled || isLoading) return;
    const lastAssistant = messages.filter(m => m.role === 'assistant').pop();
    if (!lastAssistant) return;
    const text = getTextContent(lastAssistant);
    if (text && text !== lastAssistantRef.current) {
      lastAssistantRef.current = text;
      fetch('/api/voice/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
        .then(res => res.arrayBuffer())
        .then(buf => {
          const blob = new Blob([buf], { type: 'audio/mpeg' });
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audio.play().catch(() => {});
          audio.onended = () => URL.revokeObjectURL(url);
        })
        .catch(() => {});
    }
  }, [messages, isLoading, voiceEnabled]);

  function handleVoiceTranscript(text: string) {
    sendMessage({ text });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage({ text: input });
    setInput('');
  }

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <h1 className="text-lg font-medium">Jasper</h1>
        <button
          onClick={() => setVoiceEnabled(v => !v)}
          className={`text-sm px-3 py-1 rounded-full transition-colors ${
            voiceEnabled ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400'
          }`}
        >
          {voiceEnabled ? 'Voice on' : 'Voice off'}
        </button>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-600 text-lg">Say something.</p>
          </div>
        )}
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
        {isLoading && messages[messages.length - 1]?.role === 'user' && (
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
            disabled={isLoading}
            className="flex-1 px-4 py-3 bg-gray-900 border border-gray-800 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-xl text-white font-medium transition-colors"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
