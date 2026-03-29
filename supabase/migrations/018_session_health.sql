-- Session health tracking
CREATE TABLE IF NOT EXISTS session_health (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID REFERENCES conversations(id),
  user_id UUID,
  completed_at TIMESTAMPTZ DEFAULT now(),

  -- What fired
  summary_generated BOOLEAN DEFAULT false,
  summary_model TEXT,
  segments_extracted BOOLEAN DEFAULT false,
  segments_count INT DEFAULT 0,
  segments_inserted BOOLEAN DEFAULT false,
  calibration_updated BOOLEAN DEFAULT false,
  metacognition_ran BOOLEAN DEFAULT false,
  metacognition_patterns INT DEFAULT 0,
  profile_updated BOOLEAN DEFAULT false,

  -- Session context
  turn_count INT,
  session_duration_seconds INT,
  end_trigger TEXT,

  -- Errors
  errors JSONB DEFAULT '[]'
);

CREATE INDEX idx_session_health_user ON session_health(user_id);
CREATE INDEX idx_session_health_time ON session_health(completed_at);

-- Identity token tracking on turn logs
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS identity_tokens INT;

-- Conversation completeness view
CREATE OR REPLACE VIEW conversation_completeness AS
SELECT
  c.id as conversation_id,
  c.user_id,
  up.identity->>'name' as user_name,
  c.started_at as created_at,
  COALESCE(c.exchange_count, 0) as turn_count,

  c.summary IS NOT NULL as has_summary,
  c.analytics IS NOT NULL as has_analytics,

  sh.summary_generated,
  sh.segments_extracted,
  sh.segments_inserted,
  sh.calibration_updated,
  sh.metacognition_ran,
  sh.profile_updated,
  sh.end_trigger,
  sh.errors,

  (SELECT COUNT(*) FROM conversation_segments cs
   WHERE cs.conversation_id = c.id) as segment_count,

  CASE
    WHEN c.summary IS NULL AND COALESCE(c.exchange_count, 0) >= 4
      THEN 'MISSING_SUMMARY'
    WHEN sh.id IS NULL AND COALESCE(c.exchange_count, 0) >= 4
      THEN 'SESSION_END_NEVER_FIRED'
    WHEN sh.segments_inserted = false AND sh.segments_extracted = true
      THEN 'SEGMENTS_FAILED'
    WHEN sh.errors != '[]'::jsonb
      THEN 'HAS_ERRORS'
    ELSE 'OK'
  END as status

FROM conversations c
LEFT JOIN user_profiles up ON c.user_id = up.user_id
LEFT JOIN session_health sh ON sh.conversation_id = c.id
ORDER BY c.started_at DESC;
