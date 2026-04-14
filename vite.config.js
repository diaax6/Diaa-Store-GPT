import { defineConfig } from 'vite';

// Telegram config for local dev
const TELEGRAM_BOT_TOKEN = '8705709972:AAEKWX7arDQTuaR9Xf6oGRj47RRBCdqFraU';
const TELEGRAM_CHAT_ID = '-5289548533';
const BASE_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// ═══════════════════════════════════════════════════════
// MESSAGE FORMATTING (mirrors api/telegram.js)
// ═══════════════════════════════════════════════════════

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function maskSensitive(input) {
  if (!input || input === '—') return '—';
  const emailMatch = input.match(/^([^@]{1,3})([^@]*)@(.+)$/);
  if (emailMatch) {
    return `${emailMatch[1]}${'*'.repeat(Math.min(emailMatch[2].length, 6))}@${emailMatch[3]}`;
  }
  if (input.length > 30) return input.substring(0, 20) + '...***';
  return input;
}

function formatPlan(plan) {
  if (!plan) return '—';
  const m = { 'plus': '⭐ ChatGPT Plus', 'pro': '💎 ChatGPT Pro', 'team': '👥 ChatGPT Team' };
  return m[plan.toLowerCase()] || plan;
}

function formatTerm(term) {
  if (!term) return '—';
  const m = {
    '30d': '📅 30 Days (1 Month)', '60d': '📅 60 Days (2 Months)',
    '90d': '📅 90 Days (3 Months)', '180d': '📅 180 Days (6 Months)', '365d': '📅 365 Days (1 Year)',
  };
  return m[term.toLowerCase()] || term;
}

