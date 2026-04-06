import { createClient } from '@/lib/supabase/server';
import { getStripe } from '@/lib/reasonqa/stripe';

export async function POST(): Promise<Response> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const stripe = getStripe();
  const priceId = process.env.STRIPE_PRO_PRICE_ID;
  if (!priceId) {
    return Response.json({ error: 'Stripe not configured' }, { status: 500 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  const session = await stripe.checkout.sessions.create({
    customer_email: user.email!,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/reasonqa/dashboard?upgraded=true`,
    cancel_url: `${appUrl}/reasonqa/dashboard`,
    metadata: { userId: user.id },
  });

  return Response.json({ url: session.url });
}
