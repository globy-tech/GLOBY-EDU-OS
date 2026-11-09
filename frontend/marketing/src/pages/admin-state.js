const STORAGE_KEY = 'globyedu_admin_state_v1';
const SENSITIVE_FIELD_RE = /api[_-]?key|secret|token|password|credential|private/i;

const DEFAULT_STATE = {
  modules: {
    attendance: true,
    aiTutor: true,
    library: true,
    transport: true,
    canteen: true,
    finance: true,
    exams: true,
    messaging: true,
    reports: true,
    websiteCms: true,
    plugins: true,
    notifications: true,
    sms: true,
    email: true,
    parentPortal: true,
  },
  aiProviders: [
    {
      id: 'openai',
      name: 'OpenAI',
      enabled: true,
      apiKey: '',
      model: 'gpt-4o-mini',
      temperature: 0.7,
      maxTokens: 512,
      systemPrompt: 'You are a helpful educational assistant.',
      rolePrompts: 'Teacher: support instruction. Student: guide learning.',
      status: 'draft',
      connectionStatus: 'Not tested',
      latency: null,
      lastTestedAt: null,
    },
    {
      id: 'gemini',
      name: 'Gemini',
      enabled: false,
      apiKey: '',
      model: 'gemini-2.0-flash',
      temperature: 0.6,
      maxTokens: 512,
      systemPrompt: 'Provide concise educational guidance.',
      rolePrompts: 'Teacher: optimize lesson preparation. Student: explain concepts simply.',
      status: 'draft',
      connectionStatus: 'Not tested',
      latency: null,
      lastTestedAt: null,
    },
    {
      id: 'claude',
      name: 'Claude',
      enabled: false,
      apiKey: '',
      model: 'claude-3-5-sonnet-20241022',
      temperature: 0.7,
      maxTokens: 512,
      systemPrompt: 'You are Claude, an educational assistant.',
      rolePrompts: 'Teacher: create engaging lesson materials. Student: provide clear explanations.',
      status: 'draft',
      connectionStatus: 'Not tested',
      latency: null,
      lastTestedAt: null,
    },
    {
      id: 'deepseek',
      name: 'DeepSeek',
      enabled: false,
      apiKey: '',
      model: 'deepseek-chat',
      temperature: 0.7,
      maxTokens: 512,
      systemPrompt: 'You are a school operations assistant for admissions, attendance, finance, and communications.',
      rolePrompts: 'Teacher: generate teaching strategies. Student: simplify complex topics.',
      status: 'draft',
      connectionStatus: 'Not tested',
      latency: null,
      lastTestedAt: null,
    },
    {
      id: 'ollama',
      name: 'Ollama (Local)',
      enabled: false,
      apiKey: 'local',
      model: 'llama2',
      baseUrl: 'http://localhost:11434',
      temperature: 0.7,
      maxTokens: 512,
      systemPrompt: 'You are Ollama, a local educational assistant.',
      rolePrompts: 'Teacher: offline lesson support. Student: local learning aid.',
      status: 'draft',
      connectionStatus: 'Not tested',
      latency: null,
      lastTestedAt: null,
    },
  ],
  aiTestLab: {
    selectedProvider: 'openai',
    testPrompt: 'How can I improve student engagement in remote classrooms?',
    testResponse: '',
    isLoading: false,
    connectionStatus: 'idle',
  },
  payments: [
    {
      id: 'paystack',
      name: 'Paystack',
      enabled: true,
      mode: 'sandbox',
      environment: 'sandbox',
      currency: 'NGN',
      publicKey: 'pk_test_xxxxxxxxxxxxxxxxxxxxx',
      encryptedSecretKey: '',
      encryptedWebhookSecret: '',
      merchantEmail: 'pay@globyedu.com',
      callbackUrl: 'https://example.com/paystack/callback',
      webhookUrl: 'https://example.com/paystack/webhook',
      defaultGateway: true,
      configurationStatus: 'Configuration required',
      status: 'Disconnected',
      lastTestedAt: null,
      displayOrder: 1,
    },
    {
      id: 'mtn-momo',
      name: 'MTN Mobile Money',
      enabled: false,
      mode: 'sandbox',
      environment: 'sandbox',
      currency: 'GHS',
      publicKey: '',
      encryptedSecretKey: '',
      encryptedWebhookSecret: '',
      merchantEmail: '',
      callbackUrl: '',
      webhookUrl: '',
      defaultGateway: false,
      configurationStatus: 'Configuration required',
      status: 'Disabled',
      lastTestedAt: null,
      displayOrder: 2,
    },
    {
      id: 'telecel-cash',
      name: 'Telecel Cash',
      enabled: false,
      mode: 'sandbox',
      environment: 'sandbox',
      currency: 'USD',
      publicKey: '',
      encryptedSecretKey: '',
      encryptedWebhookSecret: '',
      merchantEmail: '',
      callbackUrl: '',
      webhookUrl: '',
      defaultGateway: false,
      configurationStatus: 'Configuration required',
      status: 'Disabled',
      lastTestedAt: null,
      displayOrder: 3,
    },
    {
      id: 'airteltigo',
      name: 'AirtelTigo Money',
      enabled: false,
      mode: 'sandbox',
      environment: 'sandbox',
      currency: 'GHS',
      publicKey: '',
      encryptedSecretKey: '',
      encryptedWebhookSecret: '',
      merchantEmail: '',
      callbackUrl: '',
      webhookUrl: '',
      defaultGateway: false,
      configurationStatus: 'Configuration required',
      status: 'Disabled',
      lastTestedAt: null,
      displayOrder: 4,
    },
    {
      id: 'bank-transfer',
      name: 'Bank Transfer',
      enabled: false,
      mode: 'manual',
      environment: 'production',
      currency: 'USD',
      publicKey: '',
      encryptedSecretKey: '',
      encryptedWebhookSecret: '',
      merchantEmail: '',
      callbackUrl: '',
      webhookUrl: '',
      defaultGateway: false,
      configurationStatus: 'Configuration required',
      status: 'Disabled',
      lastTestedAt: null,
      displayOrder: 5,
    },
    {
      id: 'cash',
      name: 'Cash',
      enabled: true,
      mode: 'manual',
      environment: 'production',
      currency: 'USD',
      publicKey: '',
      encryptedSecretKey: '',
      encryptedWebhookSecret: '',
      merchantEmail: '',
      callbackUrl: '',
      webhookUrl: '',
      defaultGateway: false,
      configurationStatus: 'Configured',
      status: 'Connected',
      lastTestedAt: null,
      displayOrder: 6,
    },
    {
      id: 'manual',
      name: 'Manual Payment',
      enabled: false,
      mode: 'manual',
      environment: 'production',
      currency: 'USD',
      publicKey: '',
      encryptedSecretKey: '',
      encryptedWebhookSecret: '',
      merchantEmail: '',
      callbackUrl: '',
      webhookUrl: '',
      defaultGateway: false,
      configurationStatus: 'Configuration required',
      status: 'Disabled',
      lastTestedAt: null,
      displayOrder: 7,
    },
  ],
  pricingPlans: [],
  settings: {
    platformName: 'GlobyEdu OS',
    supportEmail: 'support@globyedu.com',
    defaultTimezone: 'UTC',
    defaultCurrency: 'USD',
    maintenanceMode: false,
    registrationEnabled: true,
    loginEnabled: true,
    schoolAccountsEnabled: true,
    defaultLanguage: 'English',
    supportUrl: 'https://support.globyedu.com',
  },
  cms: {
    companyName: 'GlobyEdu OS',
    logoUrl: '/src/assets/images/hero/hero-dashboard.svg',
    heroTitle: 'The premium operating system for modern schools.',
    heroSubtitle: 'Unify admissions, attendance, lesson planning, finance, messaging, and reporting in one elegant school operations experience built for growth.',
    contactEmail: 'hello@globyedu.com',
    contactPhone: '+233 53 749 7607',
    address: '',
    businessHours: 'Monday-Friday • 8am to 6pm',
    whatsApp: '+233 53 749 7607',
    googleMapsUrl: 'https://maps.google.com',
    themeColor: '#0ea5e9',
    socialLinks: 'LinkedIn, Twitter, Facebook, Instagram',
    footerText: '© 2026 GlobyEdu OS. All rights reserved.',
    metaTitle: 'GlobyEdu OS • Modern School Platform',
    metaDescription: 'Unified school operations, communications, and analytics for modern schools.',
    featureCards: [
      { title: 'Student Management', description: 'Profiles, attendance and outcomes in one place.' },
      { title: 'School Insights', description: 'Operational reporting for students and teachers.' },
    ],
    testimonials: [
      { quote: 'A modern control center for every school team.', author: 'Meridian School' },
      { quote: 'Operations finally feel calm and measurable.', author: 'Horizon Prep' },
    ],
    pricingItems: [
      { label: 'Starter', price: 'Free trial', description: 'Single school launch' },
      { label: 'Growth', price: '$199/mo', description: 'Scaling teams' },
    ],
    faqItems: [
      { question: 'Can we start small?', answer: 'Yes. Grow from one school to a full network without changing your workflows.' },
    ],
    heroImage: '/src/assets/images/hero/hero-dashboard.svg',
    dashboardPreviewImage: '/src/assets/images/dashboard/dashboard-preview.png',
  },
  messages: [],
  announcements: [],
  supportTickets: [],
  schools: [],
  notifications: [],
  plugins: [
    { id: 'school-assistant', name: 'School Assistant', enabled: true, description: 'Operational support for admissions and school workflows.' },
    { id: 'payments', name: 'Payments', enabled: true, description: 'Billing and gateway orchestration.' },
    { id: 'messaging', name: 'Messaging', enabled: true, description: 'Parent and staff communications.' },
  ],
  auditLogs: [
    { id: 'seed-1', timestamp: new Date().toISOString(), action: 'Platform initialized', details: 'Super Admin dashboard prepared.' },
  ],
  sessions: [],
};

