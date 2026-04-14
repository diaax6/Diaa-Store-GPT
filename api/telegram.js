const TELEGRAM_BOT_TOKEN = '8705709972:AAEKWX7arDQTuaR9Xf6oGRj47RRBCdqFraU';
const TELEGRAM_CHAT_ID = '-5289548533';
const BASE_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { action = 'send', eventType, data, messageId } = req.body || {};

    // Capture IP from Vercel headers (robust fallback)
    const serverIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
                   || req.headers['x-real-ip']
                   || req.headers['x-vercel-forwarded-for']?.split(',')[0]?.trim()
                   || null;
    if (data && (!data.ip || data.ip === 'Unknown')) data.ip = serverIp || 'Unknown';

    // ── DELETE MESSAGE ──
    if (action === 'delete' && messageId) {
      try {
        const result = await tgApi('deleteMessage', {
          chat_id: TELEGRAM_CHAT_ID,
          message_id: messageId,
        });
        return res.status(200).json({ success: result.ok });
      } catch (e) {
        return res.status(200).json({ success: false, error: e.message });
      }
    }

    // ── EDIT MESSAGE ──
    if (action === 'edit' && messageId && eventType) {
      try {
        const message = buildMessage(eventType, data || {});
        const result = await tgApi('editMessageText', {
          chat_id: TELEGRAM_CHAT_ID,
          message_id: messageId,
          text: message,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        });
        return res.status(200).json({ success: result.ok, message_id: messageId });
      } catch (e) {
        // If edit fails (e.g. message deleted), send as new
        console.warn('Edit failed, sending as new:', e.message);
        const message = buildMessage(eventType, data || {});
        const result = await tgApi('sendMessage', {
          chat_id: TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        });
        return res.status(200).json({ success: result.ok, message_id: result.result?.message_id });
      }
    }

    // ── SEND NEW MESSAGE ──
    if (!eventType) return res.status(400).json({ error: 'eventType is required' });

    const message = buildMessage(eventType, data || {});
    const result = await tgApi('sendMessage', {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });

    if (!result.ok) {
      return res.status(500).json({ error: 'Telegram API error', details: result.description });
    }

    return res.status(200).json({ success: true, message_id: result.result?.message_id });
  } catch (error) {
    console.error('Telegram handler error:', error);
    return res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
}

