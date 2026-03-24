CREATE TABLE policy_library (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  posture_class TEXT NOT NULL,
  relational_depth_range TEXT[],
  system_prompt_fragment TEXT NOT NULL,
  response_structure JSONB NOT NULL,
  constraints JSONB NOT NULL,
  version INTEGER DEFAULT 1,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- No RLS — policies are global, not user-scoped
