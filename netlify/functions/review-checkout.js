const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const STRIPE_SECRET_KEY    = process.env.STRIPE_SECRET_KEY;
  const SUPABASE_URL         = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const APP_URL              = process.env.APP_URL || 'https://chic-torrone-565f3c.netlify.app';

  const SERVICES = {
    fda_513g:      { price_id: 'price_1T9EM79info9UScZhznexsPk', label: 'FDA 513(g) Request for Information Review', amount: 1000 },
    fda_presub:    { price_id: 'price_1T9ENE9info9UScZbR8OHMHb', label: 'FDA Pre-Submission (Q-Sub) Meeting Package Review', amount: 1000 },
    fda_510k:      { price_id: 'price_1T9ENn9info9UScZJSvS4HgW', label: 'FDA Premarket Notification 510(k) Review', amount: 5000 },
    fda_denovo:    { price_id: 'price_1T9EOu9info9UScZzyUZiXlZ', label: 'FDA De Novo Classification Request Review', amount: 8000 },
    fda_pma:       { price_id: 'price_1T9EPM9info9UScZsRwDjNOs', label: 'FDA Premarket Approval (PMA) Application Review', amount: 50000 },
    fda_qsr_gap:   { price_id: 'price_1T9EPq9info9UScZB617gykW', label: 'FDA QSR / ISO 13485 Gap Assessment', amount: 3500 },
    iso_qms:       { price_id: 'price_1T9EQK9info9UScZ1bsjuO8A', label: 'ISO 13485 QMS Implementation Review', amount: 1500 },
    dhf_review:    { price_id: 'price_1T9ER79info9UScZC45A9YQf', label: 'Design History File (DHF) Review', amount: 8000 },
    dhr_review:    { price_id: 'price_1T9ERp9info9UScZlFIC195Q', label: 'Device History Record (DHR) Review', amount: 1500 },
    capa_review:   { price_id: 'price_1T9ESI9info9UScZ6IprAObc', label: 'Corrective and Preventive Action (CAPA) System Review', amount: 1500 },
    quality_audit: { price_id: 'price_1T9ETj9info9UScZ6M5cFZO5', label: 'Conduct Internal Quality Audit', amount: 10000 },
    eu_mdr_tech:   { price_id: 'price_1T9EUH9info9UScZRFeK1ZvH', label: 'EU MDR Technical File Review', amount: 8000 },
  };

  try {
    const token = (event.headers.authorization || '').replace('Bearer ', '').trim();
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_SERVICE_KEY }
    });
    const userData = await userRes.json();
    if (!userData.id) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Not authenticated' }) };

    const { service } = JSON.parse(event.body || '{}');
    const selectedService = SERVICES[service];
    if (!selectedService) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid service' }) };

    const params = new URLSearchParams();
    params.append('payment_method_types[]', 'card');
    params.append('mode', 'payment');
    params.append('customer_email', userData.email);
    params.append('line_items[0][price]', selectedService.price_id);
    params.append('line_items[0][quantity]', '1');
    params.append('metadata[user_id]', userData.id);
    params.append('metadata[service]', service);
    params.append('success_url', `${APP_URL}/?review=success&service=${service}`);
    params.append('cancel_url', `${APP_URL}/?review=cancelled`);

    const sessionRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const session = await sessionRes.json();
    if (session.error) throw new Error(session.error.message);

    // Record the review order in Supabase as 'paid' 
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    await sb.from('reviews').insert({
      user_id: userData.id,
      email: userData.email,
      service: selectedService.label,
      amount_cents: selectedService.amount * 100,
      status: 'paid',
      stripe_session_id: session.id
    });

    return { statusCode: 200, headers, body: JSON.stringify({ checkout_url: session.url }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
