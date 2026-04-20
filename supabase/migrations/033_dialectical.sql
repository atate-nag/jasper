-- Dialectical synthesis output (Passes 5-9).
ALTER TABLE reasonqa_analyses ADD COLUMN IF NOT EXISTS dialectical BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE reasonqa_analyses ADD COLUMN IF NOT EXISTS pass5_output JSONB;
ALTER TABLE reasonqa_analyses ADD COLUMN IF NOT EXISTS pass6_output JSONB;
ALTER TABLE reasonqa_analyses ADD COLUMN IF NOT EXISTS pass7_output JSONB;
ALTER TABLE reasonqa_analyses ADD COLUMN IF NOT EXISTS pass8_output JSONB;
ALTER TABLE reasonqa_analyses ADD COLUMN IF NOT EXISTS pass9_output JSONB;
