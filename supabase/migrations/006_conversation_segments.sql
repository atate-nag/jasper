CREATE TABLE conversation_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) NOT NULL,
  user_id UUID REFERENCES auth.users NOT NULL,

  -- The enriched content (NOT raw transcript — extracted observations)
  content TEXT NOT NULL,

  -- Embedding for semantic search
  embedding vector(1536),

  -- Write-time metadata
  importance_score FLOAT NOT NULL DEFAULT 5.0,
  segment_type TEXT NOT NULL,
  topic_labels TEXT[] DEFAULT '{}',
  emotional_valence FLOAT,
  emotional_arousal FLOAT,

  -- Source reference back to raw conversation
  turn_range int4range,
  conversation_date TIMESTAMPTZ NOT NULL,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  last_accessed_at TIMESTAMPTZ
);

CREATE INDEX idx_segments_user ON conversation_segments(user_id);
CREATE INDEX idx_segments_conversation ON conversation_segments(conversation_id);
CREATE INDEX idx_segments_date ON conversation_segments(user_id, conversation_date DESC);
CREATE INDEX idx_segments_type ON conversation_segments(user_id, segment_type);
CREATE INDEX idx_segments_topics ON conversation_segments USING GIN(topic_labels);

CREATE INDEX idx_segments_embedding ON conversation_segments
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

ALTER TABLE conversation_segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own segments" ON conversation_segments
  FOR ALL USING (auth.uid() = user_id);
