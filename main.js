/* =============================================
   DIAA STORE GPT — MAIN APPLICATION LOGIC
   Smart API Layer + Session Validation
   ============================================= */

// ===== API Configuration =====
const DIRECT_API = 'https://ai-redeem.cc';
const PROXY_PREFIX = '/api';  // Vite proxy (local) / Vercel rewrite (production)

const CORS_PROXIES = [
  'https://corsproxy.io/?',
  'https://api.allorigins.win/raw?url=',
];

// ===== STATE =====
const state = {
  currentStep: 1,
  codeType: null,      // 'cdk' or 'redeem'
  codeValue: '',
  productName: '',
  cdkData: null,
  taskId: null,
  pollInterval: null,
  sessionEmail: null,  // Email extracted from session token
  sessionRaw: null,    // Raw session data for reference
};

let workingMethod = null; // 'proxy', 'direct', 'cors-0', 'cors-1'
let pendingTelegramMsgId = null; // Track pending activation message
let visitorIp = 'Unknown'; // Visitor IP address

// ===== TELEGRAM NOTIFICATION SYSTEM =====
async function sendTelegramNotification(eventType, data, action = 'send', messageId = null) {
  try {
    // Inject IP into data
    if (data) data.ip = data.ip || visitorIp;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout

    const res = await fetch('/api/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, eventType, data, messageId }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const result = await res.json();
    if (result.success) {
      console.log(`[Telegram] ✓ ${action}:${eventType || 'msg'} (id: ${result.message_id || messageId || '—'})`);
    } else {
      console.warn(`[Telegram] ✗ ${action}:${eventType}:`, result.error);
    }
    return result;
  } catch (err) {
    console.warn(`[Telegram] ✗ ${action}:${eventType} failed:`, err.message);
    return null;
  }
}

async function deleteTelegramMessage(msgId) {
  if (!msgId) return;
  return sendTelegramNotification(null, null, 'delete', msgId);
}

async function editTelegramMessage(msgId, eventType, data) {
  if (!msgId) return;
  return sendTelegramNotification(eventType, data, 'edit', msgId);
}

async function fetchVisitorIp() {
  try {
    const res = await fetch('https://api.ipify.org?format=json');
    const data = await res.json();
    visitorIp = data.ip || 'Unknown';
  } catch {
    visitorIp = 'Unknown';
  }
}

// ===== DOM ELEMENTS =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const elements = {
  step1: $('#step-1'),
  step2: $('#step-2'),
  step3: $('#step-3'),
  stepIndicators: [$('#step-indicator-1'), $('#step-indicator-2'), $('#step-indicator-3')],
  stepLines: [$('#step-line-1'), $('#step-line-2')],
  codeInput: $('#code-input'),
  checkCodeBtn: $('#check-code-btn'),
  pasteCodeBtn: $('#paste-code-btn'),
  codeError: $('#code-error'),
  sessionInput: $('#session-input'),
  activateBtn: $('#activate-btn'),
  pasteSessionBtn: $('#paste-session-btn'),
  backToStep1: $('#back-to-step1'),
  sessionError: $('#session-error'),
  codeInfoProduct: $('#code-info-product'),
  codeInfoStatus: $('#code-info-status'),
  accountInfoBadge: $('#account-info-badge'),
  accountInfoEmail: $('#account-info-email'),
  accountInfoPlan: $('#account-info-plan'),
  stateProcessing: $('#state-processing'),
  stateSuccess: $('#state-success'),
  stateFailed: $('#state-failed'),
  processingMessage: $('#processing-message'),
  processingBarFill: $('#processing-bar-fill'),
  successMessage: $('#success-message'),
  successDetails: $('#success-details'),
  failedMessage: $('#failed-message'),
  newActivationBtn: $('#new-activation-btn'),
  retryBtn: $('#retry-btn'),
};

// ===== SMART API LAYER =====
// Known API fields to validate real responses
const API_KNOWN_FIELDS = ['used', 'status', 'app_name', 'app_product_name', 'key', 'task_id', 'pending', 'success', 'activation_type', 'code'];

function isRealApiResponse(json) {
  if (!json || typeof json !== 'object') return false;
  if (API_KNOWN_FIELDS.some(f => f in json)) return true;
  if (Array.isArray(json)) return true;
  if (json.message && (json.message.includes('not found') || json.message.includes('failed') || json.message.includes('Unauthorized'))) return true;
  return false;
}

async function fetchFromUrl(url, options, isProxy = false) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  const res = await fetch(url, { ...options, signal: controller.signal });
  clearTimeout(timeout);

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }

  if (isProxy) {
    if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
    if (!json) throw new Error('Proxy returned non-JSON');
    if (!isRealApiResponse(json)) throw new Error(`Proxy error: ${json.message || text.substring(0, 100)}`);
    return json;
  }

  if (json && isRealApiResponse(json)) return json;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  if (!json) throw new Error('Non-JSON response');
  return json;
}

