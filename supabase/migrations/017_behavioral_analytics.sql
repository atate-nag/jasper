-- Behavioural analytics columns on turn_logs
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS correction_detected BOOLEAN DEFAULT false;
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS disclosure_depth FLOAT;
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS user_initiated_topic BOOLEAN DEFAULT false;
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS wit_detected BOOLEAN DEFAULT false;
