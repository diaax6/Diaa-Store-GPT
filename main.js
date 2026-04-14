/* =============================================
   DIAA STORE GPT — MAIN APPLICATION LOGIC
   Smart API Layer + Session Validation
   ============================================= */

// ===== API Configuration =====
const DIRECT_API = 'https://ai-redeem.cc';
const PROXY_PREFIX = '/api/proxy?path=';  // Vercel serverless function

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
};

let workingMethod = null; // 'proxy', 'direct', 'cors-0', 'cors-1'

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

    if (data.task_id) {
      state.taskId = data.task_id;
      startPolling(state.codeType);
    } else if (data.success) {
      showSuccess(data);
    } else if (data.pending === false && data.success === false) {
      showFailed(data.message || 'Activation failed.');
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

        const isSuccess = data.success === true
          || data.status === 'done'
          || data.status === 'subscription_sent'
          || (data.message && data.message.toLowerCase().includes('success'));

        if (isSuccess) {
          setTimeout(() => showSuccess(data), 500);
        } else {
          setTimeout(() => showFailed(data.message || 'Activation failed.'), 500);
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

      try {
        const check = await apiPost('/cdk-activation/check', { code: state.codeValue });
        if (check.used === true) {
          elements.processingBarFill.style.width = '100%';
          showSuccess({
            success: true,
            message: 'Subscription activated successfully!',
            key: check.key,
            activation_type: 'new',
          });
        } else {
          showFailed('Activation timed out. Please check your ChatGPT account or try again.');
        }
      } catch {
        showFailed('Connection lost. Please check your ChatGPT account manually.');
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

  let details = '';
  if (data.key) {
    details += `<div><strong>Code:</strong> ${data.key.code || state.codeValue}</div>`;
    if (data.key.activated_email) details += `<div><strong>Email:</strong> ${data.key.activated_email}</div>`;
    if (data.key.status) details += `<div><strong>Status:</strong> ${data.key.status}</div>`;
    if (data.activation_type) details += `<div><strong>Type:</strong> ${data.activation_type === 'new' ? 'New Activation' : 'Renewal'}</div>`;
  } else {
    details += `<div><strong>Code:</strong> ${state.codeValue}</div>`;
    details += `<div><strong>Product:</strong> ${state.productName}</div>`;
  }
  elements.successDetails.innerHTML = details;
}

function showFailed(message) {
  elements.stateProcessing.classList.add('hidden');
  elements.stateSuccess.classList.add('hidden');
  elements.stateFailed.classList.remove('hidden');
  elements.failedMessage.textContent = message;
}

function resetAll() {
  if (state.pollInterval) clearInterval(state.pollInterval);
  state.codeType = null;
  state.codeValue = '';
  state.productName = '';
  state.cdkData = null;
  state.taskId = null;
  state.pollInterval = null;

  elements.codeInput.value = '';
  elements.sessionInput.value = '';
  elements.codeInput.classList.remove('error');
  clearErrors();

  elements.processingBarFill.style.width = '0%';
  elements.stateProcessing.classList.remove('hidden');
  elements.stateSuccess.classList.add('hidden');
  elements.stateFailed.classList.add('hidden');

  goToStep(1);
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
  elements.pasteSessionBtn.addEventListener('click', () => pasteFromClipboard(elements.sessionInput));
  elements.backToStep1.addEventListener('click', () => {
    goToStep(1);
    state.codeType = null;
    state.codeValue = '';
    state.productName = '';
    state.cdkData = null;
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
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  initScrollAnimations();
  initNavbarScroll();
  goToStep(1);
});
