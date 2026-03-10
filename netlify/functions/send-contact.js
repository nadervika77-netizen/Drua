exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
  const FROM_EMAIL       = process.env.SENDGRID_FROM_EMAIL;
  const TO_EMAIL         = 'victoria@druaconsulting.com';

  try {
    const { name, email, company, service, message } = JSON.parse(event.body || '{}');

    if (!name || !email || !message) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields.' }) };
    }

    const emailBody = `
New contact form submission from druaconsulting.com

Name: ${name}
Email: ${email}
Company: ${company || 'Not provided'}
Service of Interest: ${service || 'Not specified'}

Message:
${message}
    `.trim();

    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SENDGRID_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: TO_EMAIL, name: 'Victoria Nadershahi' }] }],
        from: { email: FROM_EMAIL, name: 'Drua Consulting Website' },
        reply_to: { email: email, name: name },
        subject: `New Contact: ${name}${service ? ' — ' + service : ''}`,
        content: [{ type: 'text/plain', value: emailBody }]
      })
    });

    if (res.status === 202) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    } else {
      const err = await res.text();
      throw new Error(`SendGrid error: ${err}`);
    }

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
