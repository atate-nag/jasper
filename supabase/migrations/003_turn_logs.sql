CREATE TABLE turn_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  conversation_id UUID REFERENCES conversations(id),
  turn_number INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),

  -- Input
  user_message TEXT NOT NULL,
  person_context_summary JSONB,

  -- Classification
  response_directive JSONB NOT NULL,
  classification_latency_ms INTEGER,

  -- Policy
  selected_policy_id TEXT NOT NULL,
  exploration_flag BOOLEAN DEFAULT false,

  -- Output
  system_prompt_hash TEXT,
  reformulated_message TEXT,
  model_config JSONB,
  assistant_response TEXT,
  response_latency_ms INTEGER,

  -- Outcome signals (populated asynchronously)
  next_turn_engagement_depth FLOAT,
  challenge_accepted BOOLEAN,
  low_energy BOOLEAN,
  sycophancy_detected BOOLEAN,
  session_continued BOOLEAN,

  -- Delayed outcome
  user_returned_within_days INTEGER
);

ALTER TABLE turn_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own turn logs" ON turn_logs FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_turn_logs_user ON turn_logs(user_id, created_at DESC);
CREATE INDEX idx_turn_logs_conversation ON turn_logs(conversation_id, turn_number);
