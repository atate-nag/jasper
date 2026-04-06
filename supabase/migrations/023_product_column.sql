-- Add product column to distinguish data from different product shells.
-- Default 'jasper' so all existing rows are correctly attributed.

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS product TEXT NOT NULL DEFAULT 'jasper';
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS product TEXT NOT NULL DEFAULT 'jasper';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS product TEXT NOT NULL DEFAULT 'jasper';
ALTER TABLE conversation_segments ADD COLUMN IF NOT EXISTS product TEXT NOT NULL DEFAULT 'jasper';

-- Index for product-scoped queries
CREATE INDEX IF NOT EXISTS idx_conversations_product ON conversations (product);
CREATE INDEX IF NOT EXISTS idx_turn_logs_product ON turn_logs (product);
CREATE INDEX IF NOT EXISTS idx_segments_product ON conversation_segments (product);

-- Update match_segments RPC to filter by product
DROP FUNCTION IF EXISTS match_segments(text, uuid[], int, float);

CREATE OR REPLACE FUNCTION match_segments(
  query_embedding text,
  match_user_ids uuid[],
  match_count int DEFAULT 20,
  min_importance float DEFAULT 3.0,
  match_product text DEFAULT 'jasper'
)
RETURNS TABLE (
  id uuid,
  content text,
  importance_score float,
  segment_type text,
  topic_labels text[],
  emotional_valence float,
  conversation_date timestamptz,
  conversation_id uuid,
  similarity float
)
LANGUAGE plpgsql
AS $$
DECLARE
  embedding_vector vector(1536);
BEGIN
  embedding_vector := query_embedding::vector;

  RETURN QUERY
  SELECT
    cs.id,
    cs.content,
    cs.importance_score,
    cs.segment_type,
    cs.topic_labels,
    cs.emotional_valence,
    cs.conversation_date,
    cs.conversation_id,
    1 - (cs.embedding <=> embedding_vector) AS similarity
  FROM conversation_segments cs
  WHERE cs.user_id = ANY(match_user_ids)
    AND cs.importance_score >= min_importance
    AND cs.product = match_product
  ORDER BY cs.embedding <=> embedding_vector
  LIMIT match_count;
END;
$$;
