-- User profiles — structured psychological model
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  identity JSONB DEFAULT '{}'::jsonb,
  values JSONB DEFAULT '{}'::jsonb,
  patterns JSONB DEFAULT '{}'::jsonb,
  relationships JSONB DEFAULT '{}'::jsonb,
  current_state JSONB DEFAULT '{}'::jsonb,
  interaction_prefs JSONB DEFAULT '{}'::jsonb,
  relationship_meta JSONB DEFAULT '{"conversation_count": 0, "total_messages": 0}'::jsonb
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own profile" ON user_profiles FOR ALL USING (auth.uid() = user_id);