function buildMessage(eventType, data) {
  const now = new Date();
  const timeStr = now.toLocaleString('en-GB', {
    timeZone: 'Africa/Cairo', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  });

  const ip = data.ip || 'Unknown';
  const bar = '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬';
  const sep = '┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈';

  switch (eventType) {
    case 'page_visit':
      return [
        `🌐 <b>NEW VISITOR</b>`,
        bar, ``,
        `🖥  <b>Page:</b>     ${esc(data.page || 'Home')}`,
        `📱  <b>Device:</b>   ${esc(data.device || '—')}`,
        `🌍  <b>IP:</b>       <code>${esc(ip)}</code>`,
        ``, sep,
        `🕐  ${timeStr}`,
        bar,
        `⚡ <b>Diaa Store</b> • Live Monitor`,
      ].join('\n');

    case 'pending':
      return [
        `⏳ <b>PENDING ACTIVATION</b>`,
        bar, ``,
        `📦  <b>Product:</b>   ${esc(data.product || '—')}`,
        `🔑  <b>Code:</b>      <code>${esc(data.code || '—')}</code>`,
        `📋  <b>Type:</b>      ${data.codeType === 'cdk' ? '🟣 CDK Activation' : '🔵 Redeem Code'}`,
        `📌  <b>Status:</b>    🟢 Code Available`,
        ``, sep, ``,
        `⏳  <i>Waiting for customer to provide</i>`,
        `       <i>session token and activate...</i>`,
        ``, sep,
        `🕐  ${timeStr}`,
        `🌍  <b>IP:</b>  <code>${esc(ip)}</code>`,
        bar,
        `⚡ <b>Diaa Store</b> • Live Monitor`,
      ].join('\n');

    case 'activation_processing':
      return [
        `⚡ <b>PROCESSING ACTIVATION</b>`,
        bar, ``,
        `📦  <b>Product:</b>    ${esc(data.product || '—')}`,
        `🔑  <b>Code:</b>       <code>${esc(data.code || '—')}</code>`,
        `📋  <b>Type:</b>       ${data.codeType === 'cdk' ? '🟣 CDK Activation' : '🔵 Redeem Code'}`,
        ``, sep, ``,
        `📧  <b>Email:</b>      <code>${esc(data.session || '—')}</code>`,
        `📊  <b>Plan:</b>       ${esc(formatPlan(data.plan))}`,
        `⏳  <b>Duration:</b>   ${esc(formatTerm(data.term))}`,
        ``, sep,
        `🔄  <b>Status:</b>   🟡 <i>Processing...</i>`,
        `🕐  ${timeStr}`,
        `🌍  <b>IP:</b>  <code>${esc(ip)}</code>`,
        bar,
        `⚡ <b>Diaa Store</b> • Live Monitor`,
      ].join('\n');

    case 'activation_success':
      return [
        `✅ <b>ACTIVATION SUCCESSFUL</b>`,
        bar, ``,
        `📦  <b>Product:</b>        ${esc(data.product || '—')}`,
        `🔑  <b>Code:</b>           <code>${esc(data.code || '—')}</code>`,
        `📋  <b>Type:</b>           ${data.codeType === 'cdk' ? '🟣 CDK Activation' : '🔵 Redeem Code'}`,
        ``, sep, ``,
        `📧  <b>Email:</b>          <code>${esc(data.email || '—')}</code>`,
        `📊  <b>Plan:</b>           ${esc(formatPlan(data.plan))}`,
        `⏳  <b>Duration:</b>       ${esc(formatTerm(data.term))}`,
        `🔄  <b>Activation:</b>     ${data.activationType === 'new' ? '🆕 New Activation' : '♻️ Renewal'}`,
        ``, sep,
        `✅  <b>Status:</b>   🟢 <b>Successfully Activated</b>`,
        `🕐  ${timeStr}`,
        `🌍  <b>IP:</b>  <code>${esc(ip)}</code>`,
        bar,
        `⚡ <b>Diaa Store</b> • Live Monitor`,
      ].join('\n');

    case 'activation_failed':
      return [
        `❌ <b>ACTIVATION FAILED</b>`,
        bar, ``,
        `📦  <b>Product:</b>   ${esc(data.product || '—')}`,
        `🔑  <b>Code:</b>      <code>${esc(data.code || '—')}</code>`,
        `📋  <b>Type:</b>      ${data.codeType === 'cdk' ? '🟣 CDK Activation' : '🔵 Redeem Code'}`,
        ``, sep, ``,
        `📧  <b>Email:</b>     <code>${esc(maskSensitive(data.session || '—'))}</code>`,
        `⚠️  <b>Error:</b>     ${esc(data.errorMessage || 'Unknown error')}`,
        ``, sep,
        `❌  <b>Status:</b>   🔴 <b>Failed</b>`,
        `🕐  ${timeStr}`,
        `🌍  <b>IP:</b>  <code>${esc(ip)}</code>`,
        bar,
        `⚡ <b>Diaa Store</b> • Live Monitor`,
      ].join('\n');

    default:
      return [
        `📢 <b>NOTIFICATION</b>`,
        bar,
        `📝  <b>Event:</b>  ${esc(eventType)}`,
        `📄  <b>Data:</b>   ${esc(JSON.stringify(data || {}).substring(0, 300))}`,
        sep,
        `🕐  ${timeStr}`,
        bar,
        `⚡ <b>Diaa Store</b> • Live Monitor`,
      ].join('\n');
  }
}

// ═══════════════════════════════════
// TELEGRAM API HELPER
// ═══════════════════════════════════

