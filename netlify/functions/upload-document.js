const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function sendUploadNotification(userEmail, service, fileUrl) {
  const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
  const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'victoria@druaconsulting.com';
  if (!SENDGRID_API_KEY) return;

  await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: FROM_EMAIL }] }],
      from: { email: FROM_EMAIL, name: 'Drua AI System' },
      subject: `📎 Document Uploaded for Review: ${service}`,
      content: [{
        type: 'text/html',
        value: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9f9f9;">
            <div style="background: #0a1628; padding: 24px; border-radius: 8px 8px 0 0;">
              <h1 style="color: #c9a84c; margin: 0; font-size: 1.4rem;">DRUA — Document Ready for Review</h1>
            </div>
            <div style="background: white; padding: 24px; border-radius: 0 0 8px 8px; border: 1px solid #eee;">
              <p><strong>Service:</strong> ${service}</p>
              <p><strong>Client Email:</strong> ${userEmail}</p>
              <p><strong>Uploaded At:</strong> ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT</p>
              <hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;">
              <p>The client has uploaded their document for your review.</p>
              <a href="${fileUrl}" style="display:inline-block;background:#c9a84c;color:#0a1628;padding:12px 24px;border-radius:4px;text-decoration:none;font-weight:bold;margin-top:8px;">Download Document</a>
              <hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;">
              <p style="color: #666; font-size: 0.85rem;">Reply to this email or contact the client at <a href="mailto:${userEmail}">${userEmail}</a>.</p>
            </div>
          </div>
        `
      }]
    })
  });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const token = (event.headers.authorization || '').replace('Bearer ', '').trim();
    const { data: { user }, error: authError } = await sb.auth.getUser(token);
    if (authError || !user) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

    // Check user has a paid review
    const { data: reviews } = await sb
      .from('reviews')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'paid')
      .is('file_url', null)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!reviews || reviews.length === 0) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'No pending review found. Please purchase an Expert Review first.' }) };
    }

    const review = reviews[0];

    // Parse the file from base64
    const { filename, filedata, contentType } = JSON.parse(event.body);
    const fileBuffer = Buffer.from(filedata, 'base64');
    const filePath = `${user.id}/${Date.now()}_${filename}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await sb.storage
      .from('review-documents')
      .upload(filePath, fileBuffer, {
        contentType: contentType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: false
      });

    if (uploadError) throw uploadError;

    // Get signed URL (valid for 7 days)
    const { data: signedData } = await sb.storage
      .from('review-documents')
      .createSignedUrl(filePath, 60 * 60 * 24 * 7);

    const fileUrl = signedData?.signedUrl || filePath;

    // Update review record with file URL
    await sb
      .from('reviews')
      .update({ file_url: fileUrl, status: 'submitted' })
      .eq('id', review.id);

    // Send email notification to Victoria
    await sendUploadNotification(user.email, review.service, fileUrl).catch(e => console.error('Email error:', e));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: 'Document uploaded successfully! Victoria will review it shortly.' })
    };

  } catch (err) {
    console.error('upload-document error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
