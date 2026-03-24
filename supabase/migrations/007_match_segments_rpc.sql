-- RPC function for pgvector similarity search on conversation_segments
-- Accepts embedding as text (JSON array) since Supabase JS client serialises it
DROP FUNCTION IF EXISTS match_segments(vector, uuid, int, float);
DROP FUNCTION IF EXISTS match_segments(text, uuid, int, float);

CREATE OR REPLACE FUNCTION match_segments(
  query_embedding text,
  match_user_id uuid,
  match_count int DEFAULT 20,
  min_importance float DEFAULT 3.0
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
  -- Cast the JSON text to a vector
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
  WHERE cs.user_id = match_user_id
    AND cs.importance_score >= min_importance
  ORDER BY cs.embedding <=> embedding_vector
  LIMIT match_count;
END;
$$;