function buildAttempt(label, endpoint) {
  if (label === 'direct') return { label, url: `${DIRECT_API}${endpoint}`, isProxy: false };
  if (label === 'proxy') return { label, url: `${PROXY_PREFIX}${endpoint}`, isProxy: false };
  if (label.startsWith('cors-')) {
    const idx = parseInt(label.split('-')[1]);
    return { label, url: `${CORS_PROXIES[idx]}${encodeURIComponent(`${DIRECT_API}${endpoint}`)}`, isProxy: true };
  }
  return null;
}

async function apiRequest(method, endpoint, body = null) {
  const fetchOpts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body && method !== 'GET') {
    fetchOpts.body = JSON.stringify(body);
  }

  // If we already found a working method, try it first
  if (workingMethod) {
    const saved = buildAttempt(workingMethod, endpoint);
    if (saved) {
      try {
        return await fetchFromUrl(saved.url, fetchOpts, saved.isProxy);
      } catch (err) {
        console.warn(`[API] Cached method ${workingMethod} failed:`, err.message);
        workingMethod = null;
      }
    }
  }

  // Try all methods in order: proxy → direct → CORS proxies
  const attempts = [
    { label: 'proxy', url: `${PROXY_PREFIX}${endpoint}`, isProxy: false },
    { label: 'direct', url: `${DIRECT_API}${endpoint}`, isProxy: false },
  ];
  CORS_PROXIES.forEach((p, i) => {
    attempts.push({
      label: `cors-${i}`,
      url: `${p}${encodeURIComponent(`${DIRECT_API}${endpoint}`)}`,
      isProxy: true,
    });
  });

  let lastError = null;
  for (const attempt of attempts) {
    try {
      console.log(`[API] Trying ${attempt.label}...`);
      const data = await fetchFromUrl(attempt.url, fetchOpts, attempt.isProxy);
      workingMethod = attempt.label;
      console.log(`[API] ✓ ${attempt.label} worked!`);
      return data;
    } catch (err) {
      console.warn(`[API] ✗ ${attempt.label}:`, err.message);
      lastError = err;
    }
  }

  throw lastError || new Error('Unable to connect to the server.');
}

function apiPost(endpoint, body) {
  return apiRequest('POST', endpoint, body);
}

function apiGet(endpoint) {
  return apiRequest('GET', endpoint);
}

// ===== SESSION TOKEN VALIDATION =====
function validateSession(rawInput) {
  const input = rawInput.trim();

  if (isValidEmail(input)) {
    return { valid: true, sessionData: input };
  }

  try {
    const parsed = JSON.parse(input);

    if (parsed.account) {
      const { structure, planType } = parsed.account;

      if (structure === 'workspace') {
        return { valid: false, error: '⚠️ Workspace accounts are NOT supported. Please use a personal ChatGPT account session token.' };
      }
      if (planType === 'team') {
        return { valid: false, error: '⚠️ Team accounts are NOT supported. Please use a personal ChatGPT account session token.' };
      }
      if (structure && structure !== 'personal') {
        return { valid: false, error: `⚠️ Account type "${structure}" is not supported. Only personal accounts are allowed.` };
      }
    }

    return { valid: true, sessionData: input };
  } catch {
    return { valid: true, sessionData: input };
  }
}

function isValidEmail(str) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
}

// ===== STEP NAVIGATION =====
function goToStep(step) {
  state.currentStep = step;
  $$('.step-panel').forEach(p => p.classList.remove('active'));
  $(`#step-${step}`).classList.add('active');

  elements.stepIndicators.forEach((ind, i) => {
    const s = i + 1;
    ind.classList.remove('active', 'completed');
    if (s === step) ind.classList.add('active');
    else if (s < step) ind.classList.add('completed');
  });

  elements.stepLines.forEach((line, i) => {
    line.classList.toggle('active', i + 1 < step);
  });
}

// ===== ERROR DISPLAY =====
function showError(el, message) {
  el.textContent = message;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 8000);
}

function clearErrors() {
  $$('.error-message').forEach(e => e.classList.remove('visible'));
}

