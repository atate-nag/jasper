-- Thread support: lateral conversation threads that emerge from demonstrated coherence

CREATE TABLE IF NOT EXISTS threads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  label TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  last_active_at TIMESTAMPTZ DEFAULT now(),

  -- Detection metadata
  detected_from_sessions INT DEFAULT 0,
  detection_confidence FLOAT DEFAULT 0,

  -- Thread context
  summary TEXT,
  open_questions JSONB DEFAULT '[]',
  last_position TEXT,

  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

CREATE INDEX idx_threads_user ON threads(user_id);
CREATE INDEX idx_threads_active ON threads(user_id, status) WHERE status = 'active';

-- Link conversations to threads
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS thread_id UUID REFERENCES threads(id);

-- Link segments to threads (for thread-specific recall)
ALTER TABLE conversation_segments
  ADD COLUMN IF NOT EXISTS thread_id UUID REFERENCES threads(id);
