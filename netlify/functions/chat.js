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

  const SYSTEM_PROMPT = `You are Drua, an expert AI consultant specializing in FDA medical device regulatory affairs and quality systems. Your knowledge covers 510(k), PMA, De Novo, 21 CFR Part 820 QSR, MDR (21 CFR Part 803), UDI, ISO 13485, EU MDR (21 CFR Part 803), SaMD, and all related regulatory frameworks.

IMPORTANT INSTRUCTIONS:
1. After answering any regulatory question, always remind the user that they can generate a pre-filled template using the buttons below the chat.
2. Encourage users to fill out templates section by section WITH your help. For example: "Would you like me to help you fill out the Device Description section? Just tell me about your device and I will guide you."
3. When a user describes their device or regulatory situation, proactively ask questions to help them fill out the relevant template sections.
4. After helping with multiple sections, suggest: "You now have enough information to generate your template! Click the template button below, download it, and bring it back here to complete the remaining sections together."
5. When a template appears complete, recommend: "Your template is looking comprehensive. I recommend having Victoria at Drua Consulting review it before FDA submission — click the Expert Review Services below."
6. Always be specific, cite relevant FDA guidance documents, and use proper regulatory terminology.
7. Keep responses focused and actionable — users are paying per question so make every answer count.`;

  try {
    const token = (event.headers.authorization || '').replace('Bearer ', '').trim();
    const isGuest = !token;

    // ── GUEST MODE (first 3 free questions, no account needed) ──────────────
    if (isGuest) {
      const { question } = JSON.parse(event.body || '{}');
      if (!question?.trim()) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Question required' }) };

      // Check monthly budget
      const statsRes = await fetch(`${SUPABASE_URL}/rest/v1/global_stats?key=eq.total_cost_usd&select=value`, {
        headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, apikey: SUPABASE_SERVICE_KEY }
      });
      const stats = await statsRes.json();
      const totalCost = parseFloat(stats[0]?.value || 0);
      if (totalCost >= MONTHLY_BUDGET_USD) return { statusCode: 503, headers, body: JSON.stringify({ error: 'budget_exceeded' }) };

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

      return { statusCode: 200, headers, body: JSON.stringify({ answer, guest: true }) };
    }

    // ── AUTHENTICATED MODE ───────────────────────────────────────────────────
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_SERVICE_KEY }
    });
    const userData = await userRes.json();
    if (!userData.id) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid session' }) };

    const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userData.id}&select=credits,total_tokens_used,total_spent_cents`, {
      headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, apikey: SUPABASE_SERVICE_KEY }
    });
    const profiles = await profileRes.json();
    let profile = profiles[0];

    if (!profile) {
      await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, apikey: SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ id: userData.id, credits: 3, total_tokens_used: 0, total_spent_cents: 0 })
      });
      profile = { credits: 3, total_tokens_used: 0, total_spent_cents: 0 };
    }

    if (profile.credits <= 0) return { statusCode: 402, headers, body: JSON.stringify({ error: 'no_credits', message: 'No credits remaining.' }) };

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

    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userData.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, apikey: SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ credits: profile.credits - 1, total_tokens_used: (profile.total_tokens_used || 0) + tokIn + tokOut, total_spent_cents: Math.ceil(thisCost * 10000) })
    });

    await fetch(`${SUPABASE_URL}/rest/v1/usage_log`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, apikey: SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userData.id, question: question.slice(0, 500), tokens_in: tokIn, tokens_out: tokOut, cost_cents: Math.ceil(thisCost * 10000) })
    });

    return { statusCode: 200, headers, body: JSON.stringify({ answer, credits_remaining: profile.credits - 1 }) };
  } catch (err) {
    console.error('Chat error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