const notificationService = {
  create(notification = {}) {
    const normalized = {
      id: notification.id || `notification-${Date.now()}`,
      title: notification.title || 'Platform update',
      message: notification.message || '',
      type: notification.type || 'system',
      read: Boolean(notification.read),
      createdAt: notification.createdAt || new Date().toISOString(),
      sender: notification.sender || 'System',
      targetSchoolIds: Array.isArray(notification.targetSchoolIds) ? notification.targetSchoolIds : [],
      priority: notification.priority || 'normal',
      status: notification.status || 'active',
    };
    return normalized;
  },
  async queue(record = {}) {
    const state = getAdminState();
    const next = [this.create(record), ...(state.notifications || [])].slice(0, 100);
    state.notifications = next;
    saveAdminState(state);
    return next[0];
  },
};

function mergeStateArray(defaultArray, persistedArray, idKey = 'id') {
  if (!Array.isArray(persistedArray)) return defaultArray;
  const merged = new Map(defaultArray.map((item) => [item[idKey], { ...item }]));
  persistedArray.forEach((item) => {
    const key = item[idKey];
    if (merged.has(key)) {
      merged.set(key, { ...merged.get(key), ...item });
    } else {
      merged.set(key, { ...item });
    }
  });
  return Array.from(merged.values());
}

