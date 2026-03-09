exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const STRIPE_SECRET_KEY      = process.env.STRIPE_SECRET_KEY;
  const STRIPE_WEBHOOK_SECRET  = process.env.STRIPE_WEBHOOK_SECRET;
  const SUPABASE_URL           = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    // Verify Stripe signature
    const sig       = event.headers['stripe-signature'];
    const timestamp = sig.match(/t=(\d+)/)?.[1];
    const payload   = `${timestamp}.${event.body}`;

    const encoder = new TextEncoder();
    const key     = await crypto.subtle.importKey('raw', encoder.encode(STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sigBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    const expectedSig = Array.from(new Uint8Array(sigBytes)).map(b => b.toString(16).padStart(2, '0')).join('');
    const receivedSig = sig.match(/v1=([a-f0-9]+)/)?.[1];

    if (expectedSig !== receivedSig) return { statusCode: 400, body: 'Invalid signature' };

    const stripeEvent = JSON.parse(event.body);

    if (stripeEvent.type === 'checkout.session.completed') {
      const session = stripeEvent.data.object;
      if (session.payment_status !== 'paid') return { statusCode: 200, body: 'Not paid' };

      const { user_id, credits } = session.metadata;
      const creditsToAdd = parseInt(credits || '0');

      const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user_id}&select=credits`, {
        headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, apikey: SUPABASE_SERVICE_KEY }
      });
      const profiles = await profileRes.json();
      const profile = profiles[0];
      if (!profile) return { statusCode: 404, body: 'Profile not found' };

      await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user_id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, apikey: SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ credits: profile.credits + creditsToAdd }),
      });

      await fetch(`${SUPABASE_URL}/rest/v1/orders?stripe_session_id=eq.${session.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, apikey: SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'completed' }),
      });
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    console.error('Webhook error:', err);
    return { statusCode: 500, body: err.message };
  }
};
