-- Update match_segments to accept array of user IDs for clone dual-search
DROP FUNCTION IF EXISTS match_segments(text, uuid, int, float);

CREATE OR REPLACE FUNCTION match_segments(
  query_embedding text,
  match_user_ids uuid[],
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
  ORDER BY cs.embedding <=> embedding_vector
  LIMIT match_count;
END;
$$;
