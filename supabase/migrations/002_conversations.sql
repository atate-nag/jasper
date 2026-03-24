-- Conversations — full message history
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  started_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ,
  messages JSONB DEFAULT '[]'::jsonb,
  summary TEXT,
  classification JSONB,
  ending_state JSONB,
  exchange_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own conversations" ON conversations FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_conversations_user ON conversations(user_id, started_at DESC);
