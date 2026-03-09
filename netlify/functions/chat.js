exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const ANTHROPIC_API_KEY    = process.env.ANTHROPIC_API_KEY;
  const SUPABASE_URL         = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const MAX_TOKENS           = parseInt(process.env.MAX_TOKENS_PER_REPLY || '500');
  const MONTHLY_BUDGET_USD   = parseFloat(process.env.MONTHLY_BUDGET_USD || '50');
  const COST_IN_PER_1K       = 0.003;
  const COST_OUT_PER_1K      = 0.015;

  const SYSTEM_PROMPT = `You are Drua, an expert AI consultant specializing in FDA medical device regulatory affairs and quality systems. Your knowledge covers 510(k), PMA, De Novo, 21 CFR Part 803, UDI, ISO 13485, ISO 14971, EU MDR, ISO 13485, SaMD, and IDE. Always cite specific FDA guidance documents or CFR sections. Keep responses under 350 words. Do not hallucinate guidance documents. You are speaking to medical device professionals and startup founders.`;

  try {
    const token = (event.headers.authorization || '').replace('Bearer ', '').trim();

    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_SERVICE_KEY }
    });
    const userData = await userRes.json();
    if (!userData.id) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Not authenticated. Invalid session ID.' }) };

    const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userData.id}&select=credits,total_tokens_used,total_spent_cents`, {
      headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, apikey: SUPABASE_SERVICE_KEY }
    });
    const profiles = await profileRes.json();
    const profile = profiles[0];
    if (!profile) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Profile not found' }) };
    if (profile.credits <= 0) return { statusCode: 402, headers, body: JSON.stringify({ error: 'no_credits', message: 'No credits remaining' }) };

    const statsRes = await fetch(`${SUPABASE_URL}/rest/v1/global_stats?key=eq.total_cost_usd&select=value`, {
      headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, apikey: SUPABASE_SERVICE_KEY }
    });
    const stats = await statsRes.json();
    const totalCost = parseFloat(stats[0]?.value || 0);
    if (totalCost >= MONTHLY_BUDGET_USD) return { statusCode: 503, headers, body: JSON.stringify({ error: 'budget_exceeded' }) };

    const { question } = JSON.parse(event.body || '{}');
    if (!question?.trim()) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Question required' }) };

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: question.slice(0, 2000) }]
      })
    });
    const aiData = await aiRes.json();
    const answer = aiData.content[0].text;
    const tokIn  = aiData.usage.input_tokens;
    const tokOut = aiData.usage.output_tokens;
    const thisCost = (tokIn / 1000 * COST_IN_PER_1K) + (tokOut / 1000 * COST_OUT_PER_1K);

    // Deduct credit
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userData.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, apikey: SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ credits: profile.credits - 1, tokens_used: (profile.total_tokens_used || 0) + tokIn + tokOut, total_spent_cents: Math.ceil(thisCost * 10000) / 100 })
    });

    // Log usage
    await fetch(`${SUPABASE_URL}/rest/v1/usage_log`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, apikey: SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userData.id, question: question.slice(0, 500), tokens_in: tokIn, tokens_out: tokOut, cost_cents: Math.ceil(thisCost * 10000) / 100 })
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ answer, credits_remaining: profile.credits - 1 })
    };
  } catch (err) {
    console.error('Chat error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
