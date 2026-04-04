'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useRef, useEffect, useState, useMemo, useCallback, type FormEvent } from 'react';
import Markdown from 'react-markdown';
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
  const openerRef = useRef<string | null>(null);
  const transport = useMemo(() => new DefaultChatTransport({
    api: '/api/chat',
    body: () => openerRef.current ? { openerMessage: openerRef.current } : {},
  }), []);
  const { messages, sendMessage, status, error: chatError, clearError } = useChat({ transport });
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const audioQueueRef = useRef<AudioPlaybackQueue | null>(null);
  const [input, setInput] = useState('');
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceMessages, setVoiceMessages] = useState<Array<{ id: string; role: string; text: string }>>([]);
  const [voiceStreaming, setVoiceStreaming] = useState(false);
  const [observeMode, setObserveMode] = useState(false);
  const [observeLog, setObserveLog] = useState<ObserveData[]>([]);
  const [openerMessage, setOpenerMessage] = useState<string | null>(null);
  const [previousConversations, setPreviousConversations] = useState<Array<{ startedAt: string; messages: Array<{ role: string; content: string }> }>>([]);
  const [ready, setReady] = useState(!isClone); // non-clone users are ready immediately

  const isLoading = status === 'streaming' || status === 'submitted';
  const [stuckTimer, setStuckTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [showStuckWarning, setShowStuckWarning] = useState(false);

  // Detect stuck state: if status is 'submitted' for >30s without streaming, show warning
  useEffect(() => {
    if (status === 'submitted') {
      const timer = setTimeout(() => setShowStuckWarning(true), 30000);
      setStuckTimer(timer);
    } else {
      if (stuckTimer) clearTimeout(stuckTimer);
      setStuckTimer(null);
      setShowStuckWarning(false);
    }
    return () => { if (stuckTimer) clearTimeout(stuckTimer); };
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch previous conversations for display
  useEffect(() => {
    fetch('/api/chat/history')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.conversations?.length > 0) {
          setPreviousConversations(data.conversations);
        }
      })
      .catch(() => {});
  }, []);

  // Initialize opener — blocks input until resolved
  useEffect(() => {
    if (!isClone) return;

    async function init() {
      if (isFirstVisit) {
        // First-ever conversation — hardcoded introduction
        setVoiceMessages([{ id: 'clone-opener', role: 'assistant', text: CLONE_OPENER }]);
        setOpenerMessage(CLONE_OPENER);
        openerRef.current = CLONE_OPENER;
      } else {
        // Returning user — fetch model-generated opener
        try {
          const res = await fetch('/api/chat/opener', { method: 'POST' });
          const data = await res.json();
          if (data.opener) {
            setVoiceMessages([{ id: 'clone-opener', role: 'assistant', text: data.opener }]);
            setOpenerMessage(data.opener);
            openerRef.current = data.opener;
          }
        } catch { /* proceed without opener */ }
      }
      setReady(true);
    }
    init();
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

      const voiceController = new AbortController();
      const voiceTimeout = setTimeout(() => voiceController.abort(), 55000); // 55s (server max is 60s)

      const res = await fetch('/api/chat/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: allMessages }),
        signal: voiceController.signal,
      });
      clearTimeout(voiceTimeout);

      if (!res.ok || !res.body) {
        console.error('[voice] Response not OK:', res.status);
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
            if (parsed.type === 'error') {
              console.error('[voice] Server stream error:', parsed.error);
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (err) {
      console.error('[voice] Stream error:', err);
    } finally {
      setVoiceStreaming(false);
      // If the assistant message is still empty, the stream failed silently
      setVoiceMessages(prev => {
        const assistantMsg = prev.find(m => m.id === assistantMsgId);
        if (assistantMsg && !assistantMsg.text) {
          // Remove the empty bubble and show feedback
          console.error('[voice] Stream produced no text — removing empty assistant bubble');
          return prev.filter(m => m.id !== assistantMsgId);
        }
        return prev;
      });
    }
  }

  function handleVoiceTranscript(text: string) {
    // Check for relationship keywords even in voice mode
    if (relationshipKeywords.test(text)) {
      relationshipActiveRef.current = true;
    }

    if (relationshipActiveRef.current && !voiceEnabled) {
      handleRelationshipSubmit(text);
    } else if (voiceEnabled) {
      handleVoiceSubmit(text);
    } else {
      sendMessage({ text });
    }
  }

  // Relationship mode: detect keywords and use non-streaming path
  const relationshipKeywords = /\b(partner|wife|husband|boyfriend|girlfriend|my ex|she said|he said|she thinks|he thinks|she doesn'?t|he doesn'?t|she won'?t|he won'?t|she feels|he feels|she wants|he wants|she will|he will|she is|he is|told me|accused me|blocked me|called me|says I|telling me|my family|my partner|my spouse|the divorce|custody|separated|the kids|co-?parent|settlement|he always|she always|he never|she never|relationship (help|advice|problems?|issues?))\b/i;
  const relationshipActiveRef = useRef(false);

  async function handleRelationshipSubmit(text: string) {
    const userMsgId = `rel-user-${Date.now()}`;
    const assistantMsgId = `rel-assistant-${Date.now()}`;
    setVoiceMessages(prev => [...prev, { id: userMsgId, role: 'user', text }]);
    setVoiceMessages(prev => [...prev, { id: assistantMsgId, role: 'assistant', text: '' }]);
    setVoiceStreaming(true); // reuse as "thinking" indicator

    try {
      // Build message history from both sources
      const allMessages = [
        ...messages.map(m => ({ role: m.role, parts: m.parts })),
        ...voiceMessages.filter(m => m.text).map(m => ({ role: m.role, parts: [{ type: 'text', text: m.text }] })),
        { role: 'user', parts: [{ type: 'text', text }] },
      ];

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: allMessages,
          ...(relationshipActiveRef.current ? { relationshipMode: true } : { searchMode: true }),
          ...(openerRef.current ? { openerMessage: openerRef.current } : {}),
        }),
      });

      if (res.headers.get('X-Jasper-Non-Streamed') === 'true') {
        // Non-streamed relationship mode response
        const data = await res.json();
        setVoiceMessages(prev =>
          prev.map(m => m.id === assistantMsgId
            ? { ...m, text: data.content }
            : m
          )
        );
      } else {
        // Fell through to streaming — shouldn't happen but handle gracefully
        // Read the stream and accumulate
        if (res.body) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let fullText = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            fullText += decoder.decode(value, { stream: true });
          }
          // Try to extract text from SSE format
          const textMatch = fullText.match(/"text(?:Delta)?"\s*:\s*"((?:[^"\\]|\\.)*)"/);
          const extracted = textMatch ? JSON.parse('"' + textMatch[1] + '"') : fullText;
          setVoiceMessages(prev =>
            prev.map(m => m.id === assistantMsgId
              ? { ...m, text: extracted }
              : m
            )
          );
        }
      }
    } catch (err) {
      console.error('[relationship-mode] Error:', err);
      setVoiceMessages(prev => prev.filter(m => m.id !== assistantMsgId));
    } finally {
      setVoiceStreaming(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading || voiceStreaming) return;

    const text = input;
    setInput('');

    if (voiceEnabled) {
      handleVoiceSubmit(text);
      return;
    }

    // Check for relationship keywords
    if (relationshipKeywords.test(text)) {
      relationshipActiveRef.current = true;
    }

    // Check for search-triggering keywords
    const searchKeywords = /\b(look up|search|find|what is|who is|who are|what are|what was|what were|latest|recent|this week|came out|article|quote|book called|can you check|do you know|have you heard)\b/i;
    const needsDirectPath = relationshipActiveRef.current || searchKeywords.test(text);

    // Direct path for relationship mode or search-eligible turns
    if (needsDirectPath) {
      handleRelationshipSubmit(text);
    } else {
      sendMessage({ text });
    }
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
        <div ref={scrollRef} className={`flex-1 overflow-y-auto px-6 py-4 space-y-6 ${observeMode ? 'w-2/3' : 'w-full'}`}>
          {/* Previous conversation history */}
          {previousConversations.length > 0 && (
            <div className="space-y-6 pb-4 mb-4 border-b border-gray-700">
              {previousConversations.map((conv, ci) => (
                <div key={`conv-${ci}`} className="space-y-3">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">
                    {new Date(conv.startedAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </p>
                  {conv.messages.map((m, i) => (
                    <div key={`prev-${ci}-${i}`} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                          m.role === 'user'
                            ? 'bg-blue-800/40 text-gray-300'
                            : 'bg-gray-800/70 text-gray-300'
                        }`}
                      >
                        {m.role === 'assistant' ? (
                          <div className="prose prose-invert prose-base max-w-none leading-relaxed">
                            <Markdown>{m.content}</Markdown>
                          </div>
                        ) : (
                          <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
          {messages.length === 0 && voiceMessages.length === 0 && previousConversations.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <p className="text-gray-600 text-lg">Say something.</p>
            </div>
          )}
          {/* All messages merged chronologically */}
          {(() => {
            const merged: Array<{ key: string; role: string; text: string; ts: number }> = [];

            // Voice/opener messages — use timestamp from ID or creation order
            voiceMessages.forEach((m) => {
              if (!m.text) return;
              // Extract timestamp from ID format: voice-user-{timestamp} or clone-opener
              const tsMatch = m.id.match(/(\d{13,})/);
              const ts = tsMatch ? parseInt(tsMatch[1]) : 0; // opener gets 0 = always first
              merged.push({ key: m.id, role: m.role, text: m.text, ts });
            });

            // Regular chat messages — use index-based timestamps starting from
            // a baseline that places them after the opener but interleaves with voice
            const chatBaseline = 1; // after opener (ts=0)
            messages.forEach((m, i) => {
              const text = getTextContent(m);
              if (!text) return;
              merged.push({ key: m.id, role: m.role, text, ts: chatBaseline + i });
            });

            // Sort: opener first (ts=0), then all others by timestamp.
            // Chat messages (ts=1,2,3...) come before voice messages (ts=Date.now())
            // which is correct — text messages were sent first, voice messages later.
            merged.sort((a, b) => a.ts - b.ts);

            return merged.map((m) => (
              <div key={m.key} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                    m.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-100'
                  }`}
                >
                  {m.role === 'assistant' ? (
                    <div className="prose prose-invert prose-base max-w-none leading-relaxed">
                      <Markdown>{m.text}</Markdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
                  )}
                </div>
              </div>
            ));
          })()}
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

      {/* Stuck warning */}
      {showStuckWarning && !chatError && (
        <div className="px-6 py-3 bg-yellow-900/50 border-t border-yellow-800">
          <span className="text-yellow-300 text-sm">
            Taking longer than expected. Your message may not have gone through — try refreshing the page.
          </span>
        </div>
      )}

      {/* Error banner */}
      {chatError && (
        <div className="px-6 py-3 bg-red-900/50 border-t border-red-800 flex items-center justify-between">
          <span className="text-red-300 text-sm">
            {chatError.message.includes('401') || chatError.message.includes('Unauthorized')
              ? 'Session expired — please refresh the page and try again.'
              : `Something went wrong — try sending your message again.`}
          </span>
          <button
            onClick={() => clearError()}
            className="text-red-400 hover:text-red-200 text-sm px-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Text input */}
      <form onSubmit={handleSubmit} className="px-6 py-4 border-t border-gray-800">
        <div className="flex gap-3">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={!ready || isLoading || voiceStreaming}
            placeholder={ready ? "Type a message..." : "..."}
            className="flex-1 px-4 py-3 bg-gray-900 border border-gray-800 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!ready || isLoading || voiceStreaming || !input.trim()}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-xl text-white font-medium transition-colors"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