function getAdminState() {
  if (typeof localStorage === 'undefined') {
    return { ...DEFAULT_STATE };
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(stored);
    return {
      ...DEFAULT_STATE,
      ...parsed,
      modules: { ...DEFAULT_STATE.modules, ...(parsed.modules || {}) },
      settings: { ...DEFAULT_STATE.settings, ...(parsed.settings || {}) },
      cms: { ...DEFAULT_STATE.cms, ...(parsed.cms || {}) },
      aiProviders: mergeStateArray(DEFAULT_STATE.aiProviders, parsed.aiProviders),
      payments: mergeStateArray(DEFAULT_STATE.payments, parsed.payments),
      plugins: mergeStateArray(DEFAULT_STATE.plugins, parsed.plugins),
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      announcements: Array.isArray(parsed.announcements) ? parsed.announcements : [],
      supportTickets: Array.isArray(parsed.supportTickets) ? parsed.supportTickets : [],
      schools: Array.isArray(parsed.schools) ? parsed.schools : [],
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
      auditLogs: Array.isArray(parsed.auditLogs) ? parsed.auditLogs : DEFAULT_STATE.auditLogs,
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      aiTestLab: { ...DEFAULT_STATE.aiTestLab, ...(parsed.aiTestLab || {}) },
    };
  } catch (error) {
    return { ...DEFAULT_STATE };
  }
}

function saveAdminState(state) {
  if (typeof localStorage === 'undefined') return state;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  return state;
}

function maskAuditValue(value) {
  // sensitive values must be masked before they are persisted in audit records.
  if (value === null || value === undefined || value === '') return '';
  const text = String(value);
  if (text.length <= 4) return '*'.repeat(Math.max(4, text.length));
  return `${text.slice(0, 2)}${'*'.repeat(Math.max(6, text.length - 4))}${text.slice(-2)}`;
}

