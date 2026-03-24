ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS self_observations JSONB DEFAULT '[]';