// ===== STEP 1: CHECK CODE =====
async function checkCode() {
  const code = elements.codeInput.value.trim();
  if (!code) {
    showError(elements.codeError, '⚠️ Please enter a code.');
    elements.codeInput.classList.add('error');
    return;
  }

  elements.codeInput.classList.remove('error');
  clearErrors();
  elements.checkCodeBtn.classList.add('loading');
  elements.checkCodeBtn.disabled = true;

  try {
    // Try CDK-Activation first
    const data = await apiPost('/cdk-activation/check', { code });

    if (data.message) {
      // Not found in CDK, try Redeem
      try {
        const redeemData = await apiPost('/redeem/check', { code });
        if (redeemData && !redeemData.message && redeemData.app_name) {
          state.codeType = 'redeem';
          state.codeValue = code;
          state.productName = redeemData.app_product_name || redeemData.app_name;
          state.cdkData = redeemData;

          if (redeemData.used) {
            showError(elements.codeError, '❌ This code has already been used.');
            return;
          }

          elements.codeInfoProduct.textContent = state.productName;
          elements.codeInfoStatus.textContent = 'Available ✓';
          goToStep(2);

          // 📨 Telegram: pending activation notification
          const tgRedeem = await sendTelegramNotification('pending', {
            code: code,
            product: state.productName,
            codeType: 'redeem',
          });
          if (tgRedeem?.message_id) pendingTelegramMsgId = tgRedeem.message_id;
          return;
        }
      } catch {}

      showError(elements.codeError, '❌ Code not found. Please check and try again.');
      return;
    }

    if (data.used) {
      const email = data.key?.activated_email || '';
      showError(elements.codeError, `❌ This code has already been used${email ? ` for ${email}` : ''}.`);
      return;
    }

    // Valid & unused CDK code
    state.codeType = 'cdk';
    state.codeValue = code;
    state.productName = data.app_product_name || data.app_name;
    state.cdkData = data;

    elements.codeInfoProduct.textContent = state.productName;
    elements.codeInfoStatus.textContent = 'Available ✓';
    goToStep(2);

    // 📨 Telegram: pending activation notification
    const tgCdk = await sendTelegramNotification('pending', {
      code: code,
      product: state.productName,
      codeType: 'cdk',
      plan: data.key?.plan || null,
      term: data.key?.term || null,
    });
    if (tgCdk?.message_id) pendingTelegramMsgId = tgCdk.message_id;

  } catch (err) {
    console.error('Check code error:', err);
    showError(elements.codeError, `⚠️ Connection error: ${err.message || 'Unable to reach server.'}`);
  } finally {
    elements.checkCodeBtn.classList.remove('loading');
    elements.checkCodeBtn.disabled = false;
  }
}

// ===== STEP 2: ACTIVATE =====
async function activate() {
  const rawSession = elements.sessionInput.value.trim();
  if (!rawSession) {
    showError(elements.sessionError, '⚠️ Please provide your session token or email.');
    return;
  }

  const validation = validateSession(rawSession);
  if (!validation.valid) {
    showError(elements.sessionError, validation.error);
    return;
  }

  clearErrors();
  elements.activateBtn.classList.add('loading');
  elements.activateBtn.disabled = true;

  // 🔑 Extract & store email from session input
  state.sessionEmail = extractEmail(validation.sessionData);
  state.sessionRaw = validation.sessionData;
  console.log('[Session] Extracted email:', state.sessionEmail);

  try {
    const endpoint = state.codeType === 'cdk'
      ? '/cdk-activation/outstock'
      : '/redeem/outstock';

    const data = await apiPost(endpoint, {
      cdk: state.codeValue,
      user: validation.sessionData,
    });

    if (data.message && !data.task_id && !data.success) {
      showError(elements.sessionError, `❌ ${data.message}`);
      return;
    }

    goToStep(3);
    showProcessing();

    // 📨 Telegram: edit pending → processing
    if (pendingTelegramMsgId) {
      editTelegramMessage(pendingTelegramMsgId, 'activation_processing', {
        code: state.codeValue,
        product: state.productName,
        codeType: state.codeType,
        session: state.sessionEmail,
        plan: state.cdkData?.key?.plan || state.cdkData?.plan || null,
        term: state.cdkData?.key?.term || state.cdkData?.term || null,
      });
    }

    if (data.task_id) {
      state.taskId = data.task_id;
      startPolling(state.codeType);
    } else if (data.success) {
      showSuccess(data);
    } else if (data.pending === false && data.success === false) {
      // ⚠️ Double-check: verify code status before declaring failure
      const reallyFailed = await verifyActivationFailed();
      if (reallyFailed) {
        showFailed(data.message || 'Activation failed.');
      } else {
        showSuccess({
          success: true,
          message: 'Subscription activated successfully!',
          key: data.key || { code: state.codeValue },
          activation_type: data.activation_type || 'new',
        });
      }
    } else {
      state.taskId = data.task_id || state.codeValue;
      startPolling(state.codeType);
    }

  } catch (err) {
    console.error('Activation error:', err);
    goToStep(3);
    showFailed(`Connection error: ${err.message || 'Please try again.'}`);
  } finally {
    elements.activateBtn.classList.remove('loading');
    elements.activateBtn.disabled = false;
  }
}

