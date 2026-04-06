-- Source cache for legal corpus lookups — avoids repeated API calls.

CREATE TABLE source_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  citation_raw TEXT NOT NULL,
  citation_type TEXT NOT NULL,
  source_uri TEXT NOT NULL,
  source_url TEXT NOT NULL,
  found BOOLEAN NOT NULL,
  text_content TEXT,
  paragraphs JSONB,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),

  UNIQUE(citation_raw)
);

CREATE INDEX idx_source_cache_citation ON source_cache (citation_raw);
CREATE INDEX idx_source_cache_expires ON source_cache (expires_at);
