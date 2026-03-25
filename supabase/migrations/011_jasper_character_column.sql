ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS jasper_character JSONB DEFAULT '{}';