// ===== STEP 3: POLLING & RESULTS =====
function showProcessing() {
  elements.stateProcessing.classList.remove('hidden');
  elements.stateSuccess.classList.add('hidden');
  elements.stateFailed.classList.add('hidden');
  elements.processingMessage.textContent = 'Processing your request...';
  elements.processingBarFill.style.width = '15%';
}

function startPolling(type) {
  let progress = 15;
  let pollCount = 0;
  const MAX_POLLS = 40;

  state.pollInterval = setInterval(async () => {
    pollCount++;
    try {
      const endpoint = type === 'cdk'
        ? `/cdk-activation/tasks/${state.taskId}`
        : `/redeem/tasks/${state.taskId}`;

      const data = await apiGet(endpoint);
      console.log(`[POLL #${pollCount}]`, JSON.stringify(data));

      if (progress < 85) {
        progress += Math.random() * 12;
        elements.processingBarFill.style.width = `${Math.min(progress, 85)}%`;
      }

      if (data.message || data.status) {
        elements.processingMessage.textContent = getStatusMessage(data.status, data.message);
      }

      // Check if done
      const isDone = data.pending === false
        || data.status === 'done'
        || data.status === 'subscription_sent'
        || data.status === 'error'
        || data.status === 'failed';

      if (isDone) {
        clearInterval(state.pollInterval);
        state.pollInterval = null;
        elements.processingBarFill.style.width = '100%';

        // ✅ Improved success detection — handles redeem & CDK responses
        const isSuccess = data.success === true
          || data.status === 'done'
          || data.status === 'subscription_sent'
          || (data.message && data.message.toLowerCase().includes('success'))
          || (data.message && data.message.toLowerCase().includes('activated'));

        if (isSuccess) {
          setTimeout(() => showSuccess(data), 500);
        } else {
          // ⚠️ Double-check before declaring failure
          setTimeout(async () => {
            const reallyFailed = await verifyActivationFailed();
            if (reallyFailed) {
              showFailed(data.message || 'Activation failed.');
            } else {
              showSuccess({
                success: true,
                message: 'Subscription activated successfully!',
                key: data.key || { code: state.codeValue },
                activation_type: data.activation_type || 'new',
              });
            }
          }, 500);
        }
        return;
      }
    } catch (err) {
      console.warn(`[POLL #${pollCount}] Error:`, err.message);
      elements.processingMessage.textContent = 'Reconnecting...';
    }

    // Timeout check
    if (pollCount >= MAX_POLLS) {
      clearInterval(state.pollInterval);
      state.pollInterval = null;
      elements.processingMessage.textContent = 'Checking final status...';

      // ✅ Check both CDK and Redeem codes at timeout
      const reallyFailed = await verifyActivationFailed();
      if (!reallyFailed) {
        elements.processingBarFill.style.width = '100%';
        showSuccess({
          success: true,
          message: 'Subscription activated successfully!',
          key: { code: state.codeValue },
          activation_type: 'new',
        });
      } else {
        showFailed('Activation timed out. Please check your ChatGPT account or try again.');
      }
    }
  }, 3000);
}

function getStatusMessage(status, message) {
  const statusMap = {
    'started': '🔄 Starting activation...',
    'account_found': '👤 Account found, activating...',
    'processing': '⚡ Processing your subscription...',
    'subscription_sent': '✅ Subscription sent!',
    'error': '❌ ' + (message || 'Error occurred'),
  };
  return statusMap[status] || message || 'Processing...';
}

function showSuccess(data) {
  elements.stateProcessing.classList.add('hidden');
  elements.stateSuccess.classList.remove('hidden');
  elements.stateFailed.classList.add('hidden');

  elements.successMessage.textContent = data.message || 'Your ChatGPT subscription has been activated successfully.';

  // 🔑 Resolve the best email: API response → session extraction → fallback
  const resolvedEmail = data.key?.activated_email || state.sessionEmail || null;
  const displayEmail = resolvedEmail && resolvedEmail !== '—' ? resolvedEmail : null;

  const activationDate = new Date().toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });

  let details = '';
  details += `<div><strong>Code:</strong> ${data.key?.code || state.codeValue}</div>`;
  if (displayEmail) details += `<div><strong>Email:</strong> ${displayEmail}</div>`;
  details += `<div><strong>Product:</strong> ${state.productName}</div>`;
  const plan = data.key?.plan || state.cdkData?.key?.plan || state.cdkData?.plan || null;
  const term = data.key?.term || state.cdkData?.key?.term || state.cdkData?.term || null;
  if (plan) details += `<div><strong>Plan:</strong> ${formatPlanText(plan)}</div>`;
  if (term) details += `<div><strong>Duration:</strong> ${formatTermText(term)}</div>`;
  if (data.activation_type) details += `<div><strong>Type:</strong> ${data.activation_type === 'new' ? '🆕 New Activation' : '♻️ Renewal'}</div>`;
  details += `<div><strong>Date:</strong> ${activationDate}</div>`;

  elements.successDetails.innerHTML = details;

  // 📨 Telegram: delete pending → send success
  if (pendingTelegramMsgId) {
    deleteTelegramMessage(pendingTelegramMsgId);
    pendingTelegramMsgId = null;
  }
  sendTelegramNotification('activation_success', {
    code: data.key?.code || state.codeValue,
    product: state.productName,
    codeType: state.codeType,
    email: resolvedEmail || '—',
    plan: plan,
    term: term,
    activationType: data.activation_type || 'unknown',
  });

  // 💾 Save activation to database — with resolved email
  saveActivationToDB({
    code: data.key?.code || state.codeValue,
    product: state.productName,
    email: resolvedEmail || null,
    plan: plan,
    term: term,
    code_type: state.codeType,
    activation_type: data.activation_type || 'unknown',
    status: 'success',
    ip: visitorIp,
  });
}

