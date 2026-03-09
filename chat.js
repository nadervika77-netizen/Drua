exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const STRIPE_SECRET_KEY    = process.env.STRIPE_SECRET_KEY;
  const SUPABASE_URL         = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const APP_URL              = process.env.APP_URL || 'https://lambent-pony-28059b.netlify.app';

  const PLANS = {
    starter:    { credits: 5,   amount: 499,  label: '5 Regulatory Questions' },
    basic:      { credits: 20,  amount: 1499, label: '20 Regulatory Questions' },
    pro:        { credits: 50,  amount: 2999, label: '50 Regulatory Questions' },
    enterprise: { credits: 100, amount: 4999, label: '100 Regulatory Questions' },
  };

  try {
    const token = (event.headers.authorization || '').replace('Bearer ', '').trim();
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_SERVICE_KEY }
    });
    const userData = await userRes.json();
    if (!userData.id) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Not authenticated' }) };

    const { plan } = JSON.parse(event.body || '{}');
    const selectedPlan = PLANS[plan];
    if (!selectedPlan) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid plan' }) };

    const params = new URLSearchParams();
    params.append('payment_method_types[]', 'card');
    params.append('mode', 'payment');
    params.append('customer_email', userData.email);
    params.append('line_items[0][price_data][currency]', 'usd');
    params.append('line_items[0][price_data][unit_amount]', selectedPlan.amount);
    params.append('line_items[0][price_data][product_data][name]', selectedPlan.label);
    params.append('line_items[0][quantity]', '1');
    params.append('metadata[user_id]', userData.id);
    params.append('metadata[plan]', plan);
    params.append('metadata[credits]', selectedPlan.credits.toString());
    params.append('success_url', `${APP_URL}/?payment=success&credits=${selectedPlan.credits}`);
    params.append('cancel_url', `${APP_URL}/?payment=cancelled`);

    const sessionRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const session = await sessionRes.json();
    if (session.error) throw new Error(session.error.message);

    await fetch(`${SUPABASE_URL}/rest/v1/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, apikey: SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: userData.id, stripe_session_id: session.id, credits_purchased: selectedPlan.credits, amount_cents: selectedPlan.amount, status: 'pending' }),
    });

    return { statusCode: 200, headers, body: JSON.stringify({ checkout_url: session.url }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
