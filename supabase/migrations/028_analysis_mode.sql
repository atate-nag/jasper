-- Analysis mode: 'full' (three-pass) or 'quick' (single-pass).
ALTER TABLE reasonqa_analyses ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'full';