function showFailed(message) {
  elements.stateProcessing.classList.add('hidden');
  elements.stateSuccess.classList.add('hidden');
  elements.stateFailed.classList.remove('hidden');
  elements.failedMessage.textContent = message;

  // 📨 Telegram: delete pending → send failure
  if (pendingTelegramMsgId) {
    deleteTelegramMessage(pendingTelegramMsgId);
    pendingTelegramMsgId = null;
  }
  sendTelegramNotification('activation_failed', {
    code: state.codeValue,
    product: state.productName,
    codeType: state.codeType,
    session: state.sessionEmail || '—',
    errorMessage: message,
    plan: state.cdkData?.key?.plan || state.cdkData?.plan || null,
    term: state.cdkData?.key?.term || state.cdkData?.term || null,
  });
}

// ===== VERIFY: Double-check activation status before declaring failure =====
async function verifyActivationFailed() {
  try {
    console.log('[Verify] Double-checking activation status...');
    // Check CDK first
    try {
      const cdkCheck = await apiPost('/cdk-activation/check', { code: state.codeValue });
      if (cdkCheck.used === true) {
        console.log('[Verify] ✓ Code is actually USED (CDK) — activation succeeded!');
        return false; // NOT failed
      }
    } catch {}
    // Check Redeem
    try {
      const redeemCheck = await apiPost('/redeem/check', { code: state.codeValue });
      if (redeemCheck.used === true) {
        console.log('[Verify] ✓ Code is actually USED (Redeem) — activation succeeded!');
        return false; // NOT failed
      }
    } catch {}
    console.log('[Verify] ✗ Code is still unused — activation really failed');
    return true; // Really failed
  } catch {
    console.warn('[Verify] Could not verify — assuming failed');
    return true;
  }
}

function resetAll() {
  if (state.pollInterval) clearInterval(state.pollInterval);
  // Clean up pending Telegram message
  if (pendingTelegramMsgId) {
    deleteTelegramMessage(pendingTelegramMsgId);
    pendingTelegramMsgId = null;
  }
  state.codeType = null;
  state.codeValue = '';
  state.productName = '';
  state.cdkData = null;
  state.taskId = null;
  state.pollInterval = null;
  state.sessionEmail = null;
  state.sessionRaw = null;

  elements.codeInput.value = '';
  elements.sessionInput.value = '';
  elements.codeInput.classList.remove('error');
  clearErrors();

  elements.processingBarFill.style.width = '0%';
  elements.stateProcessing.classList.remove('hidden');
  elements.stateSuccess.classList.add('hidden');
  elements.stateFailed.classList.add('hidden');

  goToStep(1);
  // Hide account info
  elements.accountInfoBadge.classList.add('hidden');
}

// ===== CLIPBOARD =====
async function pasteFromClipboard(target) {
  try {
    const text = await navigator.clipboard.readText();
    target.value = text;
    target.focus();
    target.style.borderColor = 'var(--color-success)';
    setTimeout(() => { target.style.borderColor = ''; }, 800);
  } catch {}
}

