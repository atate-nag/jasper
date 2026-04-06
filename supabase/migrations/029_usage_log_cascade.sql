-- Fix: usage log should cascade-delete when analysis is deleted.
ALTER TABLE reasonqa_usage_log DROP CONSTRAINT IF EXISTS reasonqa_usage_log_analysis_id_fkey;
ALTER TABLE reasonqa_usage_log ADD CONSTRAINT reasonqa_usage_log_analysis_id_fkey
  FOREIGN KEY (analysis_id) REFERENCES reasonqa_analyses(id) ON DELETE CASCADE;
