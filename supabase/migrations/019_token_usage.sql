-- Token usage tracking for every LLM call
CREATE TABLE IF NOT EXISTS token_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  user_id UUID,
  conversation_id UUID,
  purpose TEXT NOT NULL,           -- 'chat', 'classify', 'summary', 'segments', 'metacognition', 'depth_scoring', 'relational_check', 'profile_merge', 'profile_compress', 'opener', 'dedup'
  model TEXT NOT NULL,
  provider TEXT NOT NULL,          -- 'anthropic', 'openai'
  input_tokens INT NOT NULL,
  output_tokens INT NOT NULL,
  cost_usd FLOAT NOT NULL,
  latency_ms INT
);

CREATE INDEX idx_token_usage_user ON token_usage(user_id);
CREATE INDEX idx_token_usage_time ON token_usage(created_at);
CREATE INDEX idx_token_usage_purpose ON token_usage(purpose);