// ===== EVENT LISTENERS =====
function initEventListeners() {
  elements.checkCodeBtn.addEventListener('click', checkCode);
  elements.pasteCodeBtn.addEventListener('click', () => pasteFromClipboard(elements.codeInput));
  elements.codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') checkCode(); });
  elements.codeInput.addEventListener('input', () => elements.codeInput.classList.remove('error'));

  elements.activateBtn.addEventListener('click', activate);
  elements.pasteSessionBtn.addEventListener('click', async () => {
    await pasteFromClipboard(elements.sessionInput);
    // Auto-check account after paste
    setTimeout(() => checkSessionAccount(), 200);
  });
  // Also check account on manual input (debounced)
  let sessionCheckTimer = null;
  elements.sessionInput.addEventListener('input', () => {
    clearTimeout(sessionCheckTimer);
    sessionCheckTimer = setTimeout(() => checkSessionAccount(), 600);
  });
  elements.backToStep1.addEventListener('click', () => {
    // 📨 Telegram: delete pending message on back
    if (pendingTelegramMsgId) {
      deleteTelegramMessage(pendingTelegramMsgId);
      pendingTelegramMsgId = null;
    }
    goToStep(1);
    state.codeType = null;
    state.codeValue = '';
    state.productName = '';
    state.cdkData = null;
    // Hide account info badge on back
    elements.accountInfoBadge.classList.add('hidden');
  });

  elements.newActivationBtn.addEventListener('click', resetAll);
  elements.retryBtn.addEventListener('click', () => {
    if (state.pollInterval) clearInterval(state.pollInterval);
    elements.stateProcessing.classList.remove('hidden');
    elements.stateSuccess.classList.add('hidden');
    elements.stateFailed.classList.add('hidden');
    goToStep(2);
  });
}

// ===== SESSION ACCOUNT CHECK =====
function checkSessionAccount() {
  const raw = elements.sessionInput.value.trim();
  if (!raw) {
    elements.accountInfoBadge.classList.add('hidden');
    return;
  }

  let email = null;
  let plan = null;

  // Check if it's a plain email
  if (isValidEmail(raw)) {
    email = raw;
  } else {
    // Try parsing JSON session
    try {
      const parsed = JSON.parse(raw);
      // Extract email
      email = parsed.user?.email || parsed.email || parsed.account?.email || null;
      if (!email) {
        const jsonStr = JSON.stringify(parsed);
        const emailMatch = jsonStr.match(/"email"\s*:\s*"([^"]+@[^"]+)"/i);
        if (emailMatch) email = emailMatch[1];
      }
      // Extract plan type from account info
      if (parsed.account) {
        const planType = parsed.account.planType || parsed.account.plan_type || null;
        const accountPlan = parsed.account.plan || null;
        plan = planType || accountPlan || null;
      }
      if (!plan && parsed.planType) plan = parsed.planType;
      if (!plan && parsed.plan) plan = parsed.plan;
    } catch {
      // Try regex extraction from raw string
      const rawEmailMatch = raw.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (rawEmailMatch) email = rawEmailMatch[0];
    }
  }

  if (email || plan) {
    elements.accountInfoEmail.textContent = email ? `📧 ${email}` : '—';
    elements.accountInfoPlan.textContent = plan ? `📊 ${formatPlanText(plan)}` : '—';
    elements.accountInfoBadge.classList.remove('hidden');
  } else {
    elements.accountInfoBadge.classList.add('hidden');
  }
}

// ===== SCROLL ANIMATIONS =====
function initScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, { threshold: 0.1 });

  $$('.how-card').forEach((card, i) => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(30px)';
    card.style.transition = `all 0.6s ease ${i * 0.15}s`;
    observer.observe(card);
  });
}

// ===== NAVBAR SCROLL =====
function initNavbarScroll() {
  const navbar = $('#navbar');
  let scrolled = false;
  window.addEventListener('scroll', () => {
    const isScrolled = window.scrollY > 50;
    if (isScrolled !== scrolled) {
      scrolled = isScrolled;
      navbar.style.background = isScrolled ? 'rgba(9,9,11,0.95)' : 'rgba(9,9,11,0.6)';
      navbar.style.borderBottomColor = isScrolled ? 'rgba(139,92,246,0.12)' : 'rgba(139,92,246,0.08)';
    }
  });
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
  initEventListeners();
  initScrollAnimations();
  initNavbarScroll();
  initCodeChecker();
  goToStep(1);

  // Fetch visitor IP (used in code activation notifications)
  await fetchVisitorIp();

  // Load recent activations
  loadRecentActivations();
});

// ===== HELPER: Extract email from session data =====
function extractEmail(sessionData) {
  if (!sessionData) return null;
  // If it's already an email
  if (isValidEmail(sessionData)) return sessionData;
  // Try parsing JSON to get email
  try {
    const parsed = JSON.parse(sessionData);
    // Check common session token structures
    if (parsed.user?.email) return parsed.user.email;
    if (parsed.email) return parsed.email;
    if (parsed.account?.email) return parsed.account.email;
    // Deep search for any email-looking field
    const jsonStr = JSON.stringify(parsed);
    const emailMatch = jsonStr.match(/"email"\s*:\s*"([^"]+@[^"]+)"/i);
    if (emailMatch) return emailMatch[1];
  } catch {}
  // Try regex extraction from raw string (catches unquoted emails)
  const rawEmailMatch = sessionData.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (rawEmailMatch) return rawEmailMatch[0];
  return null;
}