async function tgApi(method, body) {
  const res = await fetch(`${BASE_URL}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ═══════════════════════════════════════════════════════
// MESSAGE BUILDER — Professional Telegram Notifications
// ═══════════════════════════════════════════════════════

function buildMessage(eventType, data) {
  const now = new Date();
  const timeStr = now.toLocaleString('en-GB', {
    timeZone: 'Africa/Cairo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: true,
  });

  const ip = data.ip || 'Unknown';
  const bar = '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬';
  const sep = '┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈';

  switch (eventType) {

    // ═══ 🌐 NEW VISITOR ═══
    case 'page_visit':
      return [
        `🌐 <b>NEW VISITOR</b>`,
        bar,
        ``,
        `🖥  <b>Page:</b>     ${esc(data.page || 'Home')}`,
        `📱  <b>Device:</b>   ${esc(data.device || '—')}`,
        `🌍  <b>IP:</b>       <code>${esc(ip)}</code>`,
        ``,
        sep,
        `🕐  ${timeStr}`,
        bar,
        `⚡ <b>Diaa Store</b> • Live Monitor`,
      ].join('\n');

    // ═══ ⏳ PENDING ACTIVATION ═══
    case 'pending':
      return [
        `⏳ <b>PENDING ACTIVATION</b>`,
        bar,
        ``,
        `📦  <b>Product:</b>   ${esc(data.product || '—')}`,
        `🔑  <b>Code:</b>      <code>${esc(data.code || '—')}</code>`,
        `📋  <b>Type:</b>      ${data.codeType === 'cdk' ? '🟣 CDK Activation' : '🔵 Redeem Code'}`,
        `📌  <b>Status:</b>    🟢 Code Available`,
        ``,
        sep,
        ``,
        `⏳  <i>Waiting for customer to provide</i>`,
        `       <i>session token and activate...</i>`,
        ``,
        sep,
        `🕐  ${timeStr}`,
        `🌍  <b>IP:</b>  <code>${esc(ip)}</code>`,
        bar,
        `⚡ <b>Diaa Store</b> • Live Monitor`,
      ].join('\n');

    // ═══ ⚡ PROCESSING ═══
    case 'activation_processing':
      return [
        `⚡ <b>PROCESSING ACTIVATION</b>`,
        bar,
        ``,
        `📦  <b>Product:</b>    ${esc(data.product || '—')}`,
        `🔑  <b>Code:</b>       <code>${esc(data.code || '—')}</code>`,
        `📋  <b>Type:</b>       ${data.codeType === 'cdk' ? '🟣 CDK Activation' : '🔵 Redeem Code'}`,
        ``,
        sep,
        ``,
        `📧  <b>Email:</b>      <code>${esc(data.session || '—')}</code>`,
        `📊  <b>Plan:</b>       ${esc(formatPlan(data.plan))}`,
        `⏳  <b>Duration:</b>   ${esc(formatTerm(data.term))}`,
        ``,
        sep,
        `🔄  <b>Status:</b>   🟡 <i>Processing...</i>`,
        `🕐  ${timeStr}`,
        `🌍  <b>IP:</b>  <code>${esc(ip)}</code>`,
        bar,
        `⚡ <b>Diaa Store</b> • Live Monitor`,
      ].join('\n');

    // ═══ ✅ ACTIVATION SUCCESSFUL ═══
    case 'activation_success':
      return [
        `✅ <b>ACTIVATION SUCCESSFUL</b>`,
        bar,
        ``,
        `📦  <b>Product:</b>        ${esc(data.product || '—')}`,
        `🔑  <b>Code:</b>           <code>${esc(data.code || '—')}</code>`,
        `📋  <b>Type:</b>           ${data.codeType === 'cdk' ? '🟣 CDK Activation' : '🔵 Redeem Code'}`,
        ``,
        sep,
        ``,
        `📧  <b>Email:</b>          <code>${esc(data.email || '—')}</code>`,
        `📊  <b>Plan:</b>           ${esc(formatPlan(data.plan))}`,
        `⏳  <b>Duration:</b>       ${esc(formatTerm(data.term))}`,
        `🔄  <b>Activation:</b>     ${data.activationType === 'new' ? '🆕 New Activation' : '♻️ Renewal'}`,
        ``,
        sep,
        `✅  <b>Status:</b>   🟢 <b>Successfully Activated</b>`,
        `🕐  ${timeStr}`,
        `🌍  <b>IP:</b>  <code>${esc(ip)}</code>`,
        bar,
        `⚡ <b>Diaa Store</b> • Live Monitor`,
      ].join('\n');

    // ═══ ❌ ACTIVATION FAILED ═══
    case 'activation_failed':
      return [
        `❌ <b>ACTIVATION FAILED</b>`,
        bar,
        ``,
        `📦  <b>Product:</b>   ${esc(data.product || '—')}`,
        `🔑  <b>Code:</b>      <code>${esc(data.code || '—')}</code>`,
        `📋  <b>Type:</b>      ${data.codeType === 'cdk' ? '🟣 CDK Activation' : '🔵 Redeem Code'}`,
        ``,
        sep,
        ``,
        `📧  <b>Email:</b>     <code>${esc(maskSensitive(data.session || '—'))}</code>`,
        `📊  <b>Plan:</b>      ${esc(formatPlan(data.plan))}`,
        `⏳  <b>Duration:</b>  ${esc(formatTerm(data.term))}`,
        `⚠️  <b>Error:</b>     ${esc(data.errorMessage || 'Unknown error')}`,
        ``,
        sep,
        `❌  <b>Status:</b>   🔴 <b>Failed</b>`,
        `🕐  ${timeStr}`,
        `🌍  <b>IP:</b>  <code>${esc(ip)}</code>`,
        bar,
        `⚡ <b>Diaa Store</b> • Live Monitor`,
      ].join('\n');

    // ═══ DEFAULT ═══
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
// HELPERS
// ═══════════════════════════════════

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
  const m = {
    'plus': '⭐ ChatGPT Plus',
    'pro': '💎 ChatGPT Pro',
    'team': '👥 ChatGPT Team',
  };
  return m[plan.toLowerCase()] || plan;
}

function formatTerm(term) {
  if (!term) return '—';
  const m = {
    '30d': '📅 30 Days (1 Month)',
    '60d': '📅 60 Days (2 Months)',
    '90d': '📅 90 Days (3 Months)',
    '180d': '📅 180 Days (6 Months)',
    '365d': '📅 365 Days (1 Year)',
  };
  return m[term.toLowerCase()] || term;
}
