exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const STRIPE_SECRET_KEY    = process.env.STRIPE_SECRET_KEY;
  const SUPABASE_URL         = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const APP_URL              = process.env.APP_URL || 'https://www.druaconsulting.com/chat';

  // Expert Review Services — these match the buyReview() calls in index.html
  const SERVICES = {
    fda_513g:     { amount: 100000,  label: 'FDA 513(g) Request for Information Review' },
    fda_presub:   { amount: 100000,  label: 'FDA Pre-Submission (Q-Sub) Meeting Package Review' },
    fda_510k:     { amount: 500000,  label: 'FDA Premarket Notification 510(k) Review' },
    fda_denovo:   { amount: 800000,  label: 'FDA De Novo Classification Request Review' },
    fda_pma:      { amount: 5000000, label: 'FDA Premarket Approval (PMA) Application Review' },
    fda_qsr_gap:  { amount: 350000,  label: 'FDA QSR / ISO 13485 Gap Assessment' },
    iso_qms:      { amount: 150000,  label: 'ISO 13485 QMS Implementation Review' },
    dhf_review:   { amount: 800000,  label: 'Design History File (DHF) Review' },
    dhr_review:   { amount: 150000,  label: 'Device History Record (DHR) Review' },
    capa_review:  { amount: 150000,  label: 'Corrective and Preventive Action (CAPA) System Review' },
    quality_audit:{ amount: 1000000, label: 'Internal Quality Audit' },
    eu_mdr_tech:  { amount: 800000,  label: 'EU MDR Technical File Review' },
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
    params.append('line_items[0][price_data][currency]', 'usd');
    params.append('line_items[0][price_data][unit_amount]', selectedService.amount);
    params.append('line_items[0][price_data][product_data][name]', selectedService.label);
    params.append('line_items[0][quantity]', '1');
    params.append('metadata[user_id]', userData.id);
    params.append('metadata[service]', service);
    params.append('success_url', `${APP_URL}?review=success`);
    params.append('cancel_url', `${APP_URL}?review=cancelled`);

    const sessionRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const session = await sessionRes.json();
    if (session.error) throw new Error(session.error.message);

    return { statusCode: 200, headers, body: JSON.stringify({ checkout_url: session.url }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
