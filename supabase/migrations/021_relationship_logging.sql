-- Relationship guardrail logging columns
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS relationship_context_active BOOLEAN DEFAULT false;
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS relationship_turn_count INT;
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS relationship_safety_check BOOLEAN;
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS relationship_regenerated BOOLEAN DEFAULT false;
