-- Pass 4: Argument Reconstruction output.
ALTER TABLE reasonqa_analyses ADD COLUMN IF NOT EXISTS pass4_output JSONB;