// ===== HELPER: Device info =====
function getDeviceInfo() {
  const ua = navigator.userAgent;
  if (/Mobile|Android|iPhone/i.test(ua)) return '📱 Mobile';
  if (/Tablet|iPad/i.test(ua)) return '📱 Tablet';
  return '🖥️ Desktop';
}

// ===== DATABASE: Save activation =====
async function saveActivationToDB(data) {
  try {
    console.log('[DB] Saving activation:', JSON.stringify(data).substring(0, 200));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const res = await fetch('/api/activations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const result = await res.json();
    if (result.success) {
      console.log('[DB] ✓ Activation saved:', result.data?.id || 'OK');
      // Refresh recent activations table
      loadRecentActivations();
    } else {
      console.warn('[DB] ✗ Save failed:', result.error, result.details || '');
    }
  } catch (err) {
    console.warn('[DB] ✗ Save error:', err.message);
  }
}

// ===== RECENT ACTIVATIONS =====
async function loadRecentActivations() {
  const loading = $('#recent-loading');
  const table = $('#recent-table');
  const tbody = $('#recent-table-body');
  const empty = $('#recent-empty');

  try {
    console.log('[Recent] Loading activations...');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const res = await fetch('/api/activations?limit=10', {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn('[Recent] API returned error:', res.status, res.statusText);
      throw new Error(`API error ${res.status}`);
    }

    const data = await res.json();
    console.log(`[Recent] Loaded ${Array.isArray(data) ? data.length : 0} activations`);

    loading.classList.add('hidden');

    if (!data || data.length === 0) {
      table.classList.remove('visible');
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');
    tbody.innerHTML = '';

    data.forEach(item => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${escapeHtml(item.product || '—')}</td>
        <td class="email-cell">${escapeHtml(item.email || '••••@••••')}</td>
        <td>${getPlanBadge(item.plan)}</td>
        <td>${getTypeBadge(item.activation_type)}</td>
        <td class="date-cell">${formatDate(item.created_at)}</td>
      `;
      tbody.appendChild(row);
    });

    table.classList.add('visible');
  } catch (err) {
    console.warn('[Recent] Load error:', err.message);
    loading.classList.add('hidden');
    empty.classList.remove('hidden');
  }
}

function getPlanBadge(plan) {
  if (!plan) return '<span class="plan-badge">—</span>';
  const p = plan.toLowerCase().replace('chatgpt_', '').replace('chatgpt ', '');
  const names = { plus: '⭐ Plus', pro: '💎 Pro', team: '👥 Team' };
  const cls = `plan-${p}`;
  return `<span class="plan-badge ${cls}">${names[p] || plan}</span>`;
}

function getTypeBadge(type) {
  if (!type || type === 'unknown') return '<span class="type-badge">—</span>';
  if (type === 'new') return '<span class="type-badge type-new">🆕 New</span>';
  return '<span class="type-badge type-renew">♻️ Renewal</span>';
}

function formatDate(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
  } catch {
    return '—';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ===== CODE CHECKER =====
function initCodeChecker() {
  const input = $('#checker-code-input');
  const btn = $('#checker-btn');
  const result = $('#checker-result');
  const header = $('#checker-result-header');
  const body = $('#checker-result-body');

  btn.addEventListener('click', () => checkCodeStatus(input, btn, result, header, body));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') checkCodeStatus(input, btn, result, header, body);
  });
}

async function checkCodeStatus(input, btn, result, header, body) {
  const code = input.value.trim();
  if (!code) {
    input.style.borderColor = 'var(--color-error)';
    setTimeout(() => { input.style.borderColor = ''; }, 2000);
    return;
  }

  btn.classList.add('loading');
  result.classList.add('hidden');

  try {
    // First check our local DB
    const dbRes = await fetch(`/api/activations?action=check&code=${encodeURIComponent(code)}`);
    const dbData = await dbRes.json();

    if (dbData.found) {
      // Found in our DB — show used status
      header.className = 'checker-result-header status-used';
      header.innerHTML = '⚠️ Code Already Used';
      body.innerHTML = `
        <div class="detail-row">📦 <span class="detail-label">Product:</span> <span class="detail-value">${escapeHtml(dbData.product || '—')}</span></div>
        <div class="detail-row">📧 <span class="detail-label">Email:</span> <span class="detail-value"><code>${escapeHtml(dbData.email || '—')}</code></span></div>
        <div class="detail-row">📊 <span class="detail-label">Plan:</span> <span class="detail-value">${escapeHtml(formatPlanText(dbData.plan))}</span></div>
        <div class="detail-row">⏳ <span class="detail-label">Duration:</span> <span class="detail-value">${escapeHtml(formatTermText(dbData.term))}</span></div>
        <div class="detail-row">📅 <span class="detail-label">Date:</span> <span class="detail-value">${formatDate(dbData.activated_at)}</span></div>
      `;
      body.style.display = 'block';
      result.classList.remove('hidden');
    } else {
      // Not in our DB, try the API
      try {
        const apiData = await apiPost('/cdk-activation/check', { code });
        if (apiData.used) {
          header.className = 'checker-result-header status-used';
          header.innerHTML = '⚠️ Code Already Used';
          body.innerHTML = `
            <div class="detail-row">📦 <span class="detail-label">Product:</span> <span class="detail-value">${escapeHtml(apiData.app_product_name || apiData.app_name || '—')}</span></div>
            <div class="detail-row">📧 <span class="detail-label">Email:</span> <span class="detail-value"><code>${escapeHtml(apiData.key?.activated_email || '—')}</code></span></div>
            <div class="detail-row">📊 <span class="detail-label">Plan:</span> <span class="detail-value">${escapeHtml(formatPlanText(apiData.key?.plan))}</span></div>
            <div class="detail-row">⏳ <span class="detail-label">Duration:</span> <span class="detail-value">${escapeHtml(formatTermText(apiData.key?.term))}</span></div>
            ${apiData.key?.activated_at ? `<div class="detail-row">📅 <span class="detail-label">Date:</span> <span class="detail-value">${new Date(apiData.key.activated_at * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span></div>` : ''}
          `;
          body.style.display = 'block';
        } else if (apiData.app_name) {
          header.className = 'checker-result-header status-available';
          header.innerHTML = '✅ Code Available';
          body.innerHTML = `
            <div class="detail-row">📦 <span class="detail-label">Product:</span> <span class="detail-value">${escapeHtml(apiData.app_product_name || apiData.app_name)}</span></div>
            <div class="detail-row">📌 <span class="detail-label">Status:</span> <span class="detail-value" style="color: var(--color-success)">🟢 Available for activation</span></div>
            ${apiData.key?.plan ? `<div class="detail-row">📊 <span class="detail-label">Plan:</span> <span class="detail-value">${escapeHtml(formatPlanText(apiData.key.plan))}</span></div>` : ''}
            ${apiData.key?.term ? `<div class="detail-row">⏳ <span class="detail-label">Duration:</span> <span class="detail-value">${escapeHtml(formatTermText(apiData.key.term))}</span></div>` : ''}
          `;
          body.style.display = 'block';
        } else {
          header.className = 'checker-result-header status-notfound';
          header.innerHTML = '❌ Code Not Found';
          body.innerHTML = '';
          body.style.display = 'none';
        }
      } catch {
        // Try redeem check
        try {
          const redeemData = await apiPost('/redeem/check', { code });
          if (redeemData && redeemData.app_name) {
            if (redeemData.used) {
              header.className = 'checker-result-header status-used';
              header.innerHTML = '⚠️ Code Already Used';
              body.innerHTML = `<div class="detail-row">📦 <span class="detail-label">Product:</span> <span class="detail-value">${escapeHtml(redeemData.app_product_name || redeemData.app_name)}</span></div>`;
              body.style.display = 'block';
            } else {
              header.className = 'checker-result-header status-available';
              header.innerHTML = '✅ Code Available';
              body.innerHTML = `<div class="detail-row">📦 <span class="detail-label">Product:</span> <span class="detail-value">${escapeHtml(redeemData.app_product_name || redeemData.app_name)}</span></div>`;
              body.style.display = 'block';
            }
          } else {
            header.className = 'checker-result-header status-notfound';
            header.innerHTML = '❌ Code Not Found';
            body.innerHTML = '';
            body.style.display = 'none';
          }
        } catch {
          header.className = 'checker-result-header status-notfound';
          header.innerHTML = '❌ Code Not Found';
          body.innerHTML = '';
          body.style.display = 'none';
        }
      }
      result.classList.remove('hidden');
    }
  } catch (err) {
    header.className = 'checker-result-header status-notfound';
    header.innerHTML = '⚠️ Error checking code';
    body.innerHTML = '';
    body.style.display = 'none';
    result.classList.remove('hidden');
  } finally {
    btn.classList.remove('loading');
  }
}

function formatPlanText(plan) {
  if (!plan) return '—';
  const key = plan.toLowerCase().replace('chatgpt_', '').replace('chatgpt ', '');
  const m = { plus: '⭐ ChatGPT Plus', pro: '💎 ChatGPT Pro', team: '👥 ChatGPT Team' };
  return m[key] || plan;
}

function formatTermText(term) {
  if (!term) return '—';
  const m = {
    '1m': '1 Month', '30d': '30 Days (1 Month)',
    '2m': '2 Months', '60d': '60 Days (2 Months)',
    '3m': '3 Months', '90d': '90 Days (3 Months)',
    '6m': '6 Months', '180d': '180 Days (6 Months)',
    '1y': '1 Year', '365d': '365 Days (1 Year)',
  };
  return m[term.toLowerCase()] || term;
}
