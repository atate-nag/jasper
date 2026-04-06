-- Per-pass timing and token stats for progress display.
ALTER TABLE reasonqa_analyses ADD COLUMN IF NOT EXISTS pass_stats JSONB DEFAULT '{}';
