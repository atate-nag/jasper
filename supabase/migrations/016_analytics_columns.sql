-- Expand turn_logs with full analytics columns
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS user_message_preview TEXT;
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS user_message_length INTEGER;
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS valence FLOAT;
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS arousal FLOAT;
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS classification_confidence FLOAT;
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS classifier_salvaged BOOLEAN DEFAULT false;
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS distress_override BOOLEAN DEFAULT false;
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS prompt_components JSONB;
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS recall_segments_returned INTEGER;
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS recall_top_similarity FLOAT;
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS depth_score_fired BOOLEAN DEFAULT false;
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS depth_stored BOOLEAN DEFAULT false;
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS depth_consumed BOOLEAN DEFAULT false;
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS depth_dimension TEXT;
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS relational_check_fired BOOLEAN DEFAULT false;
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS relational_connection_found BOOLEAN DEFAULT false;
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS relational_thread_name TEXT;
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS relational_connection_text TEXT;
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS relational_consumed BOOLEAN DEFAULT false;
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS care_context_injected BOOLEAN DEFAULT false;
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS response_preview TEXT;
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS response_length INTEGER;
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS total_turn_duration_ms INTEGER;
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS conversation_mode TEXT;
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS thread_count INTEGER;
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS energy TEXT;

-- Session-level analytics on conversations table
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS analytics JSONB;

-- Index for analytics queries
CREATE INDEX IF NOT EXISTS idx_turn_logs_timestamp ON turn_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_turn_logs_intent ON turn_logs(intent);
CREATE INDEX IF NOT EXISTS idx_turn_logs_model ON turn_logs(model_used);
