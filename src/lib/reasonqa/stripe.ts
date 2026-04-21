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

const REVISION_WINDOW_DAYS = 7;

/**
 * Check if an incremental re-analysis is within the 7-day revision window.
 * If the parent full analysis was created within the last 7 days, the
 * incremental is free. Otherwise it costs a credit.
 */
export async function isWithinRevisionWindow(parentAnalysisId: string): Promise<boolean> {
  // Walk up to the version group root (the original full analysis)
  const { data } = await getSupabaseAdmin()
    .from('reasonqa_analyses')
    .select('created_at, analysis_type, parent_analysis_id, version_group_id')
    .eq('id', parentAnalysisId)
    .single();

  if (!data) return false;

  // Find the root analysis (the original full analysis in this version chain)
  let rootCreatedAt = data.created_at;
  if (data.analysis_type === 'incremental' && data.version_group_id) {
    const { data: root } = await getSupabaseAdmin()
      .from('reasonqa_analyses')
      .select('created_at')
      .eq('id', data.version_group_id)
      .single();
    if (root) rootCreatedAt = root.created_at;
  }

  const windowMs = REVISION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() - new Date(rootCreatedAt).getTime() < windowMs;
}