function appendAuditLog(action, details = '', metadata = {}) {
  const state = getAdminState();
  const actor = localStorage.getItem('globyedu_userFullName') || 'System';
  const actorRole = localStorage.getItem('globyedu_userRole') || (localStorage.getItem('globyedu_platformAdmin') === 'true' ? 'super_admin' : 'system');
  const filtered = typeof metadata === 'object' && metadata !== null ? metadata : {};
  const sanitizedMetadata = Object.fromEntries(Object.entries(filtered).map(([key, value]) => {
    if (typeof value === 'string' && SENSITIVE_FIELD_RE.test(key)) {
      return [key, maskAuditValue(value)];
    }
    if (typeof value === 'object' && value !== null) {
      return [key, JSON.parse(JSON.stringify(value, (_, nestedValue) => {
        if (typeof nestedValue === 'string' && SENSITIVE_FIELD_RE.test(key)) {
          return maskAuditValue(nestedValue);
        }
        return nestedValue;
      }))];
    }
    return [key, value];
  }));
  const entry = {
    id: `log-${Date.now()}`,
    timestamp: new Date().toISOString(),
    action,
    actor,
    actorRole,
    target: sanitizedMetadata.target || sanitizedMetadata.schoolId || 'platform',
    resultStatus: sanitizedMetadata.resultStatus || 'success',
    details: String(details || '').replace(/(api[_-]?key|secret|token|password|credential|private)/gi, '***'),
    metadata: {
      actor,
      actorRole,
      resultStatus: sanitizedMetadata.resultStatus || 'success',
      target: sanitizedMetadata.target || sanitizedMetadata.schoolId || 'platform',
      ...sanitizedMetadata,
    },
  };
  state.auditLogs = [entry, ...(state.auditLogs || [])].slice(0, 50);
  saveAdminState(state);
  return entry;
}

function setSessionActivity(session) {
  const state = getAdminState();
  const next = [session, ...(state.sessions || [])].slice(0, 10);
  state.sessions = next;
  saveAdminState(state);
  return next;
}

function clearSessionActivity(sessionId) {
  const state = getAdminState();
  state.sessions = (state.sessions || []).filter((entry) => entry.id !== sessionId);
  saveAdminState(state);
  return state.sessions;
}

function recordNotification(notification = {}) {
  const item = notificationService.create(notification);
  const state = getAdminState();
  state.notifications = [item, ...(state.notifications || [])].slice(0, 100);
  saveAdminState(state);
  return item;
}

function bufToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuf(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function deriveCryptoKey() {
  try {
    if (!window.crypto || !window.crypto.subtle) return null;
    const encoder = new TextEncoder();
    const passphrase = encoder.encode('GlobyEduSecureKey2026!');
    const baseKey = await window.crypto.subtle.importKey('raw', passphrase, 'PBKDF2', false, ['deriveKey']);
    return window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: encoder.encode('GlobyEduSecureSalt'),
        iterations: 120000,
        hash: 'SHA-256',
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  } catch {
    return null;
  }
}

async function encryptSecret(value) {
  if (!value) return '';
  try {
    const key = await deriveCryptoKey();
    if (!key) return `base64:${btoa(value)}`;
    const encoder = new TextEncoder();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const cipherBuffer = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(value));
    return `${bufToBase64(iv)}:${bufToBase64(cipherBuffer)}`;
  } catch {
    return `base64:${btoa(value)}`;
  }
}

async function decryptSecret(value) {
  if (!value) return '';
  try {
    if (value.startsWith('base64:')) {
      return atob(value.slice(7));
    }
    const key = await deriveCryptoKey();
    if (!key) return '';
    const [ivEncoded, cipherEncoded] = value.split(':');
    if (!ivEncoded || !cipherEncoded) return '';
    const iv = new Uint8Array(base64ToBuf(ivEncoded));
    const cipherBuffer = base64ToBuf(cipherEncoded);
    const plainBuffer = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipherBuffer);
    return new TextDecoder().decode(plainBuffer);
  } catch {
    return '';
  }
}

export {
  DEFAULT_STATE,
  getAdminState,
  saveAdminState,
  appendAuditLog,
  setSessionActivity,
  clearSessionActivity,
  recordNotification,
  maskAuditValue,
  notificationService,
  encryptSecret,
  decryptSecret,
};
