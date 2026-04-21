import Stripe from 'stripe';
import { getSupabaseAdmin } from '@/lib/supabase';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2025-03-31.basil',
    });
  }
  return _stripe;
}

const FREE_LIMIT = 2;
const PRO_LIMIT = 20;

export async function getMonthlyUsage(userId: string): Promise<number> {
  const { count } = await getSupabaseAdmin()
    .from('reasonqa_analyses')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .neq('status', 'error')
    .neq('analysis_type', 'incremental')
    .gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString());
  return count ?? 0;
}

export async function getActiveSubscription(userId: string): Promise<{ id: string; status: string } | null> {
  const { data } = await getSupabaseAdmin()
    .from('reasonqa_subscriptions')
    .select('id, status')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();
  return data;
}

export async function checkUsageLimit(userId: string): Promise<{
  allowed: boolean;
  usage: number;
  limit: number;
  isPro: boolean;
}> {
  const sub = await getActiveSubscription(userId);
  const isPro = !!sub;
  const limit = isPro ? PRO_LIMIT : FREE_LIMIT;
  const usage = await getMonthlyUsage(userId);
  return { allowed: usage < limit, usage, limit, isPro };
}
