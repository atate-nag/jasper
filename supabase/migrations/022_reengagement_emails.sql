-- Re-engagement email tracking
CREATE TABLE IF NOT EXISTS reengagement_emails (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT now(),
  subject TEXT,
  thread_identified TEXT,
  sensitive BOOLEAN DEFAULT false,

  -- Outcomes
  opened BOOLEAN,
  responded BOOLEAN,
  reengaged_with_product BOOLEAN,
  reengaged_at TIMESTAMPTZ,

  notes TEXT
);

CREATE INDEX idx_reengagement_user ON reengagement_emails(user_id);