async function tgApi(method, body) {
  const res = await fetch(`${BASE_URL}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ═══════════════════════════════════
// VITE DEV PLUGIN
// ═══════════════════════════════════

const SUPABASE_URL = 'https://smrzynvsfhoyojombmiq.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtcnp5bnZzZmhveW9qb21ibWlxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjE3NTI2MCwiZXhwIjoyMDkxNzUxMjYwfQ.z0mWZtkqVsCnW9tL5Epeuvmdonhz9wzqiAS3zMVdtiY';
const REST_URL = `${SUPABASE_URL}/rest/v1/activations`;

const sbHeaders = {
  'apikey': SUPABASE_SERVICE_KEY,
  'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

function maskEmailDev(email) {
  if (!email || email === '—') return '••••@••••';
  const parts = email.split('@');
  if (parts.length !== 2) return '••••@••••';
  const name = parts[0];
  const visible = name.substring(0, Math.min(3, name.length));
  const masked = '•'.repeat(Math.max(name.length - 3, 3));
  return `${visible}${masked}@${parts[1]}`;
}

function telegramDevPlugin() {
  return {
    name: 'telegram-dev-proxy',
    configureServer(server) {
      server.middlewares.use('/api/telegram', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
          res.statusCode = 200;
          res.end();
          return;
        }

        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          try {
            const { action = 'send', eventType, data, messageId } = JSON.parse(body);

            const serverIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
                           || req.socket?.remoteAddress
                           || null;
            if (data && !data.ip) data.ip = serverIp;

            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');

            if (action === 'delete' && messageId) {
              const result = await tgApi('deleteMessage', { chat_id: TELEGRAM_CHAT_ID, message_id: messageId });
              res.statusCode = 200;
              res.end(JSON.stringify({ success: result.ok }));
              return;
            }

            if (action === 'edit' && messageId && eventType) {
              const msg = buildMessage(eventType, data || {});
              const result = await tgApi('editMessageText', {
                chat_id: TELEGRAM_CHAT_ID, message_id: messageId,
                text: msg, parse_mode: 'HTML', disable_web_page_preview: true,
              });
              res.statusCode = 200;
              res.end(JSON.stringify({ success: result.ok, message_id: messageId }));
              return;
            }

            const msg = buildMessage(eventType, data || {});
            const result = await tgApi('sendMessage', {
              chat_id: TELEGRAM_CHAT_ID, text: msg,
              parse_mode: 'HTML', disable_web_page_preview: true,
            });
            res.statusCode = 200;
            res.end(JSON.stringify({ success: result.ok, message_id: result.result?.message_id }));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });
    },
  };
}

function activationsDevPlugin() {
  return {
    name: 'activations-dev-proxy',
    configureServer(server) {
      server.middlewares.use('/api/activations', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
          res.statusCode = 200;
          res.end();
          return;
        }

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');

        try {
          if (req.method === 'GET') {
            const url = new URL(req.url, 'http://localhost');
            const action = url.searchParams.get('action');
            const code = url.searchParams.get('code');

            if (action === 'check' && code) {
              const sbUrl = `${REST_URL}?code=eq.${encodeURIComponent(code)}&order=created_at.desc&limit=1`;
              const sbRes = await fetch(sbUrl, { headers: { ...sbHeaders, 'Prefer': 'return=representation' } });
              const data = await sbRes.json();
              if (data.length === 0) {
                res.statusCode = 200;
                res.end(JSON.stringify({ found: false }));
              } else {
                const r = data[0];
                res.statusCode = 200;
                res.end(JSON.stringify({
                  found: true, code: r.code, email: r.email, product: r.product,
                  plan: r.plan, term: r.term, status: r.status,
                  activation_type: r.activation_type, activated_at: r.created_at,
                }));
              }
              return;
            }

            const limit = url.searchParams.get('limit') || 10;
            const sbUrl = `${REST_URL}?status=eq.success&order=created_at.desc&limit=${limit}`;
            const sbRes = await fetch(sbUrl, { headers: sbHeaders });
            const data = await sbRes.json();
            const masked = (data || []).map(r => ({
              id: r.id, product: r.product, email: maskEmailDev(r.email),
              plan: r.plan, term: r.term, activation_type: r.activation_type, created_at: r.created_at,
            }));
            res.statusCode = 200;
            res.end(JSON.stringify(masked));
            return;
          }

          if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
              try {
                const reqData = JSON.parse(body);
                const sbRes = await fetch(REST_URL, {
                  method: 'POST',
                  headers: { ...sbHeaders, 'Prefer': 'return=representation' },
                  body: JSON.stringify({
                    code: reqData.code || null, product: reqData.product || null,
                    email: reqData.email || null, plan: reqData.plan || null,
                    term: reqData.term || null, code_type: reqData.code_type || null,
                    activation_type: reqData.activation_type || null,
                    status: reqData.status || 'success',
                    ip: reqData.ip || req.socket?.remoteAddress || null,
                  }),
                });
                const data = await sbRes.json();
                res.statusCode = 201;
                res.end(JSON.stringify({ success: true, data: data[0] || data }));
              } catch (err) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
              }
            });
            return;
          }

          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [activationsDevPlugin(), telegramDevPlugin()],
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api': {
        target: 'https://ai-redeem.cc',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        secure: true,
        headers: {
          'Origin': 'https://ai-redeem.cc',
          'Referer': 'https://ai-redeem.cc/',
          'X-Product-ID': 'chatgpt',
        },
      },
    },
  },
});
