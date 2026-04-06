-- Store fetched source references for display in the Sources tab.
ALTER TABLE reasonqa_analyses ADD COLUMN IF NOT EXISTS sources JSONB DEFAULT '[]';
