-- ReasonQA product shell — document reasoning quality analysis.

CREATE TABLE reasonqa_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  plan TEXT NOT NULL DEFAULT 'free',
  analyses_used INT NOT NULL DEFAULT 0,
  analyses_limit INT NOT NULL DEFAULT 10,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE reasonqa_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own profile" ON reasonqa_profiles
  FOR ALL USING (auth.uid() = user_id);

CREATE TABLE reasonqa_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  title TEXT,
  doc_type TEXT NOT NULL,
  doc_text TEXT NOT NULL,
  doc_size_bytes INT,
  pass1_output JSONB,
  pass2_output JSONB,
  metrics_output JSONB,
  pass3_output JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  product TEXT NOT NULL DEFAULT 'reasonqa'
);

CREATE INDEX idx_reasonqa_analyses_user ON reasonqa_analyses (user_id, created_at DESC);
CREATE INDEX idx_reasonqa_analyses_status ON reasonqa_analyses (status);

ALTER TABLE reasonqa_analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own analyses" ON reasonqa_analyses
  FOR ALL USING (auth.uid() = user_id);

CREATE TABLE reasonqa_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  analysis_id UUID REFERENCES reasonqa_analyses(id),
  event TEXT NOT NULL,
  model TEXT,
  input_tokens INT,
  output_tokens INT,
  cost_usd NUMERIC(10,6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reasonqa_usage_user ON reasonqa_usage_log (user_id);

ALTER TABLE reasonqa_usage_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own usage" ON reasonqa_usage_log
  FOR ALL USING (auth.uid() = user_id);
