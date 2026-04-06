import { getStripe } from '@/lib/reasonqa/stripe';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function POST(req: Request): Promise<Response> {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return Response.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const body = await req.text();
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return Response.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error('[stripe] Webhook verification failed:', err);
    return Response.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  console.log(`[stripe] Webhook event: ${event.type}`);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      console.log(`[stripe] Session metadata:`, JSON.stringify(session.metadata));
      console.log(`[stripe] Session customer:`, session.customer);
      console.log(`[stripe] Session subscription:`, session.subscription);

      const userId = session.metadata?.userId;
      if (!userId) {
        console.error('[stripe] No userId in session metadata — cannot create subscription');
        break;
      }
      if (!session.subscription) {
        console.error('[stripe] No subscription ID in session — was this a subscription checkout?');
        break;
      }

      const { error: upsertError } = await admin.from('reasonqa_subscriptions').upsert({
        user_id: userId,
        stripe_customer_id: session.customer as string,
        stripe_subscription_id: session.subscription as string,
        status: 'active',
        current_period_start: new Date().toISOString(),
      }, { onConflict: 'user_id' });

      if (upsertError) {
        console.error('[stripe] Failed to upsert subscription:', upsertError.message);
      } else {
        console.log(`[stripe] Subscription created for ${userId}`);
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      await admin
        .from('reasonqa_subscriptions')
        .update({ status: 'cancelled' })
        .eq('stripe_subscription_id', sub.id);

      console.log(`[stripe] Subscription cancelled: ${sub.id}`);
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const rawSub = sub as unknown as Record<string, unknown>;
      const periodStart = rawSub.current_period_start as number | undefined;
      const periodEnd = rawSub.current_period_end as number | undefined;
      await admin
        .from('reasonqa_subscriptions')
        .update({
          status: sub.status === 'active' ? 'active' : sub.status,
          ...(periodStart ? { current_period_start: new Date(periodStart * 1000).toISOString() } : {}),
          ...(periodEnd ? { current_period_end: new Date(periodEnd * 1000).toISOString() } : {}),
        })
        .eq('stripe_subscription_id', sub.id);
      break;
    }
  }

  return Response.json({ received: true });
}
