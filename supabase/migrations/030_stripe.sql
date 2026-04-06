-- Stripe subscriptions and usage tracking for ReasonQA.

CREATE TABLE reasonqa_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE reasonqa_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own subscription" ON reasonqa_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

-- Monthly usage view
CREATE OR REPLACE VIEW reasonqa_monthly_usage AS
SELECT
  user_id,
  COUNT(*) AS analyses_this_month
FROM reasonqa_analyses
WHERE created_at > date_trunc('month', now())
  AND status != 'error'
GROUP BY user_id;
