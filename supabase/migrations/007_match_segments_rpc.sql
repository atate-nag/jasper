-- RPC function for pgvector similarity search on conversation_segments
CREATE OR REPLACE FUNCTION match_segments(
  query_embedding vector(1536),
  match_user_id UUID,
  match_count INT DEFAULT 20,
  min_importance FLOAT DEFAULT 3.0
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  importance_score FLOAT,
  segment_type TEXT,
  topic_labels TEXT[],
  emotional_valence FLOAT,
  conversation_date TIMESTAMPTZ,
  conversation_id UUID,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
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
    1 - (cs.embedding <=> query_embedding) AS similarity
  FROM conversation_segments cs
  WHERE cs.user_id = match_user_id
    AND cs.importance_score >= min_importance
  ORDER BY cs.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
