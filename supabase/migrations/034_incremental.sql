-- Incremental re-analysis support

ALTER TABLE reasonqa_analyses ADD COLUMN parent_analysis_id UUID REFERENCES reasonqa_analyses(id);
ALTER TABLE reasonqa_analyses ADD COLUMN version_group_id UUID;
ALTER TABLE reasonqa_analyses ADD COLUMN version_number INT NOT NULL DEFAULT 1;
ALTER TABLE reasonqa_analyses ADD COLUMN analysis_type TEXT NOT NULL DEFAULT 'full';
ALTER TABLE reasonqa_analyses ADD COLUMN doc_text_encrypted BYTEA;
ALTER TABLE reasonqa_analyses ADD COLUMN doc_text_enc_iv BYTEA;
ALTER TABLE reasonqa_analyses ADD COLUMN doc_text_expires_at TIMESTAMPTZ;
ALTER TABLE reasonqa_analyses ADD COLUMN incremental_meta JSONB;

CREATE INDEX idx_analyses_version_group ON reasonqa_analyses(version_group_id);
CREATE INDEX idx_analyses_parent ON reasonqa_analyses(parent_analysis_id);

-- Backfill: each existing analysis is its own version group
UPDATE reasonqa_analyses SET version_group_id = id WHERE version_group_id IS NULL;
