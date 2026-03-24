CREATE TABLE bandit_state (
  user_id UUID REFERENCES auth.users NOT NULL,
  policy_id TEXT REFERENCES policy_library(id) NOT NULL,
  context_hash TEXT NOT NULL,
  alpha FLOAT DEFAULT 1.0,
  beta FLOAT DEFAULT 1.0,
  trials INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, policy_id, context_hash)
);

ALTER TABLE bandit_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own bandit state" ON bandit_state FOR ALL USING (auth.uid() = user_id);
