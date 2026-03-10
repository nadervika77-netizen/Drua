exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  const SUCCESS_URL = 'https://www.druaconsulting.com/contact?purchase=success';
  const CANCEL_URL  = 'https://www.druaconsulting.com/shop';

  try {
    const { productName, amount, email } = JSON.parse(event.body || '{}');

    if (!productName || !amount || !email) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields.' }) };
    }

    if (!email.includes('@')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid email address.' }) };
    }

    const params = new URLSearchParams();
    params.append('payment_method_types[]', 'card');
    params.append('mode', 'payment');
    params.append('customer_email', email);
    params.append('line_items[0][price_data][currency]', 'usd');
    params.append('line_items[0][price_data][unit_amount]', amount.toString());
    params.append('line_items[0][price_data][product_data][name]', productName);
    params.append('line_items[0][price_data][product_data][description]', 'Drua Consulting — Medical Device Regulatory Services');
    params.append('line_items[0][quantity]', '1');
    params.append('metadata[product]', productName);
    params.append('metadata[client_email]', email);
    params.append('success_url', SUCCESS_URL);
    params.append('cancel_url', CANCEL_URL);

    const sessionRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const session = await sessionRes.json();
    if (session.error) throw new Error(session.error.message);

    return { statusCode: 200, headers, body: JSON.stringify({ checkout_url: session.url }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
