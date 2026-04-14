const SUPABASE_URL = 'https://smrzynvsfhoyojombmiq.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtcnp5bnZzZmhveW9qb21ibWlxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjE3NTI2MCwiZXhwIjoyMDkxNzUxMjYwfQ.z0mWZtkqVsCnW9tL5Epeuvmdonhz9wzqiAS3zMVdtiY';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtcnp5bnZzZmhveW9qb21ibWlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxNzUyNjAsImV4cCI6MjA5MTc1MTI2MH0.TbsUzkKj3yk0hrdWw7B81M7PoUI43h7VhUXi0URVhQw';

const REST_URL = `${SUPABASE_URL}/rest/v1/activations`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const headers = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    // ── GET: Fetch recent activations or check code ──
    if (req.method === 'GET') {
      const { action, code } = req.query;

      // Check specific code status
      if (action === 'check' && code) {
        const url = `${REST_URL}?code=eq.${encodeURIComponent(code)}&order=created_at.desc&limit=1`;
        const result = await fetch(url, { headers: { ...headers, 'Prefer': 'return=representation' } });
        const data = await result.json();

        if (data.length === 0) {
          return res.status(200).json({ found: false });
        }

        const record = data[0];
        return res.status(200).json({
          found: true,
          code: record.code,
          email: record.email,
          product: record.product,
          plan: record.plan,
          term: record.term,
          status: record.status,
          activation_type: record.activation_type,
          activated_at: record.created_at,
        });
      }

      // Get recent activations (default)
      const limit = req.query.limit || 10;
      const url = `${REST_URL}?status=eq.success&order=created_at.desc&limit=${limit}`;
      const result = await fetch(url, { headers });
      const data = await result.json();

      // Mask emails for public display
      const masked = (data || []).map(r => ({
        id: r.id,
        product: r.product,
        email: maskEmail(r.email),
        plan: r.plan,
        term: r.term,
        activation_type: r.activation_type,
        created_at: r.created_at,
      }));

      return res.status(200).json(masked);
    }

    // ── POST: Save new activation ──
    if (req.method === 'POST') {
      const { code, product, email, plan, term, code_type, activation_type, status, ip } = req.body;

      if (!code) return res.status(400).json({ error: 'code is required' });

      const insertData = {
        code: code || null,
        product: product || null,
        email: email || null,
        plan: plan || null,
        term: term || null,
        code_type: code_type || null,
        activation_type: activation_type || null,
        status: status || 'success',
        ip: ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || null,
      };

      const result = await fetch(REST_URL, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'return=representation' },
        body: JSON.stringify(insertData),
      });

      const data = await result.json();

      if (!result.ok) {
        return res.status(500).json({ error: 'Failed to save activation', details: data });
      }

      return res.status(201).json({ success: true, data: data[0] || data });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Activations handler error:', error);
    return res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
}

function maskEmail(email) {
  if (!email || email === '—') return '••••@••••';
  const parts = email.split('@');
  if (parts.length !== 2) return '••••@••••';
  const name = parts[0];
  const domain = parts[1];
  const visible = name.substring(0, Math.min(3, name.length));
  const masked = '•'.repeat(Math.max(name.length - 3, 3));
  return `${visible}${masked}@${domain}`;
}
