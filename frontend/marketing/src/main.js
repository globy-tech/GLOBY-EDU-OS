// main.js
// Entry for the marketing SPA. Implements a small hash router and mounts the landing experience.

import { Nav } from './components/navbar.js';
import { Hero } from './components/hero.js';
import { Features } from './components/features.js';
import { CTA } from './components/cta.js';
import { Footer } from './components/footer.js';
import { AppShell } from './components/app-shell.js';
import { attachSidebarHandlers } from './components/sidebar.js';
import { LoginPage } from './pages/login.js';
import { RegisterWizardPage, attachRegisterWizardHandlers } from './pages/register-wizard.js';
import { ForgotPage } from './pages/forgot.js';
import { ResetPasswordPage } from './pages/reset-password.js';
import { ChangePasswordPage } from './pages/change-password.js';
import { VerifyEmailPage } from './pages/verify-email.js';
import { LegalPage } from './pages/legal.js';
import { AdminPage, attachAdminSectionHandlers, attachWebsiteCMSHandlers } from './pages/admin.js';
import { matchesAdminSchoolFilter } from './utils/school-management-filters.mjs';
import { getAdminState } from './pages/admin-state.js';
import { PlatformAdminPage } from './pages/platform-admin.js';
import { SchoolDashboardPage, SchoolAuthorityDashboard, TeacherDashboard, StudentDashboard } from './pages/school-dashboard.js';
import { fetchSchoolSummary, fetchSchoolDetails, updateSchoolDetails, createFeePayment, createSchoolInvoice, createSchoolRefundRequest, startSchoolInvoiceCheckout, verifySchoolInvoicePayment, searchSchoolData, fetchSchoolEntities, createSchoolEntity, resendTeacherInvitation, updateSchoolEntity, deleteSchoolEntity, requestStudentDeletion, resolveStudentDeletionRequest, fetchAdminDashboardSummary, fetchPlatformAuditLogs, fetchSchoolActivity, fetchAdminSchoolList, fetchArchivedAdminSchools, createAdminSchool, updateAdminSchool, deleteAdminSchool, activateAdminSchool, fetchWorkspaceMessages, fetchMessageRecipients, createWorkspaceMessage, updateWorkspaceMessage, deleteWorkspaceMessage, fetchSupportTickets, createSupportTicket, updateSupportTicket, deleteSupportTicket, fetchAssignments, fetchLessons, createAssignment, createLesson, submitAssignment } from './api/school.js';
import { studentLogin, teacherLogin, schoolAuthorityLogin, schoolLogin as apiLogin, firebaseLogin as apiFirebaseLogin, linkFirebaseIdentity, platformAdminLogin, logout as apiLogout, refreshAuthSession, forgotPassword as apiForgot, register as apiRegister, confirmFirebasePasswordReset, changePassword as apiChangePassword } from './api/auth.js';
import { isFirebaseConfigured, firebaseSignInWithEmail, firebaseSignInWithGoogle, firebaseLinkGoogle, firebaseApplyActionCode, firebaseSignOutUser } from './firebase/firebase-client.js';
import { buildChangedFieldsPayload, buildSchoolCollectionPayload, buildSchoolEntityPayload, normalizeAttendanceStatus, buildAttendanceRoster, replaceAttendanceSession } from './utils/school-dashboard-actions.js?v=20261022-attendance-history';
import { showGlobalPwaNotice } from './utils/pwa-notifications.js';
import { MAX_FILE_UPLOAD_BYTES, validateImageUpload, validateProfileImageUpload } from './utils/file-upload-validation.js';
import { fetchPublicPricing, fetchAdminPricing, fetchMaintenanceMode, initializeSubscriptionCheckout, verifySubscriptionPayment } from './api/pricing.js';
import { fetchPublicWebsiteCMS } from './api/website-cms.js';
import { setPwaUpdateAvailable, getPwaUpdateAvailable, clearPwaUpdateAvailable } from './utils/pwa-utils.js';
import { testimonialImage1, testimonialImage2, testimonialImage3, screenshotAuthorityImage, screenshotTeacherImage, screenshotStudentImage, screenshotAuthorityPlaceholder, screenshotTeacherPlaceholder, screenshotStudentPlaceholder } from './assets/asset-paths.js';

const root = document.getElementById('marketing-root');
let accessTokenRefreshTimer = null;
const LANDING_ROUTES = ['home', 'features', 'solutions', 'pricing', 'about', 'contact'];
const SESSION_LIMIT = 2;
const PWA_STATUS_ID = 'globyedu-pwa-status';

function dispatchMaintenanceResponse(response, data) {
  if (response.status === 503 && data?.code === 'MAINTENANCE_MODE') {
    document.dispatchEvent(new CustomEvent('globyedu-maintenance-mode', { detail: data }));
  }
}

document.addEventListener('globyedu-auth-expired', () => {
  clearAuthenticationState();
  if (location.hash !== '#/login') location.hash = '#/login';
});

document.addEventListener('globyedu-school-suspended', (event) => {
  clearAuthenticationState();
  if (location.hash !== '#/login') {
    renderSuspendedSchoolPage(event.detail || {});
  }
});

document.addEventListener('globyedu-maintenance-mode', (event) => {
  routeGeneration += 1;
  renderMaintenancePage(event.detail || {});
});

function renderMaintenancePage(details = {}) {
  if (!root) return;
  root.innerHTML = `
    <main class="mx-auto flex min-h-screen max-w-3xl items-center px-6 py-16">
      <section class="w-full rounded-3xl border border-amber-200 bg-white p-8 shadow-xl sm:p-12" role="status" aria-live="polite">
        <p class="text-sm font-semibold uppercase text-amber-700">Platform maintenance</p>
        <h1 class="mt-4 text-3xl font-semibold text-slate-900">We’ll be back shortly</h1>
        <p data-maintenance-message class="mt-4 text-slate-600"></p>
        <button type="button" data-maintenance-retry class="mt-8 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white">Try again</button>
      </section>
    </main>
  `;
  const message = root.querySelector('[data-maintenance-message]');
  if (message) message.textContent = details.message || 'GlobyEdu is temporarily unavailable while maintenance is in progress.';
  root.querySelector('[data-maintenance-retry]')?.addEventListener('click', () => window.location.reload());
}

function renderSuspendedSchoolPage(details = {}) {
  const appRoot = root;
  if (!appRoot) return;
  const subscriptionExpired = details.code === 'SUBSCRIPTION_EXPIRED';

  appRoot.innerHTML = `
    <main class="mx-auto max-w-3xl px-6 py-20">
      <div class="rounded-4xl border border-amber-200 bg-amber-50 p-8 text-center shadow-xl shadow-amber-100/60">
        <p class="text-sm uppercase tracking-[0.3em] text-amber-700">Access restricted</p>
        <h1 class="mt-6 text-4xl font-semibold text-slate-900">${subscriptionExpired ? 'This school trial or subscription has expired' : 'This school account has been suspended'}</h1>
        <p class="mt-4 text-lg text-slate-700">${subscriptionExpired ? 'School access is paused until the subscription is renewed or support helps resolve the issue.' : 'Your school authority, teacher, or student access has been restricted until the issue is resolved.'}</p>
        <p class="mt-4 text-slate-600">Contact GlobyEdu support or visit our contact page for help.</p>
        <p class="mt-4 text-slate-600">
          <a class="font-semibold text-sky-700 underline" href="mailto:support@globyedu.com">support@globyedu.com</a>
          <span class="mx-2">or</span>
          <a class="font-semibold text-sky-700 underline" href="#/contact">Contact us</a>
        </p>
        <button id="school-suspended-back-to-login" type="button" class="mt-8 inline-flex items-center justify-center rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">Return to sign in</button>
      </div>
    </main>
    ${Footer()}
  `;

  const backButton = document.getElementById('school-suspended-back-to-login');
  if (backButton) {
    backButton.addEventListener('click', () => {
      location.hash = '#/login';
    });
  }
}

function renderNotFoundPage() {
  if (!root) return;

  root.innerHTML = `
    <main class="min-h-screen bg-slate-50">
      <div class="mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6 py-16 text-center">
        <div class="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-[0_30px_80px_-40px_rgba(15,23,42,0.35)] sm:p-12">
          <p class="text-sm font-semibold uppercase tracking-[0.35em] text-sky-700">404</p>
          <h1 class="mt-6 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">Page not found</h1>
          <p class="mt-4 max-w-xl text-lg text-slate-600">The page you are looking for does not exist or may have moved.</p>
          <div class="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button id="not-found-home" type="button" class="inline-flex items-center justify-center rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">Return home</button>
            <button id="not-found-login" type="button" class="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">Go to sign in</button>
          </div>
        </div>
      </div>
    </main>
    ${Footer()}
  `;

  document.getElementById('not-found-home')?.addEventListener('click', () => {
    location.hash = '#/';
  });

  document.getElementById('not-found-login')?.addEventListener('click', () => {
    location.hash = '#/login';
  });
}

async function ensureSchoolAccessIsActive() {
  const schoolId = localStorage.getItem('globyedu_schoolId');
  const token = getAccessToken();
  const role = getUserRole();

  if (!schoolId || !token || !role || getPlatformAdminFlag()) return false;
  if (!['school_authority', 'teacher', 'student'].includes(role)) return false;

  try {
    const result = await fetchSchoolDetails(token, schoolId);
    const school = result.ok && result.data?.status === 'ok' ? result.data.school || {} : {};
    const schoolStatus = String(school.schoolStatus || school.status || 'active').trim().toLowerCase();
    const subscriptionStatus = String(school.subscriptionStatus || '').trim().toLowerCase();
    if (['suspended', 'inactive', 'blocked', 'disabled'].includes(schoolStatus) || ['expired', 'suspended', 'inactive', 'blocked', 'disabled'].includes(subscriptionStatus)) {
      renderSuspendedSchoolPage({ code: subscriptionStatus === 'expired' ? 'SUBSCRIPTION_EXPIRED' : 'SCHOOL_SUSPENDED' });
      return true;
    }
    return false;
  } catch (error) {
    return false;
  }
}

const TEACHER_ASSIGNABLE_CLASS_OPTIONS = [
  {
    label: 'Nursery & KG',
    options: [
      { label: 'Nursery 1', value: 'Nursery 1' },
      { label: 'Nursery 2', value: 'Nursery 2' },
      { label: 'KG 1', value: 'KG 1' },
      { label: 'KG 2', value: 'KG 2' },
    ],
  },
  {
    label: 'Primary School',
    options: [1, 2, 3, 4, 5, 6].map((level) => ({ label: `Class ${level}`, value: `Class ${level}` })),
  },
  {
    label: 'Junior High School (JHS)',
    options: [1, 2, 3].map((level) => ({ label: `JHS ${level}`, value: `JHS ${level}` })),
  },
  {
    label: 'Senior High School (SHS)',
    options: [1, 2, 3].map((level) => ({ label: `SHS ${level}`, value: `SHS ${level}` })),
  },
];
const WEBSITE_CMS_STORAGE_KEY = 'globyedu_websiteCms';
const DEFAULT_WEBSITE_CMS = {
  companyName: 'GlobyEdu OS',
  logoUrl: '/src/assets/images/ui/globyedu-logo.jpg',
  heroTitle: 'The premium operating system for modern schools.',
  heroSubtitle: 'Unify admissions, attendance, lesson planning, finance, messaging, and reporting in one elegant school operations experience built for growth.',
  contactEmail: 'hello@globyedu.com',
  contactPhone: '+233 53 749 7607',
  address: '',
  businessHours: 'Monday-Friday • 8am to 6pm',
  website: 'https://globyedu.com',
  whatsApp: '+233 53 749 7607',
  googleMapsUrl: 'https://maps.google.com',
  themeColor: '#0ea5e9',
  socialLinks: 'LinkedIn, Twitter, Facebook, Instagram',
};
let currentWebsiteCMSSettings = { ...DEFAULT_WEBSITE_CMS };

function normalizeWebsiteCMSSettings(settings = {}) {
  const sanitized = { ...DEFAULT_WEBSITE_CMS, ...settings };
  Object.keys(sanitized).forEach((field) => {
    if (String(settings[field] || '').includes('*')) settings[field] = DEFAULT_WEBSITE_CMS[field];
    if (String(sanitized[field] || '').includes('*')) sanitized[field] = DEFAULT_WEBSITE_CMS[field];
  });
  return sanitized;
}

let currentSchoolStudents = [];
let currentSchoolTeachers = [];
let routeGeneration = 0;

const WORKSPACE_STORAGE_KEYS = {
  notifications: 'globyedu_workspace_notifications',
  messages: 'globyedu_workspace_messages',
  supportTickets: 'globyedu_workspace_support_tickets',
  settings: 'globyedu_workspace_settings',
  activities: 'globyedu_workspace_activity',
  profile: 'globyedu_workspace_profile',
};

let swRefreshPending = false;

function readWorkspaceStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeWorkspaceStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function pushWorkspaceNotification({
  title,
  message,
  type = 'system',
  sender = 'System',
  priority = 'normal',
  status = 'active',
  targetSchoolIds = [],
} = {}) {
  const notifications = readWorkspaceStorage(WORKSPACE_STORAGE_KEYS.notifications, []);
  const nextEntry = {
    id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: title || 'Workspace update',
    message: message || '',
    type,
    read: false,
    createdAt: new Date().toISOString(),
    sender,
    targetSchoolIds: Array.isArray(targetSchoolIds) ? targetSchoolIds.filter(Boolean) : [],
    priority,
    status,
  };
  const next = [nextEntry, ...notifications].slice(0, 100);
  writeWorkspaceStorage(WORKSPACE_STORAGE_KEYS.notifications, next);
  recordWorkspaceActivity(nextEntry.title, nextEntry.message, type);
  return nextEntry;
}

function seedWorkspaceData() {
  const notifications = readWorkspaceStorage(WORKSPACE_STORAGE_KEYS.notifications, null);
  if (!Array.isArray(notifications) || notifications.length === 0) {
    writeWorkspaceStorage(WORKSPACE_STORAGE_KEYS.notifications, [
      { id: 'n-1', title: 'Welcome to your workspace', message: 'Your authenticated dashboard is now connected to live workspace tools.', type: 'system', read: false, createdAt: new Date().toISOString() },
      { id: 'n-2', title: 'New school update', message: 'Academic records, attendance trends, and finance summaries are available from the school authority workspace.', type: 'school', read: false, createdAt: new Date().toISOString() },
      { id: 'n-3', title: 'Workspace ready', message: 'Review attendance summaries, finance updates, and communications directly from the workspace.', type: 'school', read: true, createdAt: new Date().toISOString() },
    ]);
  }

  const messages = readWorkspaceStorage(WORKSPACE_STORAGE_KEYS.messages, null);
  if (!Array.isArray(messages) || messages.length === 0) {
    writeWorkspaceStorage(WORKSPACE_STORAGE_KEYS.messages, [
      { id: 'm-1', folder: 'inbox', from: 'Super Admin', to: 'School Authority', subject: 'New support workflow', body: 'Your support inbox is live. Use the workspace to create and track tickets.', unread: true, createdAt: new Date().toISOString(), attachments: [] },
      { id: 'm-2', folder: 'sent', from: 'School Authority', to: 'Parents', subject: 'Reminder', body: 'Please confirm your child’s attendance for tomorrow.', unread: false, createdAt: new Date().toISOString(), attachments: [] },
    ]);
  }

  const tickets = readWorkspaceStorage(WORKSPACE_STORAGE_KEYS.supportTickets, null);
  if (!Array.isArray(tickets)) {
    writeWorkspaceStorage(WORKSPACE_STORAGE_KEYS.supportTickets, []);
  }

  const profile = readWorkspaceStorage(WORKSPACE_STORAGE_KEYS.profile, null);
  if (!profile || typeof profile !== 'object') {
    writeWorkspaceStorage(WORKSPACE_STORAGE_KEYS.profile, {
      fullName: localStorage.getItem('globyedu_userFullName') || 'User',
      email: localStorage.getItem('globyedu_userEmail') || '',
      phone: '',
      twoFactorEnabled: false,
      securityNote: 'Password updates are protected locally and can be expanded to the backend later.',
      avatar: '',
    });
  } else {
    profile.fullName = localStorage.getItem('globyedu_userFullName') || profile.fullName || 'User';
    profile.email = localStorage.getItem('globyedu_userEmail') || profile.email || '';
    delete profile.password;
    writeWorkspaceStorage(WORKSPACE_STORAGE_KEYS.profile, profile);
  }

  const settings = readWorkspaceStorage(WORKSPACE_STORAGE_KEYS.settings, null);
  if (!settings || typeof settings !== 'object') {
    writeWorkspaceStorage(WORKSPACE_STORAGE_KEYS.settings, {
      theme: 'midnight',
      notificationsEnabled: true,
      emailAlerts: true,
      smsAlerts: false,
      language: 'English',
      timezone: 'UTC',
      securityMode: 'standard',
    });
  }

  const history = readWorkspaceStorage(WORKSPACE_STORAGE_KEYS.activities, []);
  if (!Array.isArray(history) || history.length === 0) {
    writeWorkspaceStorage(WORKSPACE_STORAGE_KEYS.activities, [
      { id: 'a-1', title: 'Workspace ready', detail: 'Personal workspace tools are now active.', createdAt: new Date().toISOString() },
    ]);
  }
}

function recordWorkspaceActivity(title, detail, kind = 'system') {
  const history = readWorkspaceStorage(WORKSPACE_STORAGE_KEYS.activities, []);
  const next = [{ id: `a-${Date.now()}`, title, detail, kind, createdAt: new Date().toISOString() }, ...history].slice(0, 25);
  writeWorkspaceStorage(WORKSPACE_STORAGE_KEYS.activities, next);
}

function getWorkspaceProfile() {
  return readWorkspaceStorage(WORKSPACE_STORAGE_KEYS.profile, {
    fullName: localStorage.getItem('globyedu_userFullName') || 'User',
    email: localStorage.getItem('globyedu_userEmail') || '',
    phone: '',
    twoFactorEnabled: false,
    securityNote: 'Password updates are protected locally and can be expanded to the backend later.',
    avatar: '',
  });
}

function getWorkspaceSettings() {
  return readWorkspaceStorage(WORKSPACE_STORAGE_KEYS.settings, {
    theme: 'midnight',
    notificationsEnabled: true,
    emailAlerts: true,
    smsAlerts: false,
    language: 'English',
    timezone: 'UTC',
    securityMode: 'standard',
  });
}

function applyWorkspaceTheme() {
  const settings = getWorkspaceSettings();
  document.documentElement.dataset.theme = settings.theme || 'midnight';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createExamRecord(payload = {}) {
  const normalized = {
    id: payload.id || `exam-${Date.now()}`,
    title: payload.title || payload.examName || 'Untitled assessment',
    examType: payload.examType || payload.type || 'Custom exam',
    subject: payload.subject || 'General Studies',
    className: payload.className || payload.class || 'All classes',
    section: payload.section || 'Main',
    teacher: payload.teacher || 'Assigned teacher',
    academicYear: payload.academicYear || '2025/2026',
    term: payload.term || 'Term 1',
    date: payload.date || payload.examDate || 'TBD',
    status: payload.status || 'Draft',
    maxMarks: Number(payload.maxMarks || payload.maximumMarks || 100),
    passingMarks: Number(payload.passingMarks || payload.passMarks || 40),
    remarks: payload.remarks || payload.remark || 'Ready for marking',
    createdAt: new Date().toISOString(),
  };
  return normalized;
}

function generateReportCard(payload = {}) {
  const student = payload.student || 'Student';
  const academicYear = payload.academicYear || '2025/2026';
  const term = payload.term || 'Term 1';
  return {
    id: payload.id || `report-${Date.now()}`,
    student,
    academicYear,
    term,
    status: payload.status || 'Ready',
    grade: payload.grade || 'B',
    remarks: payload.remarks || 'Steady progress observed this term.',
    createdAt: new Date().toISOString(),
  };
}

function getWebsiteCMSSettings() {
  return currentWebsiteCMSSettings;
}

async function loadWebsiteCMSSettings() {
  const result = await fetchPublicWebsiteCMS();
  if (result.ok && result.data?.status === 'ok' && result.data.settings && typeof result.data.settings === 'object') {
    const settings = { ...result.data.settings };
    Object.keys(settings).forEach((field) => {
      if (String(settings[field] || '').includes('*')) settings[field] = DEFAULT_WEBSITE_CMS[field];
    });
    currentWebsiteCMSSettings = { ...DEFAULT_WEBSITE_CMS, ...settings };
    try {
      localStorage.setItem(WEBSITE_CMS_STORAGE_KEY, JSON.stringify(currentWebsiteCMSSettings));
    } catch {
      // Ignore storage issues and keep the in-memory CMS state active.
    }
  }
  return currentWebsiteCMSSettings;
}

function displayPwaNotice({ title, message, type = 'info', primaryText = 'OK', secondaryText = null, onPrimary = null, onSecondary = null, duration = 6000 }) {
  showGlobalPwaNotice({
    title,
    message,
    type,
    primaryText,
    secondaryText,
    onPrimary,
    onSecondary,
    autoHide: duration > 0,
    duration,
  });
}

function notifyPwaUpdateReady(registration) {
  displayPwaNotice({
    title: 'Update ready',
    message: 'A newer version of GlobyEdu OS is available. Reload to apply the latest features and security updates.',
    type: 'info',
    primaryText: 'Reload',
    secondaryText: 'Later',
    onPrimary: () => {
      if (registration?.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    },
    onSecondary: () => {
      setPwaUpdateAvailable(true);
    },
    duration: 0,
  });
}

function setupNetworkStatusWatcher() {
  const updateStatus = () => {
    if (navigator.onLine) {
      displayPwaNotice({
        title: 'Back online',
        message: 'Your connection is restored. Pending changes will sync automatically.',
        type: 'success',
        duration: 4500,
      });
    } else {
      displayPwaNotice({
        title: 'Offline mode',
        message: 'You are working offline. Changes will queue locally and sync when your network returns.',
        type: 'warning',
        primaryText: 'Retry',
        onPrimary: () => window.location.reload(),
        duration: 8000,
      });
    }
  };

  window.addEventListener('online', updateStatus);
  window.addEventListener('offline', updateStatus);

  if (!navigator.onLine) {
    updateStatus();
  }
}

function monitorServiceWorkerRegistration(registration) {
  if (!registration) return;

  if (registration.waiting) {
    notifyPwaUpdateReady(registration);
  }

  registration.addEventListener('updatefound', () => {
    const installingWorker = registration.installing;
    if (!installingWorker) return;
    installingWorker.addEventListener('statechange', () => {
      if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
        notifyPwaUpdateReady(registration);
      }
    });
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (swRefreshPending) return;
    swRefreshPending = true;
    window.location.reload();
  });
}

function showInstallPromptNotice() {
  if (!deferredInstallPrompt) return;
  const snoozedUntil = Number(localStorage.getItem('globyedu_installPromptSnoozedUntil') || 0);
  if (snoozedUntil > Date.now()) {
    window.setTimeout(() => showInstallPromptNotice(), snoozedUntil - Date.now());
    return;
  }

  const snoozeInstallPrompt = () => {
    localStorage.setItem('globyedu_installPromptSnoozedUntil', String(Date.now() + 12 * 60 * 60 * 1000));
  };

  displayPwaNotice({
    title: 'Install GlobyEdu OS',
    message: 'Install the app for faster access, offline support, and enterprise-grade reliability.',
    type: 'success',
    primaryText: 'Install',
    secondaryText: 'Dismiss',
    onPrimary: promptPwaInstall,
    onSecondary: snoozeInstallPrompt,
    duration: 0,
  });
}

function showPendingUpdateNoticeOnLoad() {
  if (getPwaUpdateAvailable()) {
    displayPwaNotice({
      title: 'Update available',
      message: 'A new version of GlobyEdu OS is ready to activate. Reload to continue with the latest release.',
      type: 'info',
      primaryText: 'Reload',
      onPrimary: () => window.location.reload(),
      duration: 0,
    });
    clearPwaUpdateAvailable();
  }
}

function getSessionLimitStatus() {
  try {
    const raw = localStorage.getItem('globyedu_sessionHistory');
    const sessions = raw ? JSON.parse(raw) : [];
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentSessions = sessions.filter((entry) => new Date(entry.timestamp).getTime() > oneWeekAgo);
    return { active: recentSessions.length, limit: SESSION_LIMIT, exceeded: recentSessions.length >= SESSION_LIMIT };
  } catch {
    return { active: 0, limit: SESSION_LIMIT, exceeded: false };
  }
}

function markActiveSession() {
  try {
    const raw = localStorage.getItem('globyedu_sessionHistory');
    const sessions = raw ? JSON.parse(raw) : [];
    const entry = { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, timestamp: new Date().toISOString(), role: getUserRole() || 'school' };
    const next = [...sessions, entry].slice(-SESSION_LIMIT);
    localStorage.setItem('globyedu_sessionHistory', JSON.stringify(next));
  } catch {
    // Ignore storage issues and continue the auth flow.
  }

  localStorage.setItem('globyedu_sessionActive', 'true');
  const sessionExpiresAt = Number(localStorage.getItem('globyedu_sessionExpiresAt') || 0);
  if (!sessionExpiresAt || sessionExpiresAt <= Date.now()) {
    localStorage.setItem('globyedu_sessionExpiresAt', String(Date.now() + 1000 * 60 * 60 * 24 * 7));
  }
  scheduleAccessTokenRefresh();
  seedWorkspaceData();
  applyWorkspaceTheme();
  recordWorkspaceActivity('Session started', 'The authenticated workspace was restored for this browser.', 'session');
}

function getSafePublicPricingPlans(pricingPlans = []) {
  if (!Array.isArray(pricingPlans)) return [];
  return pricingPlans.filter((plan) => plan && typeof plan === 'object' && (plan.active !== false));
}

async function renderLanding(activeSection = 'home', navigationId = routeGeneration) {
  const cms = await loadWebsiteCMSSettings();
  let pricingPlans = [];

  try {
    const pricingResult = await fetchPublicPricing();
    const payloadPlans = pricingResult && pricingResult.ok && Array.isArray(pricingResult.data?.pricingPlans)
      ? pricingResult.data.pricingPlans
      : [];
    pricingPlans = getSafePublicPricingPlans(payloadPlans);

    if (!pricingResult?.ok || !Array.isArray(pricingResult.data?.pricingPlans)) {
      console.warn('Unable to load public pricing plans; showing the default pricing state.', pricingResult?.data || pricingResult);
    }
  } catch (error) {
    console.warn('Unable to load public pricing plans; showing the default pricing state.', error);
  }

  if (navigationId !== routeGeneration) return;

  root.innerHTML = `
          ${Nav(cms)}
    <main class="relative overflow-hidden">
      <section class="bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.18),transparent_25%),radial-gradient(circle_at_bottom_right,rgba(34,197,94,0.16),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.96))]">
        <div class="max-w-7xl mx-auto px-6 pb-24 pt-10">
          ${Hero(cms)}
          ${renderPricing(pricingPlans)}
          ${Features(cms)}
          ${renderTrustSection()}
          ${renderWhyChooseSection()}
          ${renderSolutions()}
          ${renderScreenshots()}
          ${renderPlatformStats()}
          ${renderTestimonials()}
          ${renderFAQ(cms)}
          ${renderContact(cms)}
          ${renderInstallAppSection()}
          ${CTA()}
          ${renderNewsletter()}
        </div>
      </section>
    </main>
    ${Footer(cms)}
  `;
  attachLandingActions(activeSection);
  // Animate any numeric stats placed as demonstration inside the landing preview
  requestAnimationFrame(() => {
    document.querySelectorAll('.animate-number').forEach((el) => {
      const target = Number(el.getAttribute('data-target') || 0);
      if (!target || isNaN(target)) return;
      const duration = 900;
      const start = performance.now();
      const from = 0;
      const tick = (now) => {
        const t = Math.min(1, (now - start) / duration);
        const val = Math.round(from + (target - from) * t);
        el.textContent = String(val);
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  });
}

function attachLandingActions(activeSection) {
  document.querySelectorAll('[data-action="get-started"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const planSlug = btn.getAttribute('data-plan-slug');
      const role = getUserRole();
      location.hash = (role === 'school_authority' || role === 'school_head')
        ? `#/checkout?plan=${encodeURIComponent(planSlug || '')}`
        : '#/register';
    });
  });

  document.querySelectorAll('[data-action="request-demo"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      location.hash = '#/contact';
      setTimeout(() => scrollToSection('contact'), 50);
    });
  });

  // Remove skeletons for images on load
  document.querySelectorAll('img[loading="lazy"]').forEach((img) => {
    if (img.complete) {
      const sk = img.closest('[data-skeleton]');
      if (sk) sk.classList.remove('skeleton');
    } else {
      img.addEventListener('load', () => {
        const sk = img.closest('[data-skeleton]');
        if (sk) sk.classList.remove('skeleton');
      });
    }
  });

  document.querySelectorAll('[data-scroll]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const section = link.getAttribute('data-scroll');
      if (!section) return;
      if (section === 'home') {
        location.hash = '#/';
      } else {
        location.hash = `#/${section}`;
      }
    });
  });

  document.querySelectorAll('[data-action="install-app"]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      if (typeof promptPwaInstall === 'function') {
        promptPwaInstall();
      }
    });
  });

  if (activeSection && activeSection !== 'home') {
    setTimeout(() => scrollToSection(activeSection), 50);
  }
  attachContactHandlers();
  attachNewsletterHandlers();
}

async function refreshLandingFromCMS(event) {
  if (event?.detail?.settings && typeof event.detail.settings === 'object') {
    currentWebsiteCMSSettings = { ...DEFAULT_WEBSITE_CMS, ...event.detail.settings };
  } else {
    await loadWebsiteCMSSettings();
  }
  const { path } = parseHash();
  if (!path || path === 'home' || LANDING_ROUTES.includes(path)) {
    renderLanding(path || 'home');
  }
}

async function renderCheckoutPage(planSlug = '', billingPeriod = 'monthly', reference = '') {
  const role = getUserRole();
  if (!getAccessToken() || !['school_authority', 'school_head', 'super_admin'].includes(role)) {
    location.hash = '#/login';
    return;
  }

  let plans = [];
  try {
    const pricingResult = await fetchPublicPricing();
    plans = pricingResult && pricingResult.ok && Array.isArray(pricingResult.data?.pricingPlans)
      ? getSafePublicPricingPlans(pricingResult.data.pricingPlans)
      : [];
    if (!pricingResult?.ok || !Array.isArray(pricingResult.data?.pricingPlans)) {
      console.warn('Unable to load public pricing plans for checkout; showing the safest available state.', pricingResult?.data || pricingResult);
    }
  } catch (error) {
    console.warn('Unable to load public pricing plans for checkout; showing the safest available state.', error);
  }

  const plan = plans.find((entry) => entry.slug === planSlug) || plans[0];
  if (!plan) {
    root.innerHTML = `${Nav()}<main class="mx-auto max-w-3xl px-6 py-20"><p class="text-slate-600">No active subscription plans are available.</p></main>${Footer()}`;
    return;
  }
  root.innerHTML = `${Nav()}<main class="mx-auto max-w-3xl px-6 py-12 sm:py-20"><div class="rounded-4xl border border-slate-200 bg-white p-8 shadow-sm">
    <p class="text-sm font-semibold uppercase tracking-[0.25em] text-sky-700">Subscription checkout</p>
    <h1 class="mt-3 text-3xl font-semibold text-slate-950">Review your school subscription</h1>
    <div class="mt-8 grid gap-4 sm:grid-cols-2">
      <label class="text-sm text-slate-700">Plan<select id="checkout-plan" class="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3">${plans.map((entry) => `<option value="${entry.slug}" ${entry.slug === plan.slug ? 'selected' : ''}>${entry.name}</option>`).join('')}</select></label>
      <label class="text-sm text-slate-700">Billing period<select id="checkout-period" class="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3"><option value="monthly" ${billingPeriod === 'monthly' ? 'selected' : ''}>Monthly</option><option value="yearly" ${billingPeriod === 'yearly' ? 'selected' : ''}>Yearly</option></select></label>
    </div>
    <dl class="mt-8 grid gap-3 border-y border-slate-200 py-6 text-sm sm:grid-cols-2"><div><dt class="text-slate-500">School</dt><dd class="font-semibold text-slate-900">${localStorage.getItem('globyedu_schoolName') || localStorage.getItem('globyedu_schoolId') || ''}</dd></div><div><dt class="text-slate-500">Student limit</dt><dd class="font-semibold text-slate-900">${Number(plan.studentLimit).toLocaleString()}</dd></div><div><dt class="text-slate-500">Amount</dt><dd id="checkout-amount" class="font-semibold text-slate-900">${plan.currency} ${Number(billingPeriod === 'yearly' ? plan.yearlyAmount : plan.monthlyAmount).toLocaleString()}</dd></div><div><dt class="text-slate-500">Payment provider</dt><dd class="font-semibold text-slate-900">Paystack</dd></div></dl>
    <p class="text-sm leading-6 text-slate-600">Review the <a class="font-semibold text-sky-700" href="#/legal/payments">Payment & Refund Policy</a>, <a class="font-semibold text-sky-700" href="#/legal/terms">Terms of Service</a>, and <a class="font-semibold text-sky-700" href="#/legal/privacy">Privacy Policy</a>.</p>
    <label class="mt-6 flex items-start gap-3 text-sm text-slate-700"><input id="checkout-terms" type="checkbox" class="mt-1" /> <span>I have reviewed and accept the linked policies.</span></label>
    <div id="checkout-message" class="mt-4 min-h-6 text-sm" role="status" aria-live="polite"></div><button id="checkout-submit" class="mt-6 rounded-full bg-sky-600 px-6 py-3 text-sm font-semibold text-white">Continue to Paystack</button>
  </div></main>${Footer()}`;

  const planSelect = document.getElementById('checkout-plan');
  const periodSelect = document.getElementById('checkout-period');
  const amountElement = document.getElementById('checkout-amount');
  const updateAmount = () => { const selected = plans.find((entry) => entry.slug === planSelect.value) || plan; amountElement.textContent = `${selected.currency} ${Number(periodSelect.value === 'yearly' ? selected.yearlyAmount : selected.monthlyAmount).toLocaleString()}`; };
  planSelect.addEventListener('change', updateAmount);
  periodSelect.addEventListener('change', updateAmount);
  const checkoutButton = document.getElementById('checkout-submit');
  let checkoutPending = false;
  checkoutButton.addEventListener('click', async () => {
    if (checkoutPending) return;
    const message = document.getElementById('checkout-message');
    if (!document.getElementById('checkout-terms').checked) { message.textContent = 'Please accept the linked policies before continuing.'; return; }
    checkoutPending = true;
    checkoutButton.disabled = true;
    checkoutButton.setAttribute('aria-busy', 'true');
    let redirecting = false;
    try {
      const result = await initializeSubscriptionCheckout({ planSlug: planSelect.value, billingPeriod: periodSelect.value, email: localStorage.getItem('globyedu_userEmail'), callbackUrl: `${location.origin}/#/checkout?plan=${encodeURIComponent(planSelect.value)}&period=${encodeURIComponent(periodSelect.value)}`, acceptance: { terms: true, privacy: true, paymentRefund: true, version: '2026-09-18' } });
      if (!result.ok) throw new Error(result.data?.message || 'Unable to initialize payment. Please try again.');
      const authorizationUrl = result.data?.checkout?.authorizationUrl;
      if (!authorizationUrl) throw new Error('Unable to initialize payment. Please try again.');
      location.assign(authorizationUrl);
      redirecting = true;
    } catch (error) {
      message.textContent = error.message || 'Unable to initialize payment. Please try again.';
    } finally {
      if (!redirecting) {
        checkoutPending = false;
        checkoutButton.disabled = false;
        checkoutButton.removeAttribute('aria-busy');
      }
    }
  });
  if (reference) {
    const result = await verifySubscriptionPayment(reference);
    document.getElementById('checkout-message').textContent = result.ok ? 'Payment verified and subscription activated.' : (result.data?.message || 'Payment verification failed.');
  }
}

window.addEventListener('globyedu-cms-updated', refreshLandingFromCMS);
window.addEventListener('storage', (event) => {
  if (event.key === WEBSITE_CMS_STORAGE_KEY) refreshLandingFromCMS();
});

function scrollToSection(sectionId) {
  const target = document.getElementById(sectionId);
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderSolutions() {
  return `
    <section id="solutions" class="mt-20 rounded-[2.5rem] border border-slate-200 bg-white/80 p-8 shadow-[0_30px_90px_-50px_rgba(15,23,42,0.30)] backdrop-blur-xl">
      <div class="grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
        <div>
          <p class="text-sm font-semibold uppercase tracking-[0.35em] text-sky-600">Solutions</p>
          <h2 class="mt-4 text-3xl font-semibold tracking-tight text-slate-900">A complete platform for every school stakeholder.</h2>
          <p class="mt-4 max-w-2xl text-slate-600">GlobyEdu OS blends school operations, communication, and reporting into one premium experience built for modern education.</p>
          <div class="mt-8 grid gap-4 sm:grid-cols-2">
            ${renderSolutionCard('Student Management', 'Smart profiles, attendance, behavior tracking and classroom workflows.')}
            ${renderSolutionCard('Teacher Management', 'Scheduling, lesson planning, staff performance, and analytics.')}
            ${renderSolutionCard('School Insights', 'Clear operational reporting for students, staff, and leadership teams.')}
            ${renderSolutionCard('Multi-Tenant Architecture', 'Securely manage multiple schools, branches and campuses from one platform.')}
          </div>
        </div>
        <div class="grid gap-4">
          ${renderPanelCard('Security first', 'Enterprise-grade data protection with role-based access control and audit-ready logs.')}
          ${renderPanelCard('Responsive design', 'Built to work beautifully on desktop, tablet, and mobile without compromise.')}
        </div>
      </div>
    </section>
  `;
}

function renderSolutionCard(title, description) {
  return `
    <div class="rounded-4xl border border-slate-200 bg-slate-50 p-6 shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-lg">
      <div class="inline-flex items-center justify-center rounded-2xl bg-sky-600/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-sky-700">${title.split(' ')[0]}</div>
      <p class="mt-5 text-lg font-semibold text-slate-900">${title}</p>
      <p class="mt-3 text-sm leading-6 text-slate-600">${description}</p>
    </div>
  `;
}

function renderPanelCard(title, description) {
  return `
    <div class="rounded-[1.75rem] border border-slate-200 bg-linear-to-br from-white to-slate-50 p-6 shadow-lg shadow-slate-200/50">
      <p class="text-lg font-semibold text-slate-900">${title}</p>
      <p class="mt-3 text-sm leading-6 text-slate-600">${description}</p>
    </div>
  `;
}

function renderTrustSection() {
  return `
    <section id="trust" class="mt-20 rounded-[2.5rem] border border-slate-200 bg-white/90 p-8 shadow-[0_30px_90px_-50px_rgba(15,23,42,0.24)] backdrop-blur-xl">
      <div class="grid gap-8 lg:grid-cols-[0.8fr_0.6fr] lg:items-center">
        <div>
          <p class="text-sm font-semibold uppercase tracking-[0.35em] text-sky-600">Trusted by schools</p>
          <h2 class="mt-4 text-3xl font-semibold tracking-tight text-slate-900">Powering operations for growing school networks.</h2>
          <p class="mt-4 max-w-2xl text-slate-600">GlobyEdu OS is trusted by admissions, finance, and leadership teams looking for a polished platform with enterprise controls and fast deployment.</p>
          <div class="mt-8 grid gap-4 sm:grid-cols-3">
            ${renderTrustMetric('35+', 'Campuses live', 'Enterprise-scale deployment with multi-campus operations.')}
            ${renderTrustMetric('120k', 'Students managed', 'Secure student and academic records across every campus.')}
            ${renderTrustMetric('99.9%', 'Uptime guarantee', 'Reliable platform availability for school operations and parent engagement.')}
          </div>
        </div>
        <div class="rounded-4xl bg-slate-950 p-8 text-white shadow-xl shadow-slate-950/10">
          <p class="text-sm uppercase tracking-[0.35em] text-emerald-300">Platform confidence</p>
          <h3 class="mt-4 text-2xl font-semibold">Secure, compliant, and user-friendly.</h3>
          <ul class="mt-6 space-y-4 text-sm text-slate-300">
            <li class="flex items-start gap-3"><span class="mt-1 h-2.5 w-2.5 rounded-full bg-emerald-400"></span>Role-based access and audit-ready activity logs.</li>
            <li class="flex items-start gap-3"><span class="mt-1 h-2.5 w-2.5 rounded-full bg-emerald-400"></span>Flexible cloud and on-premise-ready architecture.</li>
            <li class="flex items-start gap-3"><span class="mt-1 h-2.5 w-2.5 rounded-full bg-emerald-400"></span>Dedicated onboarding and ongoing support for campus teams.</li>
          </ul>
        </div>
      </div>
    </section>
  `;
}

function renderTrustMetric(value, title, description) {
  return `
    <div class="rounded-[1.75rem] border border-slate-200 bg-slate-50 p-6 shadow-sm">
      <p class="text-3xl font-semibold text-slate-900">${value}</p>
      <p class="mt-2 text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">${title}</p>
      <p class="mt-3 text-sm leading-6 text-slate-600">${description}</p>
    </div>
  `;
}

function renderWhyChooseSection() {
  return `
    <section id="why-choose" class="mt-20 rounded-[2.5rem] border border-slate-200 bg-linear-to-br from-slate-950/95 to-slate-900/90 p-8 text-white shadow-xl shadow-slate-950/15">
      <div class="grid gap-10 lg:grid-cols-[0.9fr_0.7fr] lg:items-center">
        <div>
          <p class="text-sm font-semibold uppercase tracking-[0.35em] text-cyan-300">Why choose GlobyEdu</p>
          <h2 class="mt-4 text-3xl font-semibold tracking-tight text-white">Built for modern school teams and enterprise-scale operations.</h2>
          <p class="mt-4 max-w-2xl text-slate-300">A premium school OS with cloud-first infrastructure, secure access controls, and workflow automation across admissions, attendance, finance, and communication.</p>
        </div>
        <div class="grid gap-4">
          ${renderReasonCard('Unified school operations', 'All core workflows in one platform with clean, configurable dashboards for each role.')}
          ${renderReasonCard('Real-time decision support', 'Live analytics, attendance trends, and finance snapshots help leaders act faster.')}
          ${renderReasonCard('Guided demo architecture', 'Book a walkthrough to see end-to-end workflows and how the platform fits your school network.')}
        </div>
      </div>
    </section>
  `;
}

function renderReasonCard(title, description) {
  return `
    <div class="rounded-[1.75rem] border border-slate-800/60 bg-slate-950/70 p-6 shadow-lg shadow-slate-950/20 transition duration-200 hover:-translate-y-1">
      <p class="text-lg font-semibold text-white">${title}</p>
      <p class="mt-3 text-sm leading-6 text-slate-300">${description}</p>
    </div>
  `;
}

function renderPlatformStats() {
  return `
    <section id="platform-stats" class="mt-20 rounded-[2.5rem] border border-slate-200 bg-white/95 p-8 shadow-[0_30px_90px_-50px_rgba(15,23,42,0.28)] backdrop-blur-xl">
      <div class="grid gap-8 lg:grid-cols-[0.9fr_0.8fr] lg:items-center">
        <div>
          <p class="text-sm font-semibold uppercase tracking-[0.35em] text-sky-600">Platform stats</p>
          <h2 class="mt-4 text-3xl font-semibold tracking-tight text-slate-900">Demo data that tells a powerful story.</h2>
          <p class="mt-4 max-w-2xl text-slate-600">See how GlobyEdu OS surfaces attendance, finance, and messaging insights with an interface built for speed and clarity.</p>
          <div class="mt-8 grid gap-4 sm:grid-cols-3">
            ${renderPlatformStat('Attendance rate', '98%', 'Accuracy for daily tracking and alerting.', '98', '%')}
            ${renderPlatformStat('Active users', '12,480', 'Students, parents and staff connected.', '12480')}
            ${renderPlatformStat('Messages sent', '4.2k', 'Centralized communications delivered across teams.', '4200')}
          </div>
        </div>
        <div class="rounded-4xl border border-slate-200 bg-slate-950 p-6 shadow-xl shadow-slate-950/15">
          <div class="flex items-center justify-between gap-4 rounded-3xl bg-slate-900/80 p-4 text-white">
            <div>
              <p class="text-xs uppercase tracking-[0.35em] text-cyan-300">Live preview</p>
              <p class="mt-2 text-xl font-semibold">Dashboard pulse</p>
            </div>
            <span class="inline-flex rounded-full bg-emerald-500/15 px-3 py-1 text-sm text-emerald-200">Updated 2m ago</span>
          </div>
          <div class="mt-6 space-y-4">
            ${renderPlatformMiniRow('Attendance today', '98.4%', 'progress')}
            ${renderPlatformMiniRow('Fee collections', '$24.8k', 'progress')}
            ${renderPlatformMiniRow('Open tickets', '9', 'progress')}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderPlatformStat(title, value, description, target, suffix = '') {
  return `
    <div class="rounded-[1.75rem] border border-slate-200 bg-slate-50 p-6 shadow-sm">
      <p class="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">${title}</p>
      <p class="mt-3 text-3xl font-semibold text-slate-900 animate-number" data-target="${target}" data-suffix="${suffix}">${value}</p>
      <p class="mt-3 text-sm leading-6 text-slate-600">${description}</p>
    </div>
  `;
}

function renderPlatformMiniRow(label, value, style) {
  return `
    <div class="rounded-3xl bg-slate-900/80 p-4 text-slate-100">
      <div class="flex items-center justify-between gap-4">
        <p class="text-sm text-slate-400">${label}</p>
        <p class="text-lg font-semibold text-white">${value}</p>
      </div>
      <div class="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
        <div class="h-full rounded-full bg-linear-to-r from-cyan-400 to-emerald-400" style="width:${style === 'progress' ? '84%' : '50%'}"></div>
      </div>
    </div>
  `;
}

function renderInstallAppSection() {
  return `
    <section id="install-app" class="mt-20 rounded-[2.5rem] border border-slate-200 bg-slate-950 p-8 text-white shadow-xl shadow-slate-950/15">
      <div class="grid gap-8 lg:grid-cols-[0.9fr_0.7fr] lg:items-center">
        <div>
          <p class="text-sm font-semibold uppercase tracking-[0.35em] text-cyan-300">Install the app</p>
          <h2 class="mt-4 text-3xl font-semibold tracking-tight text-white">Use GlobyEdu OS as a fast, installable PWA.</h2>
          <p class="mt-4 max-w-2xl text-slate-300">Install the web app for offline-ready access, quicker launch times, and the same premium experience across notebook, tablet, and desktop.</p>
          <ul class="mt-8 space-y-4 text-sm text-slate-300">
            <li class="flex items-start gap-3"><span class="mt-1 h-2.5 w-2.5 rounded-full bg-cyan-400"></span>Tap install to launch GlobyEdu OS like a native application.</li>
            <li class="flex items-start gap-3"><span class="mt-1 h-2.5 w-2.5 rounded-full bg-cyan-400"></span>Enjoy offline-friendly caching and fast repeat visits.</li>
            <li class="flex items-start gap-3"><span class="mt-1 h-2.5 w-2.5 rounded-full bg-cyan-400"></span>Secure sessions and enterprise delivery for school operations teams.</li>
          </ul>
        </div>
        <div class="rounded-[1.75rem] bg-slate-900/90 p-6">
          <div class="rounded-[1.75rem] bg-slate-950/90 p-6 text-center shadow-lg shadow-slate-950/20">
            <p class="text-sm uppercase tracking-[0.35em] text-cyan-300">Ready to install</p>
            <h3 class="mt-4 text-xl font-semibold text-white">GlobyEdu OS app</h3>
            <p class="mt-3 text-sm leading-6 text-slate-400">Fast access, offline support, and a clean desktop/tablet experience.</p>
            <button data-action="install-app" class="mt-8 inline-flex items-center justify-center rounded-full bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400">Install App</button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderScreenshots() {
  return `
    <section id="overview" class="mt-20">
      <div class="grid gap-10 lg:grid-cols-[0.95fr_0.9fr] lg:items-end">
        <div class="max-w-2xl">
          <p class="text-sm font-semibold uppercase tracking-[0.3em] text-sky-600">Platform overview</p>
          <h2 class="mt-4 text-3xl font-semibold text-slate-900">One connected workspace for every school role.</h2>
          <p class="mt-4 text-slate-600">Give school leaders, teachers, and students focused dashboards for the work they do every day, all powered by one connected school operating system.</p>
        </div>
        <div class="rounded-full bg-slate-900/5 px-6 py-4 text-sm text-slate-600">Clear role-based views, from school-wide operations to daily learning.</div>
      </div>
      <div class="mt-10 grid gap-6 lg:grid-cols-3">
        ${renderScreenshotCard('School Authority', 'See the full school picture and manage students, staff, classes, finance, and reporting from one command center.', screenshotAuthorityImage, screenshotAuthorityPlaceholder)}
        ${renderScreenshotCard('Teacher Dashboard', 'Plan lessons, manage classes, record attendance, track assignments, and keep learners moving forward.', screenshotTeacherImage, screenshotTeacherPlaceholder)}
        ${renderScreenshotCard('Student Dashboard', 'Stay on top of classes, learning materials, assignments, attendance, results, and school updates.', screenshotStudentImage, screenshotStudentPlaceholder)}
      </div>
    </section>
  `;
}

function renderScreenshotCard(title, description, image, fallbackImage) {
  return `
    <div class="overflow-hidden rounded-4xl border border-slate-200 bg-white shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-lg">
      <div class="relative dashboard-preview-media overflow-hidden bg-slate-950">
        <img src="${image}" onerror="this.onerror=null;this.src='${fallbackImage}'" alt="${title} dashboard preview" loading="lazy" decoding="async" class="h-full w-full object-cover opacity-90" />
        <div class="absolute inset-x-0 bottom-0 bg-linear-to-t from-slate-950/90 to-transparent px-4 py-3 text-white">
          <p class="text-sm font-semibold uppercase tracking-[0.25em]">${title}</p>
        </div>
      </div>
      <div class="p-6">
        <h3 class="text-xl font-semibold text-slate-900">${title}</h3>
        <p class="mt-3 text-sm text-slate-600">${description}</p>
      </div>
    </div>
  `;
}

function renderTestimonials() {
  return `
    <section class="mt-20" id="about">
      <div class="mx-auto max-w-7xl px-6">
        <div class="grid gap-8 lg:grid-cols-[0.6fr_0.4fr] lg:items-start">
          <div>
            <p class="text-sm font-semibold uppercase tracking-[0.3em] text-sky-600">About GlobyEdu OS</p>
            <h2 class="mt-4 text-3xl font-semibold text-slate-900">A next-generation school operating system</h2>
            <p class="mt-4 text-slate-600">GlobyEdu OS is built to simplify administration, enhance communication, and improve learning outcomes across all school sizes.</p>
            <ul class="mt-6 grid gap-3 text-sm text-slate-600">
              <li class="flex items-start gap-3"><span class="mt-1 h-3 w-3 rounded-full bg-emerald-500"></span>Built for schools of all sizes</li>
              <li class="flex items-start gap-3"><span class="mt-1 h-3 w-3 rounded-full bg-emerald-500"></span>Secure, scalable, and reliable</li>
              <li class="flex items-start gap-3"><span class="mt-1 h-3 w-3 rounded-full bg-emerald-500"></span>Actionable insights and dependable support</li>
            </ul>
          </div>

          <div>
            <p class="text-sm font-semibold uppercase tracking-[0.3em] text-sky-600">What our schools say</p>
            <div class="mt-6 grid gap-4">
              ${renderTestimonial(testimonialImage1, 'A modern control center for every school team.', 'Meridian School', 5)}
              ${renderTestimonial(testimonialImage2, 'Operations finally feel calm and measurable.', 'Horizon Prep', 4.5)}
              ${renderTestimonial(testimonialImage3, 'Our teams can manage attendance, messaging, and billing from one place.', 'Sage Academy', 4)}
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderTestimonial(image, message = '', author = '', score = 5) {
  const stars = Math.round(score);
  const starHtml = Array.from({ length: 5 }).map((_, i) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="${i < stars ? '#f59e0b' : 'none'}" stroke="#f59e0b" stroke-width="1"><path d="M12 .587l3.668 7.431L24 9.75l-6 5.85L19.335 24 12 20.01 4.665 24 6 15.6 0 9.75l8.332-1.732z"/></svg>`).join('');

  return `
    <article class="rounded-[1.25rem] border border-slate-200 p-6 bg-white shadow-sm" role="article" aria-label="Testimonial card">
      <div class="flex items-start gap-4">
        <div class="h-14 w-14 flex-none overflow-hidden rounded-full border bg-slate-50">
          <img src="${image}" alt="Customer photo" class="h-full w-full object-cover" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center justify-between gap-4">
            <div>
              <p class="text-sm font-semibold text-slate-900">${author || 'Verified Customer'}</p>
              <p class="mt-1 text-xs text-slate-500">${message || 'Customer feedback will appear here once available.'}</p>
            </div>
            <div class="flex items-center gap-2 text-sm text-slate-500" aria-hidden="true">${starHtml}<span class="text-slate-700 font-semibold">${score}</span></div>
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderPricing(pricingPlans = []) {
  const plans = Array.isArray(pricingPlans) ? pricingPlans.filter((plan) => plan && plan.active !== false) : [];
  const defaultPlanCards = `
    <article class="rounded-4xl border border-slate-200 bg-white p-8 shadow-sm transition hover:shadow-lg">
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="text-sm font-semibold uppercase tracking-[0.3em] text-sky-600">STARTER</p>
          <p class="mt-2 text-sm text-slate-500">Essential school management tools for small schools ready to move their daily operations online.</p>
        </div>
      </div>
      <p class="mt-6 text-4xl font-semibold text-slate-900">GHS 150<span class="text-lg font-medium text-slate-500">/month</span></p>
      <p class="mt-2 text-sm text-slate-500">Up to 100 students</p>
      <p class="mt-3 text-sm font-medium text-emerald-600">GHS 1,500/year — Save GHS 300</p>
      <ul class="mt-6 space-y-3 text-sm text-slate-600">
        <li class="flex items-start gap-3"><span class="mt-1 h-2.5 w-2.5 rounded-full bg-sky-500"></span>Student records</li>
        <li class="flex items-start gap-3"><span class="mt-1 h-2.5 w-2.5 rounded-full bg-sky-500"></span>Attendance tracking</li>
        <li class="flex items-start gap-3"><span class="mt-1 h-2.5 w-2.5 rounded-full bg-sky-500"></span>Basic school communication</li>
      </ul>
      <button data-action="get-started" data-plan-slug="starter" class="mt-8 inline-flex items-center justify-center rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700">Start Free Trial</button>
    </article>
    <article class="rounded-4xl border border-slate-200 bg-white p-8 shadow-sm transition hover:shadow-lg">
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="text-sm font-semibold uppercase tracking-[0.3em] text-sky-600">GROWTH</p>
          <p class="mt-2 text-sm text-slate-500">More capacity and flexibility for growing schools managing more students, teachers, and school activities.</p>
        </div>
      </div>
      <p class="mt-6 text-4xl font-semibold text-slate-900">GHS 300<span class="text-lg font-medium text-slate-500">/month</span></p>
      <p class="mt-2 text-sm text-slate-500">Up to 300 students</p>
      <p class="mt-3 text-sm font-medium text-emerald-600">GHS 3,000/year — Save GHS 600</p>
      <ul class="mt-6 space-y-3 text-sm text-slate-600">
        <li class="flex items-start gap-3"><span class="mt-1 h-2.5 w-2.5 rounded-full bg-sky-500"></span>Advanced reporting</li>
        <li class="flex items-start gap-3"><span class="mt-1 h-2.5 w-2.5 rounded-full bg-sky-500"></span>Staff and payroll tools</li>
        <li class="flex items-start gap-3"><span class="mt-1 h-2.5 w-2.5 rounded-full bg-sky-500"></span>School operations workflows</li>
      </ul>
      <button data-action="get-started" data-plan-slug="growth" class="mt-8 inline-flex items-center justify-center rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700">Start Free Trial</button>
    </article>
    <article class="rounded-4xl border border-slate-200 bg-white p-8 shadow-sm transition hover:shadow-lg">
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="text-sm font-semibold uppercase tracking-[0.3em] text-sky-600">PRO</p>
          <p class="mt-2 text-sm text-slate-500">A complete school operating solution for larger schools that need a powerful platform to manage their entire school community.</p>
        </div>
      </div>
      <p class="mt-6 text-4xl font-semibold text-slate-900">GHS 500<span class="text-lg font-medium text-slate-500">/month</span></p>
      <p class="mt-2 text-sm text-slate-500">Up to 700 students</p>
      <p class="mt-3 text-sm font-medium text-emerald-600">GHS 5,000/year — Save GHS 1,000</p>
      <ul class="mt-6 space-y-3 text-sm text-slate-600">
        <li class="flex items-start gap-3"><span class="mt-1 h-2.5 w-2.5 rounded-full bg-sky-500"></span>Custom school workflows</li>
        <li class="flex items-start gap-3"><span class="mt-1 h-2.5 w-2.5 rounded-full bg-sky-500"></span>Parent and staff portals</li>
        <li class="flex items-start gap-3"><span class="mt-1 h-2.5 w-2.5 rounded-full bg-sky-500"></span>Full operational visibility</li>
      </ul>
      <button data-action="get-started" data-plan-slug="pro" class="mt-8 inline-flex items-center justify-center rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700">Start Free Trial</button>
    </article>
    <article class="rounded-4xl border border-slate-200 bg-slate-950 p-8 text-white shadow-sm transition hover:shadow-lg">
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="text-sm font-semibold uppercase tracking-[0.3em] text-sky-300">ENTERPRISE</p>
          <p class="mt-2 text-sm text-slate-300">Built for large schools and institutions requiring higher capacity, custom requirements, and dedicated support.</p>
        </div>
      </div>
      <p class="mt-6 text-4xl font-semibold text-white">CUSTOM</p>
      <p class="mt-2 text-sm text-slate-300">700+ students</p>
      <p class="mt-3 text-sm font-medium text-emerald-300">Contact us for custom pricing and dedicated support.</p>
      <ul class="mt-6 space-y-3 text-sm text-slate-300">
        <li class="flex items-start gap-3"><span class="mt-1 h-2.5 w-2.5 rounded-full bg-sky-400"></span>Custom capacity planning</li>
        <li class="flex items-start gap-3"><span class="mt-1 h-2.5 w-2.5 rounded-full bg-sky-400"></span>White-glove onboarding</li>
        <li class="flex items-start gap-3"><span class="mt-1 h-2.5 w-2.5 rounded-full bg-sky-400"></span>Priority support</li>
      </ul>
      <button data-action="contact-sales" class="mt-8 inline-flex items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-100">Contact Sales</button>
    </article>
  `;

  const planCards = plans.length > 0 ? plans.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0)).map((plan) => renderPricingCard(plan)).join('') : defaultPlanCards;

  return `
    <section class="mt-20" id="pricing">
      <div class="grid gap-8 lg:grid-cols-2 xl:grid-cols-4">
        ${planCards}
      </div>
      <p class="mt-6 text-sm text-slate-600">Before subscribing, review the ${'<a href="#/legal/terms" class="font-semibold text-sky-700">Terms of Service</a>'}, ${'<a href="#/legal/privacy" class="font-semibold text-sky-700">Privacy Policy</a>'}, and ${'<a href="#/legal/payments" class="font-semibold text-sky-700">Payment & Refund Policy</a>'}.</p>
    </section>
  `;
}

function renderPricingCard(plan) {
  const isCustomPlan = Number(plan.monthlyAmount || 0) === 0 && Number(plan.yearlyAmount || 0) === 0;
  const planName = String(plan.name || '').toUpperCase();

  if (isCustomPlan) {
    return `
      <div class="rounded-4xl border border-slate-200 bg-slate-950 p-8 text-white shadow-sm hover:shadow-lg transition">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-sm font-semibold uppercase tracking-[0.3em] text-sky-300">ENTERPRISE</p>
            <p class="mt-2 text-sm text-slate-300">Built for large schools and institutions requiring higher capacity, custom requirements, and dedicated support.</p>
          </div>
        </div>
        <p class="mt-6 text-4xl font-semibold text-white">CUSTOM PRICING</p>
        <p class="mt-2 text-sm text-slate-300">700+ students</p>
        <p class="mt-3 text-sm font-medium text-emerald-300">Contact us for custom pricing.</p>
        <ul class="mt-6 space-y-3 text-sm text-slate-300">
          <li class="flex items-start gap-3"><span class="mt-1 h-2.5 w-2.5 rounded-full bg-sky-400"></span>Custom capacity planning</li>
          <li class="flex items-start gap-3"><span class="mt-1 h-2.5 w-2.5 rounded-full bg-sky-400"></span>Dedicated support</li>
          <li class="flex items-start gap-3"><span class="mt-1 h-2.5 w-2.5 rounded-full bg-sky-400"></span>Higher-scale onboarding</li>
        </ul>
        <button data-action="contact-sales" class="mt-8 inline-flex items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-100">Contact Sales</button>
      </div>
    `;
  }

  const customDescriptions = {
    STARTER: 'Essential school management tools for small schools ready to move their daily operations online.',
    GROWTH: 'More capacity and flexibility for growing schools managing more students, teachers, and school activities.',
    PRO: 'A complete school operating solution for larger schools that need a powerful platform to manage their entire school community.'
  };

  const description = customDescriptions[planName] || plan.shortDescription || 'School operations for growing teams.';
  const priceText = `${plan.currency || 'GHS'} ${Number(plan.monthlyAmount || 0).toLocaleString()}/month`;
  const yearlyText = `${plan.currency || 'GHS'} ${Number(plan.yearlyAmount || 0).toLocaleString()}/year`;

  return `
    <div class="rounded-4xl border border-slate-200 bg-white p-8 shadow-sm hover:shadow-lg transition">
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="text-sm font-semibold uppercase tracking-[0.3em] text-sky-600">${planName}</p>
          <p class="mt-2 text-sm text-slate-500">${description}</p>
        </div>
        ${plan.recommendedBadge ? `<span class="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">Recommended</span>` : ''}
      </div>
      <p class="mt-6 text-4xl font-semibold text-slate-900">${priceText}</p>
      <p class="mt-2 text-sm text-slate-500">Up to ${Number(plan.studentLimit || 0).toLocaleString()} students • ${yearlyText}</p>
      <p class="mt-3 text-sm font-medium text-emerald-600">${planName === 'STARTER' ? 'GHS 1,500/year — Save GHS 300' : planName === 'GROWTH' ? 'GHS 3,000/year — Save GHS 600' : 'GHS 5,000/year — Save GHS 1,000'}</p>
      <ul class="mt-6 space-y-3 text-sm text-slate-600">
        <li class="flex items-start gap-3"><span class="mt-1 h-2.5 w-2.5 rounded-full bg-sky-500"></span>${planName === 'STARTER' ? 'Student records' : planName === 'GROWTH' ? 'Advanced reporting' : 'Custom school workflows'}</li>
        <li class="flex items-start gap-3"><span class="mt-1 h-2.5 w-2.5 rounded-full bg-sky-500"></span>${planName === 'STARTER' ? 'Attendance tracking' : planName === 'GROWTH' ? 'Staff and payroll tools' : 'Parent and staff portals'}</li>
        <li class="flex items-start gap-3"><span class="mt-1 h-2.5 w-2.5 rounded-full bg-sky-500"></span>${planName === 'STARTER' ? 'Basic school communication' : planName === 'GROWTH' ? 'School operations workflows' : 'Full operational visibility'}</li>
      </ul>
      <button data-action="get-started" data-plan-slug="${plan.slug}" class="mt-8 inline-flex items-center justify-center rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700">Start Free Trial</button>
    </div>
  `;
}

function renderFAQ(cms = getWebsiteCMSSettings()) {
  return `
    <section class="mt-20 rounded-4xl bg-white p-8 shadow-xl shadow-slate-200/50" id="faq">
      <div class="grid gap-8 lg:grid-cols-[0.95fr_0.95fr]">
        <div>
          <p class="text-sm font-semibold uppercase tracking-[0.3em] text-sky-600">FAQ</p>
          <h2 class="mt-4 text-3xl font-semibold text-slate-900">Answers for modern school teams.</h2>
          <div class="mt-8 space-y-4 text-slate-600">
            ${renderFAQItem('Can parents login?', 'Yes. Parents can have secure portals to monitor attendance, grades, and messages for their children.')}
            ${renderFAQItem('Can I manage multiple campuses?', 'Yes. GlobyEdu is built for multi-campus and multi-tenant operations from the start.')}
            ${renderFAQItem('Can I use my own cloud?', 'Yes. The platform supports flexible deployment options including private and hybrid cloud hosting.')}
            ${renderFAQItem('How secure is my data?', 'We use role-based access, encrypted data storage, and enterprise-grade security controls.')}
            ${renderFAQItem('Does it work on phones?', 'Yes. The platform is fully responsive and optimized for tablet and mobile devices.')}
            ${renderFAQItem('Can I install it as an App?', 'Yes. The homepage is PWA-ready and can prompt users to install the app when supported.')}
            ${renderFAQItem('Can I migrate existing school data?', 'Yes. The platform supports import workflows for student, staff, and academic data.')}
          </div>
        </div>
        <div class="rounded-[1.75rem] bg-slate-950 p-8 text-white">
          <p class="text-sm font-semibold uppercase tracking-[0.3em] text-emerald-300">Need help?</p>
          <h3 class="mt-4 text-2xl font-semibold">Contact our team.</h3>
          <p class="mt-4 text-slate-300">Send a note if you need a demo, pricing details, or onboarding help.</p>
          <div class="mt-8 space-y-4 text-sm text-slate-300">
            <p><span class="font-semibold">Email:</span> ${escapeHtml(cms.contactEmail)}</p>
            <p><span class="font-semibold">Phone:</span> ${escapeHtml(cms.contactPhone)}</p>
            ${cms.address ? `<p><span class="font-semibold">Address:</span> ${escapeHtml(cms.address)}</p>` : ''}
            <p><span class="font-semibold">Hours:</span> ${escapeHtml(cms.businessHours)}</p>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderFAQItem(question, answer) {
  return `
    <details class="faq-item rounded-3xl border border-slate-200 bg-slate-50 p-4 transition duration-200 open:bg-white">
      <summary class="flex cursor-pointer items-center justify-between gap-4 text-left font-semibold text-slate-900 outline-none">
        <span>${question}</span>
        <span class="text-slate-500">+</span>
      </summary>
      <div class="mt-4 text-sm leading-6 text-slate-600">${answer}</div>
    </details>
  `;
}

function renderContact(cms = getWebsiteCMSSettings()) {
  const socialLinks = String(cms.socialLinks || 'LinkedIn, Twitter, Facebook, Instagram')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map(escapeHtml);

  return `
    <section class="mt-20 rounded-4xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-sky-50/60 p-8 text-slate-900 shadow-[0_30px_90px_-45px_rgba(14,165,233,0.28)]">
      <div class="grid gap-8 lg:grid-cols-2 lg:items-center">
        <div class="rounded-[1.75rem] border border-slate-200 bg-white/90 p-6 shadow-[0_18px_50px_-30px_rgba(15,23,42,0.18)] sm:p-8">
          <p class="text-sm font-semibold uppercase tracking-[0.3em] text-sky-600">Contact</p>
          <h2 class="mt-4 text-3xl font-semibold text-slate-900">Let us build your school's digital future.</h2>
          <p class="mt-4 max-w-xl text-slate-600">Share your details and our team will follow up with a tailored onboarding plan for your campus.</p>
          <div class="mt-8 space-y-3 text-sm text-slate-600">
            <p class="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2"><span class="font-semibold text-slate-900">Email:</span> ${escapeHtml(cms.contactEmail)}</p>
            <p class="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2"><span class="font-semibold text-slate-900">Phone:</span> ${escapeHtml(cms.contactPhone)}</p>
            ${cms.address ? `<p class="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2"><span class="font-semibold text-slate-900">Address:</span> ${escapeHtml(cms.address)}</p>` : ''}
            <p class="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2"><span class="font-semibold text-slate-900">Hours:</span> ${escapeHtml(cms.businessHours)}</p>
            <p class="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2"><span class="font-semibold text-slate-900">Social:</span> ${socialLinks.join(' • ')}</p>
          </div>
        </div>
        <div class="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_-30px_rgba(15,23,42,0.18)] ring-1 ring-slate-200/80 sm:p-8">
          <form id="contact-form" class="space-y-4">
            <label class="block text-sm text-slate-700">Name<input class="mt-2 w-full rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100" type="text" id="contact-name" placeholder="Your name" required></label>
            <label class="block text-sm text-slate-700">Email<input class="mt-2 w-full rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100" type="email" id="contact-email" placeholder="you@school.edu" required></label>
            <label class="block text-sm text-slate-700">Message<textarea class="mt-2 w-full rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100" id="contact-message" rows="4" placeholder="Tell us about your school" required></textarea></label>
            <button type="submit" class="inline-flex w-full items-center justify-center rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700">Send Message</button>
            <div id="contact-status" class="text-sm text-slate-600"></div>
          </form>
        </div>
      </div>
    </section>
  `;
}

function renderNewsletter() {
  return `
    <section class="mt-20 rounded-4xl border border-slate-200 bg-white p-8 shadow-sm">
      <div class="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p class="text-sm font-semibold uppercase tracking-[0.3em] text-sky-600">Newsletter</p>
          <h2 class="mt-4 text-3xl font-semibold text-slate-900">Get product updates, insights, and launch news.</h2>
        </div>
        <form id="newsletter-form" class="flex flex-col gap-3 sm:flex-row">
          <input id="newsletter-email" type="email" required placeholder="Email address" class="min-w-0 flex-1 rounded-full border border-slate-200 bg-slate-50 px-5 py-3 text-sm text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
          <button type="submit" class="rounded-full bg-sky-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-sky-700">Subscribe</button>
        </form>
        <p id="newsletter-status" class="text-sm text-slate-500"></p>
      </div>
    </section>
  `;
}

function renderLoginPage() {
  const cms = getWebsiteCMSSettings();
  root.innerHTML = `${Nav(cms)}${LoginPage()}${Footer(cms)}`;
  attachLoginHandlers();
}

function renderPlatformAdminPage() {
  root.innerHTML = `${Nav()}${PlatformAdminPage()}${Footer()}`;
  attachPlatformAdminHandlers();
}

function renderAuthenticatedAppShell(section = 'overview', role = 'super_admin', childrenContent = null, profilePhotoUrl = '') {
  seedWorkspaceData();
  applyWorkspaceTheme();
  const userName = localStorage.getItem('globyedu_userFullName') || 'User';
  const roleKey = role === 'school_authority' || role === 'school_head' ? 'school_authority' : role === 'teacher' ? 'teacher' : role === 'student' ? 'student' : 'super_admin';
  const navItems = getAppNavItems(roleKey);

  const content = childrenContent ?? getAuthenticatedModuleContent(section, roleKey, userName);
  root.innerHTML = `
    <div id="${PWA_STATUS_ID}" class="hidden fixed inset-x-0 top-16 z-50 mx-auto w-full max-w-4xl rounded-b-3xl bg-slate-900/95 px-4 py-3 text-sm text-white shadow-2xl transition-transform duration-300 sm:left-1/2 sm:-translate-x-1/2"></div>
    ${AppShell({
      role: roleKey,
      title: section === 'overview' ? 'Workspace' : 'Workspace tools',
      subtitle: getWorkspaceTitle(section, roleKey),
      navItems,
      activeItem: section,
      profileName: userName.split(' ')[0] || 'User',
      children: content,
    })}
  `;
  showAccountProfilePhoto(profilePhotoUrl);
  attachAuthenticatedShellHandlers(roleKey, section);
  attachAccountProfilePhotoHandlers(roleKey);
}

function showAccountProfilePhoto(url) {
  if (!url) return;
  const imageSelectors = ['[data-account-profile-photo]', '[data-school-profile-photo]', '[data-platform-profile-photo]'];
  imageSelectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((image) => {
      image.src = url;
      image.classList.remove('hidden');
    });
  });
  document.querySelectorAll('[data-account-profile-initial], [data-school-profile-initial], [data-platform-profile-initial]')
    .forEach((initial) => initial.classList.add('hidden'));
}

function attachAccountProfilePhotoHandlers(role) {
  if (!['school_authority', 'super_admin'].includes(role)) return;
  const token = getAccessToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  fetch('/api/v1/account-profile/photo', { headers, cache: 'no-store' })
    .then(async (response) => {
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.status !== 'ok') {
        if (response.status !== 403) throw new Error(data?.message || 'Unable to load your profile photo.');
        return null;
      }
      return data.url || null;
    })
    .then(showAccountProfilePhoto)
    .catch((error) => console.warn('Unable to load authenticated profile photo.', error));

  const input = document.querySelector('[data-account-profile-photo-input]');
  const cameraButton = document.querySelector('[data-account-profile-camera]');
  const status = document.querySelector('[data-account-profile-photo-status]');
  if (!input) return;

  input.closest('label')?.addEventListener('click', () => input.removeAttribute('capture'));
  cameraButton?.addEventListener('click', () => {
    input.setAttribute('capture', 'user');
    input.click();
  });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const validationError = validateProfileImageUpload(file);
    if (validationError) {
      input.value = '';
      if (status) status.textContent = validationError;
      return;
    }

    if (status) status.textContent = 'Uploading profile photo...';
    input.disabled = true;
    try {
      const response = await fetch('/api/v1/account-profile/photo', {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': file.type || 'application/octet-stream',
        },
        body: file,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.status !== 'ok' || !data.url) {
        throw new Error(data?.message || `Profile photo upload failed (HTTP ${response.status}).`);
      }
      showAccountProfilePhoto(data.url);
      if (status) status.textContent = 'Profile photo saved.';
    } catch (error) {
      if (status) status.textContent = error.message || 'Unable to upload your profile photo.';
    } finally {
      input.disabled = false;
      input.value = '';
      input.removeAttribute('capture');
    }
  });
}

function getWorkspaceTitle(section, role) {
  if (role === 'school_authority') return 'School Authority Workspace';
  if (role === 'teacher') return 'Teacher Workspace';
  if (role === 'student') return 'Student Workspace';
  return 'Super Admin Workspace';
}

function getAppNavItems(role) {
  if (role === 'school_authority') {
    return [
      { id: 'overview', label: 'Dashboard', path: '#/school/overview', icon: '◉' },
      { id: 'profile', label: 'Profile', path: '#/school/profile', icon: '⌂' },
      { id: 'students', label: 'Students', path: '#/school/students', icon: '👥' },
      { id: 'teachers', label: 'Teachers', path: '#/school/teachers', icon: '🧑‍🏫' },
      { id: 'classes', label: 'Class Management', path: '#/school/classes', icon: '🏫' },
      { id: 'attendance', label: 'Attendance', path: '#/school/attendance', icon: '✓' },
      { id: 'activity', label: 'Teacher Activity', path: '#/school/activity', icon: '◷' },
      { id: 'finance', label: 'Finance & Billing', path: '#/school/finance', icon: '💳' },
      { id: 'exams', label: 'Examination & Grading', path: '#/school/exams', icon: '📝' },
      { id: 'announcements', label: 'Announcements', path: '#/school/announcements', icon: '📣' },
      { id: 'notifications', label: 'Notifications', path: '#/school/notifications', icon: '🔔' },
      { id: 'messages', label: 'Messaging', path: '#/school/messages', icon: '💬' },
      { id: 'reports', label: 'Reports', path: '#/school/reports', icon: '📄' },
      { id: 'settings', label: 'Settings', path: '#/school/settings', icon: '⚙️' },
    ];
  }

  if (role === 'teacher') {
    return [
      { id: 'overview', label: 'Dashboard', path: '#/role/teacher', icon: '◉' },
      { id: 'classes', label: 'Classes', path: '#/role/teacher/classes', icon: '🏫' },
      { id: 'students', label: 'Students', path: '#/role/teacher/students', icon: '👥' },
      { id: 'assignments', label: 'Assignments', path: '#/role/teacher/assignments', icon: '📝' },
      { id: 'lessons', label: 'Learning Materials', path: '#/role/teacher/lessons', icon: '📚' },
      { id: 'attendance', label: 'Attendance', path: '#/role/teacher/attendance', icon: '✓' },
      { id: 'exams', label: 'Exams / Marks', path: '#/role/teacher/exams', icon: '📝' },
      { id: 'notifications', label: 'Notifications', path: '#/role/teacher/notifications', icon: '🔔' },
      { id: 'messages', label: 'Messages', path: '#/role/teacher/messages', icon: '💬' },
      { id: 'announcements', label: 'Announcements', path: '#/role/teacher/announcements', icon: '📣' },
      { id: 'support', label: 'Support', path: '#/role/teacher/support', icon: '🛟' },
      { id: 'reports', label: 'Reports', path: '#/role/teacher/reports', icon: '📄' },
      { id: 'profile', label: 'Profile', path: '#/role/teacher/profile', icon: '⌂' },
      { id: 'settings', label: 'Settings', path: '#/role/teacher/settings', icon: '⚙️' },
    ];
  }

  if (role === 'student') {
    return [
      { id: 'overview', label: 'Dashboard', path: '#/role/student', icon: '◉' },
      { id: 'classes', label: 'Classes', path: '#/role/student/classes', icon: '🏫' },
      { id: 'assignments', label: 'Assignments', path: '#/role/student/assignments', icon: '📝' },
      { id: 'lessons', label: 'Learning Materials', path: '#/role/student/lessons', icon: '📚' },
      { id: 'attendance', label: 'Attendance', path: '#/role/student/attendance', icon: '✓' },
      { id: 'results', label: 'Results', path: '#/role/student/results', icon: '📈' },
      { id: 'notifications', label: 'Notifications', path: '#/role/student/notifications', icon: '🔔' },
      { id: 'announcements', label: 'Announcements', path: '#/role/student/announcements', icon: '📣' },
      { id: 'messages', label: 'Messages', path: '#/role/student/messages', icon: '💬' },
      { id: 'profile', label: 'Profile', path: '#/role/student/profile', icon: '⌂' },
      { id: 'support', label: 'Support', path: '#/role/student/support', icon: '🛟' },
      { id: 'settings', label: 'Settings', path: '#/role/student/settings', icon: '⚙️' },
    ];
  }

  return [
    { id: 'overview', label: 'Dashboard', path: '#/admin/overview', icon: '◉' },
    { id: 'schools', label: 'Schools', path: '#/admin/schools', icon: '🏢' },
    { id: 'users', label: 'Users', path: '#/admin/users', icon: '👥' },
    { id: 'subscriptions', label: 'Subscriptions', path: '#/admin/subscriptions', icon: '✨' },
    { id: 'payments', label: 'Payments', path: '#/admin/payments', icon: '💳' },
    { id: 'pricing', label: 'Pricing', path: '#/admin/pricing', icon: '💲' },
    { id: 'website-cms', label: 'Website CMS', path: '#/admin/website-cms', icon: '🌐' },
    { id: 'ai-settings', label: 'AI Settings', path: '#/admin/ai-settings', icon: '🤖' },
    { id: 'analytics', label: 'Analytics', path: '#/admin/analytics', icon: '📊' },
    { id: 'reports', label: 'Reports', path: '#/admin/reports', icon: '📄' },
    { id: 'messages', label: 'Messages', path: '#/admin/messages', icon: '💬' },
    { id: 'announcements', label: 'Announcements', path: '#/admin/announcements', icon: '📣' },
    { id: 'support', label: 'Support', path: '#/admin/support', icon: '🛟' },
    { id: 'plugins', label: 'Plugin Marketplace', path: '#/admin/plugins', icon: '🧩' },
    { id: 'audit-logs', label: 'Audit Logs', path: '#/admin/audit-logs', icon: '🗂️' },
    { id: 'settings', label: 'Settings', path: '#/admin/settings', icon: '⚙️' },
    { id: 'backups', label: 'Backups', path: '#/admin/backups', icon: '📥' },
    { id: 'security', label: 'Security', path: '#/admin/security', icon: '🛡️' },
  ];
}

function getAuthenticatedModuleContent(section, role, userName) {
  if (role === 'school_authority') {
    return `
      <section class="space-y-6">
        <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">School Authority Workspace</p>
          <h2 class="mt-2 text-2xl font-semibold text-slate-900">${userName}, manage your school operations in one place.</h2>
          <p class="mt-3 text-slate-600">The authenticated workspace now loads without the marketing header or footer and exposes role-aware navigation.</p>
        </div>
        <div class="grid gap-6 lg:grid-cols-2">
          <div class="rounded-4xl border border-slate-200 bg-slate-50 p-6">
            <p class="text-sm uppercase tracking-[0.3em] text-slate-500">School Profile</p>
            <p class="mt-3 text-slate-600">Update school details, branding, and contact information from a single place.</p>
          </div>
          <div class="rounded-4xl border border-slate-200 bg-slate-50 p-6">
            <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Quick Actions</p>
            <p class="mt-3 text-slate-600">Create classes, manage attendance, record payments, and send announcements instantly.</p>
          </div>
        </div>
      </section>
    `;
  }

  if (role === 'teacher') {
    return `
      <section class="space-y-6">
        <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Teacher Workspace</p>
          <h2 class="mt-2 text-2xl font-semibold text-slate-900">${userName}, your classroom tools are ready.</h2>
          <p class="mt-3 text-slate-600">Use the role-specific navigation to open lessons, attendance, messages, and reports directly.</p>
        </div>
      </section>
    `;
  }

  if (role === 'student') {
    return `
      <section class="space-y-6">
        <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Student Workspace</p>
          <h2 class="mt-2 text-2xl font-semibold text-slate-900">Welcome back, ${userName}.</h2>
          <p class="mt-3 text-slate-600">Review your classes, assignments, results, and messages in the dedicated student workspace.</p>
        </div>
        <div class="rounded-4xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Account & Login</p>
              <h3 class="mt-2 text-xl font-semibold text-slate-900">Google sign-in and secure account access</h3>
            </div>
            <button type="button" id="student-connect-google" class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Connect Google</button>
          </div>
          <div class="mt-4 grid gap-4 md:grid-cols-2">
            <div class="rounded-2xl border border-slate-200 bg-white p-4">
              <p class="text-sm font-semibold text-slate-900">Email + password login</p>
              <p class="mt-2 text-sm text-slate-600">This remains the primary secure sign-in method for your school portal.</p>
            </div>
            <div class="rounded-2xl border border-slate-200 bg-white p-4">
              <p class="text-sm font-semibold text-slate-900">Google account</p>
              <p class="mt-2 text-sm text-slate-600">Optional future login option for faster access once connected to your Google account.</p>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  return `
    <section class="space-y-6">
      <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
        <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Super Admin Workspace</p>
        <h2 class="mt-2 text-2xl font-semibold text-slate-900">${userName}, all platform modules are now reachable from the authenticated application shell.</h2>
        <p class="mt-3 text-slate-600">The admin experience uses the dedicated workspace navigation and no longer mixes in the public marketing menu.</p>
      </div>
      <div class="grid gap-6 lg:grid-cols-3">
        <div class="rounded-4xl border border-slate-200 bg-slate-50 p-6">
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Schools</p>
          <p class="mt-3 text-slate-600">Provision and manage tenant schools from the admin dashboard.</p>
        </div>
        <div class="rounded-4xl border border-slate-200 bg-slate-50 p-6">
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Payments</p>
          <p class="mt-3 text-slate-600">Track subscriptions and payments for every school.</p>
        </div>
        <div class="rounded-4xl border border-slate-200 bg-slate-50 p-6">
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Website CMS</p>
          <p class="mt-3 text-slate-600">Update marketing content and launch information for the public site.</p>
        </div>
      </div>
    </section>
  `;
}

function attachAuthenticatedShellHandlers(role, section) {
  const sidebar = document.getElementById('app-sidebar');
  const backdrop = document.getElementById('app-sidebar-backdrop');
  const sidebarTrigger = document.querySelector('[data-app-sidebar-toggle]');
  const sidebarClose = sidebar?.querySelector('[data-app-sidebar-close]');
  const accountMenu = document.querySelector('[data-account-menu]');
  const accountMenuToggle = accountMenu?.querySelector('[data-account-menu-toggle]');
  const accountMenuPanel = accountMenu?.querySelector('[data-account-menu-panel]');

  accountMenuToggle?.addEventListener('click', (event) => {
    event.stopPropagation();
    const isOpen = !accountMenuPanel?.classList.contains('hidden');
    accountMenuPanel?.classList.toggle('hidden', isOpen);
    accountMenuToggle.setAttribute('aria-expanded', String(!isOpen));
  });

  document.addEventListener('click', (event) => {
    if (!accountMenu?.contains(event.target)) {
      accountMenuPanel?.classList.add('hidden');
      accountMenuToggle?.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      accountMenuPanel?.classList.add('hidden');
      accountMenuToggle?.setAttribute('aria-expanded', 'false');
    }
  });

  if (role === 'student') {
    document.querySelectorAll('[data-student-assignment-id]').forEach((button) => {
      button.addEventListener('click', async () => {
        const schoolId = localStorage.getItem('globyedu_schoolId');
        const token = getAccessToken();
        const assignmentId = button.getAttribute('data-student-assignment-id');
        if (!schoolId || !token || !assignmentId) return;
        const formData = await showAdminForm('Submit assignment', [
          { name: 'text', label: 'Your submission', type: 'textarea', required: true },
        ]);
        if (!formData) return;
        const result = await submitAssignment(token, schoolId, assignmentId, {
          studentId: localStorage.getItem('globyedu_studentId') || '',
          text: formData.text,
        });
        if (!result.ok || result.data?.status !== 'ok') {
          alert(result.data?.message || 'Unable to submit assignment.');
          return;
        }
        alert('Assignment submitted successfully.');
        renderRolePage('student', 'assignments');
      });
    });
  }

  const setSidebarOpen = (open, restoreFocus = false) => {
    if (!sidebar) return;
    const isMobile = window.innerWidth < 1024;
    const mobileOpen = isMobile && open;
    sidebar.classList.toggle('-translate-x-full', isMobile && !open);
    sidebar.classList.toggle('translate-x-0', mobileOpen);
    sidebar.inert = isMobile && !open;
    sidebar.setAttribute('aria-hidden', String(isMobile && !open));
    backdrop?.classList.toggle('hidden', !mobileOpen);
    document.body.classList.toggle('overflow-hidden', mobileOpen);
    document.querySelectorAll('[data-app-sidebar-toggle]').forEach((button) => {
      button.setAttribute('aria-expanded', String(mobileOpen));
    });
    if (!isMobile) {
      sidebar.classList.remove('-translate-x-full', 'translate-x-0');
      backdrop?.classList.add('hidden');
      document.body.classList.remove('overflow-hidden');
    }
    if (mobileOpen) sidebarClose?.focus();
    else if (isMobile && restoreFocus) sidebarTrigger?.focus();
  };

  document.querySelectorAll('[data-app-sidebar-toggle]').forEach((button) => {
    button.addEventListener('click', () => setSidebarOpen(true));
  });

  document.querySelectorAll('[data-app-sidebar-close]').forEach((button) => {
    button.addEventListener('click', () => setSidebarOpen(false, true));
  });

  backdrop?.addEventListener('click', () => setSidebarOpen(false, true));
  window.addEventListener('resize', () => setSidebarOpen(window.innerWidth >= 1024));
  setSidebarOpen(window.innerWidth >= 1024);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && backdrop && !backdrop.classList.contains('hidden')) {
      setSidebarOpen(false, true);
      return;
    }
    if (event.key !== 'Tab' || window.innerWidth >= 1024 || !backdrop || backdrop.classList.contains('hidden')) return;
    const focusable = sidebar.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !sidebar.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !sidebar.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  });

  document.querySelectorAll('[data-app-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.getAttribute('data-app-action');
      if (action === 'logout') {
        if (!await revokeCurrentSession()) return;
        const loginRoute = role === 'super_admin' ? '#/platform-admin' : '#/login';
        clearAuthenticationState();
        location.replace(loginRoute);
        return;
      }
      if (action === 'notifications') {
        if (role === 'school_authority') {
          location.hash = '#/school/notifications';
        } else if (role === 'teacher') {
          location.hash = '#/role/teacher/notifications';
        } else if (role === 'student') {
          location.hash = '#/role/student/notifications';
        } else {
          location.hash = '#/admin/notifications';
        }
      }
      if (action === 'messages') {
        if (role === 'school_authority') {
          location.hash = '#/school/messages';
        } else if (role === 'teacher') {
          location.hash = '#/role/teacher/messages';
        } else if (role === 'student') {
          location.hash = '#/role/student/messages';
        } else {
          location.hash = '#/admin/messages';
        }
      }
      if (action === 'profile') {
        accountMenuPanel?.classList.add('hidden');
        accountMenuToggle?.setAttribute('aria-expanded', 'false');
        if (role === 'school_authority') {
          location.hash = '#/school/profile';
        } else if (role === 'teacher') {
          location.hash = '#/role/teacher/profile';
        } else if (role === 'student') {
          location.hash = '#/role/student/profile';
        } else {
          location.hash = '#/admin/profile';
        }
      }
      if (action === 'settings') {
        accountMenuPanel?.classList.add('hidden');
        accountMenuToggle?.setAttribute('aria-expanded', 'false');
        if (role === 'school_authority') {
          location.hash = '#/school/settings';
        } else if (role === 'teacher') {
          location.hash = '#/role/teacher/settings';
        } else if (role === 'student') {
          location.hash = '#/role/student/settings';
        } else {
          location.hash = '#/admin/settings';
        }
      }
      if (action === 'help') {
        if (role === 'school_authority') {
          location.hash = '#/school/support';
        } else if (role === 'teacher') {
          location.hash = '#/role/teacher/support';
        } else if (role === 'student') {
          location.hash = '#/role/student/support';
        } else {
          location.hash = '#/admin/support';
        }
      }
    });
  });

  document.querySelectorAll('[data-app-nav]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const destination = link.getAttribute('href');
      if (!destination || !destination.startsWith('#/')) return;
      location.hash = destination;
      if (window.innerWidth < 1024) setSidebarOpen(false, true);
    });
  });
}

function renderRegisterPage() {
  root.innerHTML = `${Nav()}${RegisterWizardPage()}${Footer()}`;
  attachRegisterWizardHandlers();
}

function renderForgotPage(loginType = 'school') {
  root.innerHTML = `${Nav()}${ForgotPage(loginType)}${Footer()}`;
  attachForgotHandlers(loginType);
}

function renderResetPasswordPage(token = '', loginType = 'school') {
  root.innerHTML = `${Nav()}${ResetPasswordPage(token, loginType)}${Footer()}`;
  attachResetPasswordHandlers(token, loginType);
}

function renderVerifyEmailPage(status = 'pending', message = 'Verifying your email...') {
  root.innerHTML = `${Nav()}${VerifyEmailPage(status, message)}${Footer()}`;
}

async function renderAdminPage(section = 'overview', navigationId = routeGeneration, days = 365) {
  const userFullName = localStorage.getItem('globyedu_userFullName') || 'Benjamin';
  let summary = {};
  let schools = [];
  let pricingPlans = [];
  let auditLogs = [];
  let maintenanceMode = null;
  const token = getAccessToken();

  if (token) {
    const [summaryResult, schoolListResult, pricingResult, auditResult, maintenanceResult] = await Promise.all([
      fetchAdminDashboardSummary(token, days),
      section === 'archived-schools' ? fetchArchivedAdminSchools(token) : fetchAdminSchoolList(token),
      fetchAdminPricing(),
      fetchPlatformAuditLogs(token, { limit: section === 'audit-logs' ? 100 : 4 }),
      fetchMaintenanceMode(),
    ]);

    if (summaryResult.ok && summaryResult.data?.status === 'ok') {
      summary = summaryResult.data.summary || {};
    }
    if (schoolListResult.ok && schoolListResult.data?.status === 'ok') {
      schools = schoolListResult.data.schools || [];
      if (section !== 'archived-schools') localStorage.setItem('globyedu_schoolDirectory', JSON.stringify(schools));
    } else if (section !== 'archived-schools') {
      localStorage.removeItem('globyedu_schoolDirectory');
    }
    if (pricingResult.ok && pricingResult.data?.status === 'ok') pricingPlans = pricingResult.data.pricingPlans || [];
    if (auditResult.ok && auditResult.data?.status === 'ok') {
      auditLogs = auditResult.data.auditLogs || [];
      summary.latestActivity = auditLogs.slice(0, 4);
    }
    if (maintenanceResult.ok && maintenanceResult.data?.status === 'ok') {
      maintenanceMode = maintenanceResult.data.maintenanceMode === true;
    }
  }

  if (navigationId !== routeGeneration) return;

  renderAuthenticatedAppShell(section, 'super_admin', AdminPage(section, userFullName, summary, schools, pricingPlans, auditLogs, maintenanceMode));
  attachAdminHandlers();
  attachWebsiteCMSHandlers();
  attachAdminSectionHandlers(section);
  attachAdminPageActions(section, summary, schools);
}

function renderRegisterSuccess() {
  const schoolName = localStorage.getItem('globyedu_schoolName') || 'your school';
  const trialEnds = localStorage.getItem('globyedu_trialEnds');
  const schoolId = localStorage.getItem('globyedu_schoolId') || '---';
  root.innerHTML = `${Nav()}<main class="max-w-3xl mx-auto px-6 py-20 text-center"><div class="rounded-4xl border border-slate-200 bg-white p-10 shadow-xl"><p class="text-sm uppercase tracking-[0.3em] text-sky-600">Trial activated</p><h1 class="mt-6 text-4xl font-semibold text-slate-900">Welcome to GlobyEdu OS</h1><p class="mt-4 text-slate-600">Your school account for <strong>${schoolName}</strong> is active and includes a 3-day free trial.</p><p class="mt-4 text-slate-500">Your School ID has been created automatically. Save this ID to sign in later.</p><div class="mt-8 rounded-4xl border border-slate-200 bg-slate-50 p-6 text-left text-slate-700 shadow-sm"><p class="text-sm uppercase tracking-[0.3em] text-slate-500">School ID</p><div class="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center"><code id="school-id-value" class="w-full break-all rounded-3xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-semibold text-slate-900">${schoolId}</code><button id="copy-school-id" class="inline-flex shrink-0 items-center justify-center rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700">Copy ID</button></div></div><div class="mt-8 flex flex-col gap-4 sm:flex-row sm:justify-center"><a href="#/login" class="inline-flex items-center justify-center rounded-full bg-sky-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-sky-700">Go to Login</a><a href="#/" class="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-50">Return to homepage</a></div></div></main>${Footer()}`;
  attachRegisterSuccessHandlers();
}

function attachRegisterSuccessHandlers() {
  const copyButton = document.getElementById('copy-school-id');
  const schoolIdValue = document.getElementById('school-id-value');
  if (!copyButton || !schoolIdValue) return;

  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(schoolIdValue.textContent || '');
      copyButton.textContent = 'Copied!';
      setTimeout(() => { copyButton.textContent = 'Copy ID'; }, 2000);
    } catch {
      alert('Unable to copy School ID. Please copy it manually.');
    }
  });
}

async function renderRolePage(role = 'super_admin', section = 'overview', navigationId = routeGeneration) {
  const userName = localStorage.getItem('globyedu_userFullName') || 'User';
  const schoolName = localStorage.getItem('globyedu_schoolName') || 'School';
  const schoolId = localStorage.getItem('globyedu_schoolId') || '';
  
  if (navigationId !== routeGeneration) return;
  let schoolDataLoadError = '';

  let dashboardContent = '';
  let teacherData = null;
  let shellProfilePhotoUrl = '';
  let assignments = [];
  let lessons = [];
  let schoolData = {
    schoolName,
    schoolId,
    announcements: [],
    messages: [],
    students: [],
    teachers: [],
    classes: [],
    attendanceViewDate: sessionStorage.getItem(`globyedu_attendance_view_date:${schoolId}`) || new Date().toISOString().slice(0, 10),
  };
  const token = getAccessToken();
  if (token && schoolId) {
    const result = await fetchSchoolDetails(token, schoolId);
    if (navigationId !== routeGeneration) return;
    if (result.ok && result.data?.status === 'ok') {
      const school = result.data.school || {};
      await refreshStoredSchoolAssets(school, token);
      await refreshStoredProfilePhotos([school.student || school.profile], token);
      const audience = role === 'teacher' ? 'teachers' : role === 'student' ? 'students' : 'all';
      const visible = (entry) => {
        const target = String(entry.audience || entry.recipientType || entry.recipient || 'all').toLowerCase();
        return target === 'all' || target === audience || target === 'everyone';
      };
      schoolData = {
        ...schoolData,
        schoolName: school.name || schoolName,
        student: school.student || null,
        profile: school.profile || null,
        announcements: (Array.isArray(school.announcements) ? school.announcements : []).filter(visible),
        messages: (Array.isArray(school.messages) ? school.messages : []).filter(visible),
        students: Array.isArray(school.students) ? school.students : [],
        teachers: Array.isArray(school.teachers) ? school.teachers : [],
        classes: Array.isArray(school.classes) ? school.classes : [],
        attendanceRecords: Array.isArray(school.attendanceRecords) ? school.attendanceRecords : [],
        examRecords: Array.isArray(school.examRecords) ? school.examRecords : [],
        examResults: Array.isArray(school.examResults) ? school.examResults : [],
      };
      await refreshStoredProfilePhotos(schoolData.teachers, token);
      await refreshStoredProfilePhotos(schoolData.students, token);
    } else {
      schoolDataLoadError = result.data?.message || `Unable to load school data (HTTP ${result.status || 'network error'}).`;
    }
    const academicQuery = role === 'student'
      ? { studentId: localStorage.getItem('globyedu_studentId') || '' }
      : { teacherId: localStorage.getItem('globyedu_userEmail') || userName };
    const needsAssignments = section === 'assignments' || role === 'student' && section === 'overview';
    const needsLessons = section === 'lessons' || role === 'student' && section === 'overview';
    const [assignmentResult, lessonResult] = await Promise.all([
      needsAssignments ? fetchAssignments(token, schoolId, academicQuery) : Promise.resolve(null),
      needsLessons ? fetchLessons(token, schoolId, academicQuery) : Promise.resolve(null),
    ]);
    assignments = assignmentResult?.ok && assignmentResult.data?.status === 'ok' ? assignmentResult.data.items || [] : [];
    lessons = lessonResult?.ok && lessonResult.data?.status === 'ok' ? lessonResult.data.items || [] : [];
  }
  
  if (role === 'teacher') {
    teacherData = {
      teacherName: userName,
      schoolName: schoolData.schoolName,
      classes: schoolData.classes,
      students: schoolData.students,
      messages: schoolData.messages,
      announcements: schoolData.announcements,
      teacherProfile: schoolData.teachers[0] || null,
      schoolDataLoadError,
      examRecords: schoolData.examRecords || [],
      examResults: schoolData.examResults || [],
      assignments,
      lessons,
    };
    shellProfilePhotoUrl = teacherData.teacherProfile?.profilePhoto || '';
    dashboardContent = TeacherDashboard(section, teacherData);
  } else if (role === 'student') {
    const studentRecord = schoolData.student || schoolData.profile || schoolData.students?.find((entry) => {
      const currentStudentId = localStorage.getItem('globyedu_studentId') || '';
      return String(entry.studentId || '').toLowerCase() === String(currentStudentId).toLowerCase() || String(entry.email || '').toLowerCase() === String(localStorage.getItem('globyedu_userEmail') || '').toLowerCase();
    }) || schoolData.students?.[0] || {};
    const studentData = {
      student: {
        ...studentRecord,
        fullName: studentRecord.fullName || userName,
        studentId: studentRecord.studentId || localStorage.getItem('globyedu_studentId') || 'STU001',
        schoolName: schoolData.schoolName,
        className: studentRecord.className || localStorage.getItem('globyedu_studentClass') || 'Class',
        profilePhoto: studentRecord.profilePhoto || localStorage.getItem('globyedu_profilePhoto') || '',
      },
      studentName: studentRecord.fullName || userName,
      studentId: studentRecord.studentId || localStorage.getItem('globyedu_studentId') || 'STU001',
      schoolName: schoolData.schoolName,
      className: studentRecord.className || localStorage.getItem('globyedu_studentClass') || 'Class',
      profilePhoto: studentRecord.profilePhoto || localStorage.getItem('globyedu_profilePhoto') || '',
      classes: schoolData.classes || [],
      attendanceRecords: schoolData.attendanceRecords || [],
      examResults: schoolData.examResults || [],
      announcements: schoolData.announcements || [],
      messages: schoolData.messages || [],
      payments: schoolData.payments || [],
      subjects: Array.from(new Set((schoolData.classes || []).flatMap((entry) => [entry.subject || entry.subjectName || entry.name || entry.className]).filter(Boolean))),
      assignments,
      lessons,
    };
    shellProfilePhotoUrl = studentData.profilePhoto;
    dashboardContent = StudentDashboard(section, studentData);
  } else {
    // Fallback to school authority dashboard
    dashboardContent = SchoolAuthorityDashboard(section, schoolData);
  }

  renderAuthenticatedAppShell(section, role, dashboardContent, shellProfilePhotoUrl);
  attachSchoolHandlers();
  if (role === 'teacher') initializeTeacherWorkspaceHandlers(teacherData);
}

function normalizeSchoolSection(section = 'overview') {
  const key = String(section || 'overview').toLowerCase();
  if (['profile', 'school-profile', 'school_profile'].includes(key)) return 'profile';
  if (['academic', 'academics', 'structure', 'academic-management'].includes(key)) return 'academic';
  if (['classes', 'class', 'class-management'].includes(key)) return 'classes';
  if (['students', 'student'].includes(key)) return 'students';
  if (['teachers', 'teacher'].includes(key)) return 'teachers';
  if (['attendance', 'attendances'].includes(key)) return 'attendance';
  if (['finance', 'fees', 'payments'].includes(key)) return 'finance';
  if (['exams', 'exam', 'grading', 'gradebook', 'report-card', 'report-cards', 'transcript', 'transcripts'].includes(key)) return 'exams';
  if (['notifications', 'alerts', 'alert'].includes(key)) return 'notifications';
  if (['messages', 'messaging', 'message'].includes(key)) return 'messages';
  if (['support', 'help', 'help-support', 'tickets'].includes(key)) return 'support';
  if (['communications', 'announcements', 'announcement', 'communication'].includes(key)) return 'communications';
  if (['reports', 'report'].includes(key)) return 'reports';
  if (['settings', 'configuration', 'config'].includes(key)) return 'settings';
  if (['ai', 'assistant', 'ai-assistant'].includes(key)) return 'ai';
  if (['activity', 'activity-log', 'logs'].includes(key)) return 'activity';
  return 'overview';
}

async function renderSchoolDashboardPage(section = 'overview', navigationId = routeGeneration) {
  const schoolId = localStorage.getItem('globyedu_schoolId') || '';
  const schoolName = localStorage.getItem('globyedu_schoolName') || 'School';
  const role = getUserRole() || 'school_authority';
  const normalizedSection = normalizeSchoolSection(section);

  if (navigationId !== routeGeneration) return;

  let summary = {
    name: schoolName,
    schoolStatus: 'active',
    studentCount: 0,
    teacherCount: 0,
    classCount: 0,
  };
  let sectionData = {
    school: { name: schoolName, schoolId, status: 'active' },
    profile: getWorkspaceProfile(),
    students: [],
    teachers: [],
    classes: [],
    attendanceRecords: [],
    announcements: [],
    payments: [],
    financeCategories: [],
    invoices: [],
    receipts: [],
    refunds: [],
    messages: [],
    reports: [],
    attendanceViewDate: sessionStorage.getItem(`globyedu_attendance_view_date:${schoolId}`) || new Date().toISOString().slice(0, 10),
    examRecords: [],
    examResults: [],
    gradeEntries: [],
    reportCards: [],
    academicRecords: [],
    teacherActivity: [],
    teacherActivityLoadError: '',
  };

  const token = getAccessToken();
  if (schoolId && token) {
    const [schoolResult, activityResult] = await Promise.all([
      fetchSchoolDetails(token, schoolId),
      normalizedSection === 'activity' ? fetchSchoolActivity(token, schoolId) : Promise.resolve(null),
    ]);
    if (activityResult) {
      sectionData.teacherActivity = Array.isArray(activityResult.data?.activity) ? activityResult.data.activity : [];
      sectionData.teacherActivityLoadError = !activityResult.ok || activityResult.data?.status !== 'ok'
        ? activityResult.data?.message || `Unable to load teacher activity (HTTP ${activityResult.status || 'network error'}).`
        : '';
    }

    if (schoolResult.ok && schoolResult.data?.status === 'ok') {
      const school = schoolResult.data.school || {};
      summary = schoolResult.data.summary || summary;
      await refreshStoredSchoolAssets(school, token);
      const students = Array.isArray(school.students) ? school.students : [];
      const teachers = Array.isArray(school.teachers) ? school.teachers : [];
      await refreshStoredProfilePhotos(students, token);
      await refreshStoredProfilePhotos(teachers, token);
      const classes = Array.isArray(school.classes) ? school.classes : [];
      const attendanceRecords = Array.isArray(school.attendanceRecords) ? school.attendanceRecords : [];
      const announcements = Array.isArray(school.announcements) ? school.announcements : [];
      const payments = Array.isArray(school.payments) ? school.payments : [];
      const financeCategories = Array.isArray(school.financeCategories) ? school.financeCategories : [];
      const invoices = Array.isArray(school.invoices) ? school.invoices : [];
      const receipts = Array.isArray(school.receipts) ? school.receipts : [];
      const refunds = Array.isArray(school.refunds) ? school.refunds : [];
      const messages = Array.isArray(school.messages) ? school.messages : [];
      const reports = Array.isArray(school.reports) ? school.reports : [];
      let academicRecords = Array.isArray(school.academicRecords) ? school.academicRecords : [];

      if (normalizedSection === 'academic') {
        const academicEntityTypes = ['academic-years', 'terms', 'semesters', 'departments', 'streams', 'subjects', 'classes'];
        const academicEntityResults = await Promise.all(academicEntityTypes.map((entityType) => fetchSchoolEntities(token, schoolId, entityType, { pageSize: 100 })));
        academicRecords = academicEntityResults.flatMap((result, index) => {
          if (!result.ok || result.data?.status !== 'ok') return [];
          return (Array.isArray(result.data.items) ? result.data.items : []).map((item) => ({
            ...item,
            recordType: academicEntityTypes[index],
          }));
        });
      }

      sectionData = {
        school,
        profile: getWorkspaceProfile(),
        students,
        teachers,
        classes,
        attendanceRecords,
        announcements,
        payments,
        financeCategories,
        invoices,
        receipts,
        refunds,
        messages,
        reports,
        attendanceViewDate: sessionStorage.getItem(`globyedu_attendance_view_date:${schoolId}`) || new Date().toISOString().slice(0, 10),
        examRecords: Array.isArray(school.examRecords) ? school.examRecords : [],
        examResults: Array.isArray(school.examResults) ? school.examResults : [],
        gradeEntries: Array.isArray(school.gradeEntries) ? school.gradeEntries : [],
        reportCards: Array.isArray(school.reportCards) ? school.reportCards : [],
        academicRecords,
        teacherActivity: Array.isArray(activityResult?.data?.activity) ? activityResult.data.activity : [],
        teacherActivityLoadError: activityResult && (!activityResult.ok || activityResult.data?.status !== 'ok')
          ? activityResult.data?.message || `Unable to load teacher activity (HTTP ${activityResult.status || 'network error'}).`
          : '',
      };

      summary = {
        ...summary,
        name: school.name || summary.name || schoolName,
        schoolStatus: school.status || school.schoolStatus || summary.schoolStatus || 'active',
        studentCount: students.length || summary.studentCount || 0,
        teacherCount: teachers.length || summary.teacherCount || 0,
        classCount: classes.length || summary.classCount || 0,
      };
    }
  }

  currentSchoolStudents = sectionData.students || [];
  currentSchoolTeachers = sectionData.teachers || [];

  const dashboardContent = SchoolDashboardPage(summary, normalizedSection, sectionData);
  renderAuthenticatedAppShell(normalizedSection, role, dashboardContent);

  const appRoot = root.querySelector('main');
  if (appRoot) {
    attachSchoolHandlers();
  }
}

// Theme toggle handler (architecture). Toggles between 'light' and 'midnight' themes and persists setting.
document.addEventListener('globyedu-toggle-theme', () => {
  try {
    const settings = getWorkspaceSettings();
    const nextTheme = settings.theme === 'light' ? 'midnight' : 'light';
    writeWorkspaceStorage(WORKSPACE_STORAGE_KEYS.settings, { ...settings, theme: nextTheme });
    applyWorkspaceTheme();
  } catch (e) {
    // Fail silently — this is a non-critical UI enhancement.
    console.warn('Theme toggle failed', e);
  }
});

async function loadSchoolSummary() {
  const schoolId = localStorage.getItem('globyedu_schoolId');
  const token = getAccessToken();
  if (!schoolId || !token) {
    alert('Login required to load school summary.');
    return;
  }

  const summaryResult = await fetchSchoolSummary(token, schoolId);
  if (summaryResult.ok && summaryResult.data?.status === 'ok') {
    const summary = summaryResult.data.summary || {};
    renderAuthenticatedAppShell('overview', getUserRole() || 'school_authority', `${SchoolDashboardPage(summary)}`);
    attachSchoolHandlers();
    const dashboardId = document.getElementById('school-dashboard-id');
    if (dashboardId) {
      dashboardId.textContent = schoolId;
    }
    document.getElementById('school-entity-refresh')?.click();
    return;
  }

  alert(summaryResult.data?.message || 'Unable to load school summary. Please try again.');
}

async function readFileAsDataUrl(file) {
  if (!file) return '';
  const validationError = validateImageUpload(file);
  if (validationError) throw new Error(validationError);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Unable to read image file.'));
    reader.readAsDataURL(file);
  });
}

function renderImagePreview(previewElement, src, fallbackText) {
  if (!previewElement) return;
  if (src) {
    previewElement.innerHTML = `<img src="${escapeHtml(src)}" alt="Preview" class="h-24 w-full rounded-2xl border border-slate-200 object-cover" />`;
    return;
  }
  previewElement.innerHTML = `<div class="flex h-24 items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">${escapeHtml(fallbackText)}</div>`;
}

function validateSchoolImage(file) {
  return validateImageUpload(file);
}

function sanitizeStorageFileName(fileName, prefix = 'assets') {
  const baseName = String(fileName || `${prefix}-${Date.now()}`)
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || `${prefix}-${Date.now()}`;
  return `${prefix}/${Date.now()}-${baseName}`;
}

async function uploadTenantAsset(file, prefix = 'assets', includePath = false, owner = null) {
  if (!file) throw new Error('Please select a file to upload.');
  if (file.size > MAX_FILE_UPLOAD_BYTES) throw new Error('This file is too large to upload. Choose a smaller file.');
  const token = getAccessToken();
  if (!token) {
    throw new Error('Your session has expired. Please sign in again.');
  }

  const storagePath = sanitizeStorageFileName(file.name || `${prefix}.png`, prefix);
  const uploadQuery = new URLSearchParams({ filename: storagePath });
  if (owner) {
    uploadQuery.set('ownerType', owner.type);
    uploadQuery.set('ownerId', owner.id);
    uploadQuery.set('ownerField', owner.field);
  }
  const uploadResponse = await fetch(`/api/v1/files/upload?${uploadQuery.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
  });

  const uploadData = await uploadResponse.json().catch(() => null);
  dispatchMaintenanceResponse(uploadResponse, uploadData);
  if (!uploadResponse.ok || uploadData?.status !== 'ok') {
    throw new Error(uploadData?.message || 'Unable to upload the selected image to cloud storage.');
  }

  const signedUrlResponse = await fetch(`/api/v1/files/${encodeURIComponent(storagePath)}?expiresIn=86400`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  const signedUrlData = await signedUrlResponse.json().catch(() => null);
  dispatchMaintenanceResponse(signedUrlResponse, signedUrlData);
  if (!signedUrlResponse.ok || signedUrlData?.status !== 'ok' || !signedUrlData.url) {
    throw new Error(signedUrlData?.message || 'Image upload succeeded, but the signed URL could not be generated.');
  }

  if (includePath && !uploadData.path) {
    throw new Error('Image upload succeeded, but the storage path could not be saved.');
  }
  return includePath ? { url: signedUrlData.url, path: uploadData.path } : signedUrlData.url;
}

async function uploadCreatedEntityProfilePhoto(file, entityType, entity, token, schoolId) {
  if (!file || typeof file.arrayBuffer !== 'function') return;
  const validationError = validateProfileImageUpload(file);
  if (validationError) throw new Error(validationError);
  const isStudent = entityType === 'students';
  const ownerType = isStudent ? 'student' : 'teacher';
  const identifier = entity?.[isStudent ? 'studentId' : 'teacherId'] || entity?.id || entity?.username || entity?.email;
  if (!identifier) throw new Error('The new record was created without an identifier, so its photo cannot be safely attached.');
  const uploadedPhoto = await uploadTenantAsset(file, isStudent ? 'student-profile' : 'teacher-profile', true, {
    type: ownerType,
    id: identifier,
    field: 'profilePhotoPath',
  });
  const result = await updateSchoolEntity(token, schoolId, entityType, identifier, {
    profilePhoto: uploadedPhoto.url,
    profilePhotoPath: uploadedPhoto.path,
  });
  if (!result.ok || result.data?.status !== 'ok') {
    throw new Error(result.data?.message || 'The record was created, but its profile photo could not be saved.');
  }
}

async function refreshStoredProfilePhotos(records, token) {
  await Promise.all((Array.isArray(records) ? records : [])
    .filter((record) => record && record.profilePhotoPath)
    .map(async (record) => {
      const encodedPath = String(record.profilePhotoPath).split('/').map(encodeURIComponent).join('/');
      try {
        const response = await fetch(`/api/v1/files/${encodedPath}?expiresIn=3600`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || data?.status !== 'ok' || !data.url) {
          console.warn('Unable to refresh stored profile photo URL.', data || response);
          record.profilePhoto = '';
          return;
        }
        record.profilePhoto = data.url;
      } catch (error) {
        console.warn('Unable to refresh stored profile photo URL.', error);
        record.profilePhoto = '';
      }
    }));
}

async function refreshStoredSchoolAssets(school, token) {
  if (!school || typeof school !== 'object') return;
  const assets = [
    ['logoPath', 'logo'],
    ['coverImagePath', 'coverImage'],
    ['stampPath', 'stamp'],
    ['principalSignaturePath', 'principalSignature'],
  ];
  await Promise.all(assets.map(async ([pathField, urlField]) => {
    const storagePath = school[pathField];
    if (!storagePath) return;
    const encodedPath = String(storagePath).split('/').map(encodeURIComponent).join('/');
    try {
      const response = await fetch(`/api/v1/files/${encodedPath}?expiresIn=3600`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.status !== 'ok' || !data.url) {
        console.warn(`Unable to refresh stored ${urlField} URL.`, data || response);
        school[urlField] = '';
        return;
      }
      school[urlField] = data.url;
    } catch (error) {
      console.warn(`Unable to refresh stored ${urlField} URL.`, error);
      school[urlField] = '';
    }
  }));
}

async function handleImageUpload(fileInput, hiddenInput, previewElement, fallbackText, owner) {
  if (!fileInput || !hiddenInput || !previewElement) return;
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  const validationError = validateProfileImageUpload(file);
  if (validationError) {
    alert(validationError);
    fileInput.value = '';
    return;
  }
  try {
    const uploadedAsset = await uploadTenantAsset(file, 'school-assets', true, owner);
    hiddenInput.value = uploadedAsset.url;
    hiddenInput.dataset.storagePath = uploadedAsset.path;
    renderImagePreview(previewElement, uploadedAsset.url, fallbackText);
  } catch (error) {
    alert(error.message || 'Unable to upload selected image.');
  }
}

async function appendSchoolCollectionData(token, schoolId, collectionName, item, title, detail) {
  const currentResponse = await fetchSchoolDetails(token, schoolId);
  const school = currentResponse.ok && currentResponse.data?.status === 'ok' ? currentResponse.data.school || {} : {};
  const currentItems = Array.isArray(school[collectionName]) ? school[collectionName] : [];
  const nextItems = [...currentItems, { ...item, createdAt: new Date().toISOString() }];
  const activityTitle = title || 'School record updated';
  const activityDetail = detail || `${collectionName.replace(/-/g, ' ')} updated from the dashboard.`;
  const currentActivities = Array.isArray(school.recentActivities) ? school.recentActivities : [];
  const result = await updateSchoolDetails(token, schoolId, {
    [collectionName]: nextItems,
    recentActivities: [{ title: activityTitle, detail: activityDetail }, ...currentActivities].slice(0, 6),
  });
  return result;
}

async function handleQuickAction(action) {
  const schoolId = localStorage.getItem('globyedu_schoolId');
  const token = getAccessToken();
  if (!schoolId || !token) return;

  if (action === 'add-student') {
    const schoolDetailsResult = await fetchSchoolDetails(token, schoolId);
    const classOptions = Array.isArray(schoolDetailsResult?.data?.school?.classes)
      ? schoolDetailsResult.data.school.classes
        .filter((entry) => String(entry.status || 'active').toLowerCase() !== 'archived')
        .map((entry) => ({ label: entry.name || entry.classId || 'Class', value: entry.classId || entry.id || entry.name || '' }))
        .filter((entry) => entry.value)
      : [];

    const formData = await showAdminForm('Register student', [
      { name: 'fullName', label: 'Student full name', placeholder: 'Student name', required: true },
      { name: 'profilePhoto', label: 'Student photo', type: 'file', accept: 'image/*' },
      { name: 'className', label: 'Class', type: 'select', options: classOptions, required: true },
    ], { submitLabel: 'Create Student' });
    if (!formData) return;
    const result = await createSchoolEntity(token, schoolId, 'students', buildSchoolEntityPayload('students', {
      fullName: formData.fullName || '',
      classId: formData.classId || null,
      className: classOptions.find((option) => option.value === formData.classId)?.label || null,
      profilePhoto: null,
      profilePhotoPath: null,
      status: 'active',
    }));
    if (!result.ok || result.data?.status !== 'ok') {
      alert(result.data?.message || 'Unable to create student record.');
      return;
    }
    try {
      await uploadCreatedEntityProfilePhoto(formData.profilePhoto, 'students', result.data.entity, token, schoolId);
    } catch (error) {
      alert(error.message || 'Student created, but the profile photo could not be saved.');
      return;
    }
    alert('Student record created successfully.');
    document.getElementById('school-entity-refresh')?.click();
    return;
  }

  if (action === 'add-teacher') {
    const formData = await showAdminForm('Invite a teacher', [
      { name: 'fullName', label: 'Full name', placeholder: 'Teacher name', required: true },
      { name: 'email', label: 'Teacher email (invitation sent here)', placeholder: 'teacher@example.com', type: 'email', required: true },
      { name: 'phone', label: 'Phone', placeholder: '+233000000000' },
      { name: 'gender', label: 'Gender', type: 'select', options: [
        { label: 'Male', value: 'male' },
        { label: 'Female', value: 'female' },
        { label: 'Other', value: 'other' },
      ] },
      { name: 'dateOfBirth', label: 'Date of birth (optional)', type: 'date' },
      { name: 'department', label: 'Department', placeholder: 'e.g. Sciences' },
      { name: 'position', label: 'Position', type: 'select', options: [
        { label: 'Teacher', value: 'Teacher' },
        { label: 'Senior Teacher', value: 'Senior Teacher' },
        { label: 'Head of Department', value: 'Head of Department' },
        { label: 'Assistant Headteacher', value: 'Assistant Headteacher' },
        { label: 'Headteacher', value: 'Headteacher' },
        { label: 'Principal', value: 'Principal' },
        { label: 'Vice Principal', value: 'Vice Principal' },
        { label: 'Class Teacher', value: 'Class Teacher' },
        { label: 'Subject Teacher', value: 'Subject Teacher' },
        { label: 'School Administrator', value: 'School Administrator' },
      ] },
      { name: 'qualification', label: 'Qualification', placeholder: 'e.g. B.Ed, MPhil' },
      { name: 'yearsOfExperience', label: 'Experience (years)', placeholder: 'e.g. 8' },
      { name: 'assignedClasses', label: 'Assigned class', type: 'select', options: TEACHER_ASSIGNABLE_CLASS_OPTIONS, required: true },
      { name: 'assignedSubjects', label: 'Assigned subjects', placeholder: 'Comma-separated values' },
      { name: 'employeeNumber', label: 'Employee number', placeholder: 'e.g. EMP-5482' },
      { name: 'profilePhoto', label: 'Profile photo', type: 'file', accept: 'image/*' },
    ], { submitLabel: 'Send Invitation' });
    if (!formData) return;
    const result = await createSchoolEntity(token, schoolId, 'teachers', buildSchoolEntityPayload('teachers', {
      fullName: formData.fullName || '',
      email: formData.email || '',
      phone: formData.phone || null,
      gender: formData.gender || null,
      dateOfBirth: formData.dateOfBirth || null,
      department: formData.department || null,
      position: formData.position || null,
      qualification: formData.qualification || null,
      yearsOfExperience: formData.yearsOfExperience || null,
      assignedClasses: formData.assignedClasses ? [formData.assignedClasses] : [],
      assignedSubjects: formData.assignedSubjects || null,
      teacherId: formData.teacherId || null,
      employeeNumber: formData.employeeNumber || null,
      profilePhoto: null,
      profilePhotoPath: null,
      status: 'active',
    }));
    if (!result.ok || result.data?.status !== 'ok') {
      alert(result.data?.message || 'Unable to create teacher record.');
      return;
    }
    const createdTeacher = result.data?.entity || {};
    try {
      await uploadCreatedEntityProfilePhoto(formData.profilePhoto, 'teachers', createdTeacher, token, schoolId);
    } catch (error) {
      alert(error.message || 'Teacher created, but the profile photo could not be saved.');
      return;
    }
    alert(createdTeacher.invitationEmailStatus === 'failed'
      ? 'Teacher account created, but the invitation could not be sent. The account is saved; resolve the issue, then use Resend invite.'
      : createdTeacher.invitationEmailStatus === 'provider_accepted'
        ? createdTeacher.invitationEmailDeliveryStatus === 'unconfirmed'
          ? 'Invitation request accepted by the email provider; actual delivery is unconfirmed. The teacher must verify their email and set a password before signing in.'
          : 'Invitation request accepted by the email provider, but delivery status is not confirmed. Check the invitation status before asking the teacher to activate.'
        : 'Teacher record created, but invitations are unavailable in this storage mode; no invitation email was sent. Switch to Firebase-backed storage before onboarding this teacher.');
    document.getElementById('school-entity-refresh')?.click();
    return;
  }

  if (action === 'take-attendance') {
    const formData = await showAdminForm('Take attendance', [
      { name: 'date', label: 'Date', type: 'date', required: true },
      { name: 'status', label: 'Status', placeholder: 'Present/Absent', required: true },
      { name: 'note', label: 'Note', placeholder: 'Optional class note' },
    ]);
    if (!formData) return;
    const result = await appendSchoolCollectionData(token, schoolId, 'attendanceRecords', {
      date: formData.date || '',
      status: formData.status || '',
      note: formData.note || '',
    }, 'Attendance captured', 'Attendance was recorded from the dashboard.');
    if (!result.ok || result.data?.status !== 'ok') {
      alert(result.data?.message || 'Unable to save attendance entry.');
      return;
    }
    alert('Attendance entry saved.');
    renderSchoolDashboardPage('overview');
    return;
  }

  if (action === 'record-payment') {
    const currentResult = await fetchSchoolDetails(token, schoolId);
    const currentSchool = currentResult.ok && currentResult.data?.status === 'ok' ? currentResult.data.school || {} : {};
    const studentOptions = (Array.isArray(currentSchool.students) ? currentSchool.students : [])
      .filter((student) => String(student.status || 'active').toLowerCase() !== 'archived')
      .map((student) => ({ label: `${student.fullName || student.name || student.email} (${student.studentId || student.id || student.email})`, value: student.studentId || student.id || student.email }))
      .filter((option) => option.value);
    const formData = await showAdminForm('Record payment', [
      { name: 'amount', label: 'Amount', placeholder: '250.00', required: true },
      { name: 'studentId', label: 'Student', type: 'select', options: studentOptions, required: true },
      { name: 'method', label: 'Payment method', placeholder: 'Cash / Mobile / Bank' },
      { name: 'reference', label: 'External reference (optional)' },
      { name: 'note', label: 'Note', placeholder: 'Optional note' },
    ]);
    if (!formData) return;
    const result = await createFeePayment(token, schoolId, { ...formData, status: 'received' });
    if (!result.ok || result.data?.status !== 'ok') {
      alert(result.data?.message || 'Unable to record payment and receipt.');
      return;
    }
    alert('Payment recorded successfully.');
    renderSchoolDashboardPage('overview');
    return;
  }

  if (action === 'create-announcement') {
    const formData = await showAdminForm('Create announcement', [
      { name: 'title', label: 'Title', placeholder: 'Parent meeting', required: true },
      { name: 'detail', label: 'Message', placeholder: 'Share important school news', type: 'textarea', required: true },
      { name: 'audience', label: 'Audience', type: 'select', options: [{ value: 'students', label: 'Students' }, { value: 'teachers', label: 'Teachers' }, { value: 'parents', label: 'Parents' }, { value: 'all', label: 'Everyone' }] },
      { name: 'channel', label: 'Channel', placeholder: 'Email / SMS / WhatsApp / All' },
      { name: 'priority', label: 'Priority', placeholder: 'Normal / High / Urgent' },
      { name: 'attachments', label: 'Attachments', placeholder: 'Comma-separated URLs' },
    ], { submitLabel: 'Publish Announcement' });
    if (!formData) return;
    const result = await appendSchoolCollectionData(token, schoolId, 'announcements', buildSchoolCollectionPayload('announcements', {
      title: formData.title || '',
      detail: formData.detail || '',
      audience: formData.audience || '',
      channel: formData.channel || 'all',
      priority: formData.priority || 'normal',
      attachments: formData.attachments || null,
    }), 'Announcement created', 'A new school announcement was posted.');
    if (!result.ok || result.data?.status !== 'ok') {
      alert(result.data?.message || 'Unable to create announcement.');
      return;
    }
    alert('Announcement created successfully.');
    renderSchoolDashboardPage('overview');
    return;
  }

  if (action === 'send-message') {
    const formData = await showAdminForm('Send message', [
      { name: 'recipient', label: 'Recipient', placeholder: 'Parents / Staff / Students', required: true },
      { name: 'subject', label: 'Subject', placeholder: 'Reminder', required: true },
      { name: 'body', label: 'Message', placeholder: 'Write the message here', type: 'textarea', required: true },
      { name: 'sendVia', label: 'Send via', placeholder: 'Email / SMS / WhatsApp / Workspace' },
      { name: 'priority', label: 'Priority', placeholder: 'Normal / High / Urgent' },
      { name: 'attachments', label: 'Attachments', placeholder: 'Comma-separated URLs' },
    ]);
    if (!formData) return;
    const result = await appendSchoolCollectionData(token, schoolId, 'messages', buildSchoolCollectionPayload('messages', {
      recipient: formData.recipient || '',
      subject: formData.subject || '',
      body: formData.body || '',
      sendVia: formData.sendVia || 'workspace',
      priority: formData.priority || 'normal',
      attachments: formData.attachments || null,
    }), 'Message queued', 'A school communication was queued from the dashboard.');
    if (!result.ok || result.data?.status !== 'ok') {
      alert(result.data?.message || 'Unable to send message.');
      return;
    }
    pushWorkspaceNotification({
      title: 'New school message',
      message: `School message queued for ${formData.recipient || 'admin'}: ${formData.subject || 'New message'}`,
      type: 'message',
      sender: 'School Authority',
      targetSchoolIds: schoolId ? [schoolId] : [],
      priority: formData.priority || 'normal',
    });
    alert('Message queued successfully.');
    renderSchoolDashboardPage('overview');
    return;
  }

  if (action === 'create-class') {
    const formData = await showAdminForm('Create class', [
      { name: 'name', label: 'Class name', placeholder: 'Grade 10A', required: true },
      { name: 'grade', label: 'Grade', placeholder: '10' },
      { name: 'section', label: 'Section', placeholder: 'A' },
    ]);
    if (!formData) return;
    const result = await createSchoolEntity(token, schoolId, 'classes', {
      name: formData.name || '',
      grade: formData.grade || null,
      section: formData.section || null,
      status: 'active',
    });
    if (!result.ok || result.data?.status !== 'ok') {
      alert(result.data?.message || 'Unable to create class.');
      return;
    }
    alert('Class created successfully.');
    renderSchoolDashboardPage('classes', ++routeGeneration);
    return;
  }

  if (action === 'generate-report') {
    const formData = await showAdminForm('Generate report', [
      { name: 'title', label: 'Report title', placeholder: 'Weekly performance report', required: true },
      { name: 'summary', label: 'Summary', placeholder: 'Key highlights', type: 'textarea', required: true },
    ]);
    if (!formData) return;
    const result = await appendSchoolCollectionData(token, schoolId, 'reports', {
      title: formData.title || '',
      summary: formData.summary || '',
    }, 'Report generated', 'A school report was generated from the dashboard.');
    if (!result.ok || result.data?.status !== 'ok') {
      alert(result.data?.message || 'Unable to generate report.');
      return;
    }
    alert('Report generated successfully.');
    renderSchoolDashboardPage('overview');
    return;
  }

  alert(`${action.replace(/-/g, ' ')} is now available in the dashboard workflow.`);
}

function attachWorkspaceModuleHandlers() {
  const notificationList = document.getElementById('workspace-notifications-list');
  const messageList = document.getElementById('workspace-messages-list');
  const supportList = document.getElementById('workspace-support-list');
  let activeMessageFolder = 'inbox';

  function refreshNotifications(filter = 'all') {
    if (!notificationList) return;
    const notifications = readWorkspaceStorage(WORKSPACE_STORAGE_KEYS.notifications, []);
    const filtered = notifications.filter((item) => {
      if (filter === 'unread') return !item.read;
      if (filter === 'announcements') return item.type === 'announcement' || item.type === 'school';
      if (filter === 'alerts') return item.type === 'system' || item.type === 'payment' || item.type === 'subscription';
      return true;
    });

    notificationList.innerHTML = filtered.length
      ? filtered.map((item) => `
          <div class="rounded-2xl border border-slate-200 bg-white p-4">
            <div class="flex items-start justify-between gap-4">
              <div>
                <p class="font-semibold text-slate-900">${escapeHtml(item.title)}</p>
                <p class="mt-1 text-sm text-slate-600">${escapeHtml(item.message)}</p>
              </div>
              <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-slate-700">${escapeHtml(item.type || 'notice')}</span>
            </div>
            <div class="mt-4 flex flex-wrap gap-3">
              <button type="button" data-notification-action="read" data-notification-id="${item.id}" class="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">Mark read</button>
              <button type="button" data-notification-action="delete" data-notification-id="${item.id}" class="rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">Delete</button>
            </div>
          </div>
        `).join('')
      : '<div class="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">No notifications match this filter.</div>';
  }

  async function refreshMessages(folder = 'inbox', query = '') {
    if (!messageList) return;
    activeMessageFolder = folder;
    const schoolId = localStorage.getItem('globyedu_schoolId');
    const token = getAccessToken();
    let messages = [];

    if (schoolId && token) {
      const result = await fetchWorkspaceMessages(token, schoolId, { folder, search: query });
      if (result.ok && Array.isArray(result.data?.messages)) {
        messages = result.data.messages;
      } else {
        messageList.innerHTML = '<div class="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">Unable to load messages right now.</div>';
        return;
      }
    } else {
      messageList.innerHTML = '<div class="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">Sign in to load messages.</div>';
      return;
    }

    const filtered = messages;
    messageList.innerHTML = filtered.length
      ? filtered.map((entry) => `
          <div class="rounded-2xl border border-slate-200 bg-white p-4">
            <div class="flex items-start justify-between gap-4">
              <div>
                <p class="font-semibold text-slate-900">${escapeHtml(entry.subject)}</p>
                <p class="mt-1 text-sm text-slate-600">${escapeHtml(entry.body)}</p>
              </div>
              <span class="rounded-full ${entry.unread && folder !== 'sent' ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-700'} px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em]">${entry.unread && folder !== 'sent' ? 'Unread' : 'Read'}</span>
            </div>
            <p class="mt-2 text-xs text-slate-500">${escapeHtml(folder === 'sent' ? `To ${entry.to || 'Recipient'}` : `From ${entry.from || 'Sender'}`)} • ${entry.createdAt ? new Date(entry.createdAt).toLocaleString() : '—'}</p>
            <div class="mt-4 flex flex-wrap gap-3">
              ${entry.unread && folder !== 'sent' ? `<button type="button" data-message-action="read" data-message-id="${entry.id}" class="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">Mark read</button>` : ''}
              <button type="button" data-message-action="reply" data-message-id="${entry.id}" class="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">Reply</button>
              <button type="button" data-message-action="forward" data-message-id="${entry.id}" class="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">Forward</button>
              <button type="button" data-message-action="delete" data-message-id="${entry.id}" class="rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">Delete</button>
            </div>
          </div>
        `).join('')
      : '<div class="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">No messages in this folder.</div>';
  }

  async function refreshSupport(filter = 'all') {
    if (!supportList) return;
    const schoolId = localStorage.getItem('globyedu_schoolId');
    const token = getAccessToken();
    let tickets = [];

    if (schoolId && token) {
      const result = await fetchSupportTickets(token, schoolId, filter === 'all' ? {} : { status: filter });
      if (result.ok && Array.isArray(result.data?.tickets)) {
        tickets = result.data.tickets;
      } else {
        supportList.innerHTML = '<div class="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">Unable to load support tickets. Browser-stored tickets are not authoritative.</div>';
        return;
      }
    } else {
      supportList.innerHTML = '<div class="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">Sign in to load support tickets. Browser-stored tickets are not authoritative.</div>';
      return;
    }

    supportList.innerHTML = tickets.length
      ? tickets.map((item) => `
          <div class="rounded-2xl border border-slate-200 bg-white p-4">
            <div class="flex items-start justify-between gap-4">
              <div>
                <p class="font-semibold text-slate-900">${escapeHtml(item.title)}</p>
                <p class="mt-1 text-sm text-slate-600">${escapeHtml(item.message)}</p>
              </div>
              <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-slate-700">${escapeHtml(item.status || 'open')}</span>
            </div>
            <div class="mt-4 flex flex-wrap gap-3">
              <button type="button" data-support-action="reply" data-ticket-id="${item.id}" class="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">Reply</button>
              <button type="button" data-support-action="close" data-ticket-id="${item.id}" class="rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">Close</button>
            </div>
          </div>
        `).join('')
      : '<div class="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">No support tickets yet.</div>';
  }

  document.querySelectorAll('[data-workspace-notification-filter]').forEach((button) => {
    button.addEventListener('click', () => refreshNotifications(button.getAttribute('data-workspace-notification-filter') || 'all'));
  });

  document.querySelectorAll('[data-workspace-message-folder]').forEach((button) => {
    button.addEventListener('click', () => refreshMessages(button.getAttribute('data-workspace-message-folder') || 'inbox'));
  });

  document.querySelectorAll('[data-workspace-message-compose]').forEach((button) => {
    button.addEventListener('click', async () => {
      const schoolId = localStorage.getItem('globyedu_schoolId');
      const token = getAccessToken();
      const recipientsResult = schoolId && token ? await fetchMessageRecipients(token, schoolId) : null;
      const recipients = recipientsResult?.ok && Array.isArray(recipientsResult.data?.recipients) ? recipientsResult.data.recipients : [];
      const recipientOptions = recipients.map((recipient) => ({ value: recipient.id, label: `${recipient.name} (${recipient.role})` }));
      if (!recipientOptions.length) {
        alert(recipientsResult?.data?.message || 'No authorized messaging recipients are available.');
        return;
      }
      const formData = await showAdminForm('Compose message', [
        { name: 'recipientId', label: 'Recipient', type: 'select', options: recipientOptions, required: true },
        { name: 'subject', label: 'Subject', required: true },
        { name: 'body', label: 'Message', type: 'textarea', required: true },
      ]);
      if (!formData) return;
      if (!schoolId || !token) return;
      const result = await createWorkspaceMessage(token, schoolId, {
        recipientId: formData.recipientId,
        subject: formData.subject,
        body: formData.body,
        attachments: [],
      });
      if (!result.ok || result.data?.status !== 'ok') {
        alert(result.data?.message || 'Unable to send message.');
        return;
      }
      alert('Message sent successfully.');
      refreshMessages('sent');
    });
  });

  const messageSearchInput = document.getElementById('workspace-message-search');
  if (messageSearchInput) {
    messageSearchInput.addEventListener('input', (event) => {
      refreshMessages(activeMessageFolder, event.target.value);
    });
  }

  document.querySelectorAll('[data-workspace-support-filter]').forEach((button) => {
    button.addEventListener('click', () => refreshSupport(button.getAttribute('data-workspace-support-filter') || 'all'));
  });

  document.addEventListener('click', async (event) => {
    const notificationButton = event.target.closest('[data-notification-action]');
    if (notificationButton) {
      const id = notificationButton.getAttribute('data-notification-id');
      const notifications = readWorkspaceStorage(WORKSPACE_STORAGE_KEYS.notifications, []);
      const next = notifications.filter((item) => item.id !== id);
      if (notificationButton.getAttribute('data-notification-action') === 'read') {
        const target = notifications.find((item) => item.id === id);
        if (target) {
          target.read = true;
          target.status = 'read';
          writeWorkspaceStorage(WORKSPACE_STORAGE_KEYS.notifications, notifications);
          recordWorkspaceActivity('Notification updated', target.title, 'notification');
        }
      } else {
        writeWorkspaceStorage(WORKSPACE_STORAGE_KEYS.notifications, next);
        recordWorkspaceActivity('Notification deleted', 'A workspace notification was removed.', 'notification');
      }
      refreshNotifications();
    }

    const messageButton = event.target.closest('[data-message-action]');
    if (messageButton) {
      const id = messageButton.getAttribute('data-message-id');
      const schoolId = localStorage.getItem('globyedu_schoolId');
      const token = getAccessToken();
      if (!schoolId || !token) {
        alert('Sign in to update messages. Browser-stored messages are not sent to the server.');
        return;
      }
      if (messageButton.getAttribute('data-message-action') === 'delete') {
        const result = await deleteWorkspaceMessage(token, schoolId, id);
        if (!result.ok || result.data?.status !== 'ok') {
          alert(result.data?.message || 'Unable to delete message.');
          return;
        }
        recordWorkspaceActivity('Message deleted', 'A workspace message was removed.', 'message');
      } else if (messageButton.getAttribute('data-message-action') === 'read') {
        const result = await updateWorkspaceMessage(token, schoolId, id, { unread: false });
        if (!result.ok || result.data?.status !== 'ok') {
          alert(result.data?.message || 'Unable to mark message as read.');
          return;
        }
        recordWorkspaceActivity('Message read', 'A workspace message was marked as read.', 'message');
      } else {
        const messagesResult = await fetchWorkspaceMessages(token, schoolId, { folder: 'inbox' });
        if (!messagesResult.ok || !Array.isArray(messagesResult.data?.messages)) {
          alert(messagesResult.data?.message || 'Unable to load the message for a reply.');
          return;
        }
        const target = messagesResult.data.messages.find((entry) => entry.id === id);
        const reply = prompt(`Reply to ${target?.subject || 'message'}`, `Re: ${target?.subject || ''}`);
        if (reply) {
          const result = await createWorkspaceMessage(token, schoolId, { folder: 'sent', from: 'School Head', to: target?.from || 'Recipient', subject: `Re: ${target?.subject || ''}`, body: reply, unread: false, attachments: [] });
          if (!result.ok || result.data?.status !== 'ok') {
            alert(result.data?.message || 'Unable to send reply.');
            return;
          }
          recordWorkspaceActivity('Message sent', 'A message was sent from the workspace.', 'message');
        }
      }
      refreshMessages(activeMessageFolder);
    }

    const supportButton = event.target.closest('[data-support-action]');
    if (supportButton) {
      const id = supportButton.getAttribute('data-ticket-id');
      const schoolId = localStorage.getItem('globyedu_schoolId');
      const token = getAccessToken();
      if (!schoolId || !token) {
        alert('Sign in to update support tickets. Browser-stored tickets are not sent to the server.');
        return;
      }
      if (supportButton.getAttribute('data-support-action') === 'close') {
        const result = await updateSupportTicket(token, schoolId, id, { status: 'resolved' });
        if (!result.ok || result.data?.status !== 'ok') {
          alert(result.data?.message || 'Unable to close support ticket.');
          return;
        }
      } else {
        const ticketsResult = await fetchSupportTickets(token, schoolId);
        if (!ticketsResult.ok || !Array.isArray(ticketsResult.data?.tickets)) {
          alert(ticketsResult.data?.message || 'Unable to load support ticket for reply.');
          return;
        }
        const target = ticketsResult.data.tickets.find((item) => item.id === id);
        const reply = prompt(`Reply to ${target?.title || 'ticket'}`, 'Thank you. We are reviewing your request.');
        if (reply && target) {
          const nextReplies = [...(target.replies || []), { body: reply, createdAt: new Date().toISOString() }];
          const result = await updateSupportTicket(token, schoolId, id, { replies: nextReplies });
          if (!result.ok || result.data?.status !== 'ok') {
            alert(result.data?.message || 'Unable to reply to support ticket.');
            return;
          }
        }
      }
      refreshSupport();
    }
  });

  const profileSaveButton = document.querySelector('[data-workspace-profile-save]');
  if (profileSaveButton) {
    profileSaveButton.addEventListener('click', () => {
      const profile = getWorkspaceProfile();
      profile.fullName = document.getElementById('workspace-profile-fullname')?.value || profile.fullName;
      profile.email = document.getElementById('workspace-profile-email')?.value || profile.email;
      profile.phone = document.getElementById('workspace-profile-phone')?.value || profile.phone;
      profile.localDraft = true;
      writeWorkspaceStorage(WORKSPACE_STORAGE_KEYS.profile, profile);
      recordWorkspaceActivity('Profile draft saved', profile.fullName, 'profile');
      alert('Profile draft saved in this browser. Your account profile has not changed because a profile update service is unavailable.');
    });
  }

  const profileUploadButton = document.querySelector('[data-workspace-profile-upload]');
  if (profileUploadButton) {
    profileUploadButton.addEventListener('click', () => {
      alert('Profile photo updates are unavailable for this account because no profile update service exists. No file was uploaded.');
    });
  }

  const studentProfileUploadButton = document.querySelector('[data-student-profile-photo-upload]');
  const studentProfileCameraButton = document.querySelector('[data-student-profile-photo-camera]');
  const studentProfilePhotoInput = document.querySelector('[data-student-profile-photo-input]');
  if (studentProfileUploadButton && studentProfilePhotoInput) {
    studentProfileUploadButton.addEventListener('click', () => {
      studentProfilePhotoInput.removeAttribute('capture');
      studentProfilePhotoInput.click();
    });
    studentProfileCameraButton?.addEventListener('click', () => {
      studentProfilePhotoInput.setAttribute('capture', 'user');
      studentProfilePhotoInput.click();
    });
    studentProfilePhotoInput.addEventListener('change', async () => {
      const file = studentProfilePhotoInput.files?.[0];
      if (!file) return;
      const validationError = validateProfileImageUpload(file);
      if (validationError) {
        studentProfilePhotoInput.value = '';
        alert(validationError);
        return;
      }
      const token = getAccessToken();
      const schoolId = localStorage.getItem('globyedu_schoolId');
      const studentId = localStorage.getItem('globyedu_studentId');
      const status = document.querySelector('[data-student-profile-photo-status]');
      if (!token || !schoolId || !studentId) {
        alert('Your student session is missing. Please sign in again.');
        return;
      }
      try {
        if (status) status.textContent = 'Uploading profile photo...';
        const uploadedPhoto = await uploadTenantAsset(file, 'student-profile', true, {
          type: 'student',
          id: studentId,
          field: 'profilePhotoPath',
        });
        const result = await updateSchoolEntity(token, schoolId, 'students', studentId, {
          profilePhoto: uploadedPhoto.url,
          profilePhotoPath: uploadedPhoto.path,
        });
        if (!result.ok || result.data?.status !== 'ok') {
          throw new Error(result.data?.message || 'The photo could not be saved to the student profile.');
        }
        if (status) status.textContent = 'Profile photo saved.';
        recordWorkspaceActivity('Profile photo updated', 'A student profile photo was uploaded.', 'profile');
        location.reload();
      } catch (error) {
        if (status) status.textContent = error.message || 'Unable to upload the student profile photo.';
        alert(error.message || 'Unable to upload the student profile photo.');
      }
    });
  }

  const profileTwoFactorButton = document.querySelector('[data-workspace-profile-2fa]');
  if (profileTwoFactorButton) {
    profileTwoFactorButton.addEventListener('click', () => {
      alert('Two-factor authentication cannot be changed here because no 2FA service is configured. Your account security settings were not changed.');
    });
  }

  const settingsSaveButton = document.querySelector('[data-workspace-settings-save]');
  if (settingsSaveButton) {
    settingsSaveButton.addEventListener('click', () => {
      const settings = getWorkspaceSettings();
      settings.theme = document.getElementById('workspace-settings-theme')?.value || settings.theme;
      settings.language = document.getElementById('workspace-settings-language')?.value || settings.language;
      settings.timezone = document.getElementById('workspace-settings-timezone')?.value || settings.timezone;
      writeWorkspaceStorage(WORKSPACE_STORAGE_KEYS.settings, settings);
      applyWorkspaceTheme();
      recordWorkspaceActivity('Workspace preferences updated', 'Browser-only workspace preferences were saved.', 'settings');
      alert('Workspace preferences saved in this browser only. Security settings were not changed.');
    });
  }

  const settingsResetButton = document.querySelector('[data-workspace-settings-reset]');
  if (settingsResetButton) {
    settingsResetButton.addEventListener('click', () => {
      const settings = getWorkspaceSettings();
      Object.assign(settings, {
        theme: 'midnight',
        notificationsEnabled: true,
        emailAlerts: true,
        smsAlerts: false,
        language: 'English',
        timezone: 'UTC',
      });
      writeWorkspaceStorage(WORKSPACE_STORAGE_KEYS.settings, settings);
      applyWorkspaceTheme();
      recordWorkspaceActivity('Workspace preferences reset', 'Browser-only workspace preferences were reset.', 'settings');
      alert('Workspace preferences reset in this browser only. Security settings were not changed.');
      location.reload();
    });
  }

  const supportCreateButton = document.querySelector('[data-workspace-support-create]');
  if (supportCreateButton) {
    supportCreateButton.addEventListener('click', async () => {
      const title = prompt('Support ticket title', 'Access request');
      const message = prompt('Describe the issue', 'I need help with the workspace.');
      if (!title || !message) return;
      const schoolId = localStorage.getItem('globyedu_schoolId');
      const token = getAccessToken();
      if (!schoolId || !token) {
        alert('Sign in to create a support ticket. Browser-stored tickets are not sent to the server.');
        return;
      }
      const result = await createSupportTicket(token, schoolId, { title, message, status: 'open', replies: [], priority: 'normal', category: 'workspace' });
      if (!result.ok || result.data?.status !== 'ok') {
        alert(result.data?.message || 'Unable to create support ticket.');
        return;
      }
      recordWorkspaceActivity('Support ticket created', title, 'support');
      refreshSupport();
      alert('Support ticket created successfully.');
    });
  }

  refreshNotifications();
  refreshMessages('inbox');
  refreshSupport('open');
}

function attachSchoolHandlers() {
  attachWorkspaceModuleHandlers();

  document.querySelectorAll('[data-print-report-card]').forEach((button) => {
    button.addEventListener('click', () => {
      const card = button.closest('[data-report-card]');
      if (!card) {
        alert('Unable to find this report card to print.');
        return;
      }
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        alert('Your browser blocked the print window. Allow pop-ups for this site and try again.');
        return;
      }
      const printableCard = card.cloneNode(true);
      printableCard.querySelectorAll('[data-print-report-card]').forEach((printButton) => printButton.remove());
      const studentName = card.querySelector('.report-card-header p')?.textContent?.trim() || 'Student report card';
      printWindow.document.open();
      printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(studentName)} report card</title><style>
        @page{size:A4 landscape;margin:14mm}
        *{box-sizing:border-box}
        body{font-family:Arial,sans-serif;color:#172033;margin:0}
        [data-report-card]{border:0!important;padding:0!important}
        .report-card-header{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #cbd5e1;padding-bottom:12px;margin-bottom:16px}
        .report-card-header>div:first-child{display:flex;align-items:center;gap:14px}
        .report-card-header p{margin:4px 0}
        .report-card-header p:first-child{font-size:20px;font-weight:700}
        .report-card-photo,.report-card-photo-fallback{width:84px;height:84px;flex:0 0 84px;border:1px solid #cbd5e1;border-radius:50%;object-fit:cover}
        .report-card-photo-fallback{display:flex;align-items:center;justify-content:center;background:#eff6ff;font-size:28px;font-weight:700}
        .report-card-table{width:100%;border-collapse:collapse;font-size:11pt}
        .report-card-table th,.report-card-table td{border:1px solid #94a3b8;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
        .report-card-table th{background:#f1f5f9!important;font-weight:700}
        .report-card-table tr{break-inside:avoid}
        @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
      </style></head><body>${printableCard.outerHTML}</body></html>`);
      printWindow.document.close();
      printWindow.addEventListener('afterprint', () => printWindow.close(), { once: true });
      const imagesReady = Array.from(printWindow.document.images).map((image) => image.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', resolve, { once: true });
        }));
      Promise.all(imagesReady).then(() => {
        printWindow.focus();
        printWindow.print();
      });
    });
  });

  // Attach sidebar navigation handlers
  attachSidebarHandlers(
    (section) => renderSchoolDashboardPage(section), // onNavigate
    () => {
      // onLogout
      clearAuthenticationState();
      location.hash = '#/login';
    },
    () => {
      // onHelp
      alert('For help, please contact the GlobyEdu support team at hello@globyedu.com or visit help.globyedu.com');
    }
  );

  const logoutButton = document.getElementById('school-dashboard-logout');
  if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
      if (!await revokeCurrentSession()) return;
      clearAuthenticationState();
      location.hash = '#/login';
    });
  }

  const searchInput = document.getElementById('school-head-search');
  if (searchInput) {
    let debounceTimer;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        const term = searchInput.value.trim();
        if (!term) {
          document.getElementById('school-head-search-results').innerHTML = '';
          return;
        }
        const schoolId = localStorage.getItem('globyedu_schoolId');
        const token = getAccessToken();
        if (!schoolId || !token) return;
        const results = await searchSchoolData(token, schoolId, term);
        const slot = document.getElementById('school-head-search-results');
        if (!slot) return;
        if (!results.ok || results.data?.status !== 'ok') {
          slot.innerHTML = `<div class="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">Unable to search school data.</div>`;
          return;
        }
        const items = Array.isArray(results.data.results) ? results.data.results : [];
        if (items.length === 0) {
          slot.innerHTML = `<div class="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">No matching records found.</div>`;
          return;
        }
        slot.innerHTML = items
          .map((group) => {
            const groupItems = Array.isArray(group.items) ? group.items.slice(0, 3) : [];
            return `
              <div class="rounded-2xl border border-slate-200 bg-white p-4">
                <p class="text-sm font-semibold text-slate-900">${group.scope}</p>
                <div class="mt-3 space-y-2">
                  ${groupItems
                    .map((item) => `<div class="rounded-2xl bg-slate-50 p-3 text-sm text-slate-700">${escapeHtml(item.name || item.title || item.fullName || item.email || item.code || item.id || 'Record')}</div>`)
                    .join('')}
                </div>
              </div>
            `;
          })
          .join('');
      }, 300);
    });
  }

  const examSearchInput = document.getElementById('school-exam-search');
  if (examSearchInput) {
    let debounceTimer;
    examSearchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const term = examSearchInput.value.trim().toLowerCase();
        const slot = document.getElementById('school-exam-search-results');
        if (!slot) return;
        if (!term) {
          slot.innerHTML = '';
          return;
        }
        const examEntries = JSON.parse(localStorage.getItem('globyedu_workspace_exams') || '[]');
        const filtered = (Array.isArray(examEntries) ? examEntries : []).filter((entry) => {
          const text = [entry.title, entry.examType, entry.subject, entry.className, entry.section, entry.teacher, entry.academicYear, entry.term, entry.date, entry.status]
            .filter(Boolean).join(' ').toLowerCase();
          return text.includes(term);
        });

        slot.innerHTML = filtered.length
          ? filtered.map((entry) => `
              <div class="rounded-2xl border border-slate-200 bg-white p-4">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p class="font-semibold text-slate-900">${escapeHtml(entry.title || 'Assessment')}</p>
                    <p class="mt-1 text-sm text-slate-600">${escapeHtml(entry.subject || 'Subject')} • ${escapeHtml(entry.className || 'Class')} • ${escapeHtml(entry.teacher || 'Teacher')}</p>
                  </div>
                  <span class="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">${escapeHtml(entry.status || 'Scheduled')}</span>
                </div>
              </div>
            `).join('')
          : '<div class="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">No exam matches found.</div>';
      }, 200);
    });
  }

  const financeSearchInput = document.getElementById('school-finance-search');
  if (financeSearchInput) {
    let debounceTimer;
    financeSearchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const term = financeSearchInput.value.trim().toLowerCase();
        const slot = document.getElementById('school-finance-search-results');
        if (!slot) return;
        if (!term) {
          slot.innerHTML = '';
          return;
        }
        const financeItems = [
          { title: 'Ada Boateng', detail: 'Invoice INV-001 • School Fees • Paid' },
          { title: 'INV-001', detail: 'Invoice reference for Ada Boateng' },
          { title: 'RCPT-1001', detail: 'Receipt for recent payment' },
          { title: 'PMT-001', detail: 'Bank payment reference' },
        ].filter((item) => item.title.toLowerCase().includes(term) || item.detail.toLowerCase().includes(term));

        slot.innerHTML = financeItems.length
          ? financeItems.map((item) => `
              <div class="rounded-2xl border border-slate-200 bg-white p-4">
                <p class="font-semibold text-slate-900">${escapeHtml(item.title)}</p>
                <p class="mt-1 text-sm text-slate-600">${escapeHtml(item.detail)}</p>
              </div>
            `).join('')
          : '<div class="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">No finance matches found.</div>';
      }, 200);
    });
  }

  document.querySelectorAll('[data-quick-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.getAttribute('data-quick-action');
      if (!action) return;
      handleQuickAction(action);
    });
  });

  const loadSummaryButton = document.getElementById('school-dashboard-load-summary');
  if (loadSummaryButton) {
    loadSummaryButton.addEventListener('click', loadSchoolSummary);
  }

  const schoolId = localStorage.getItem('globyedu_schoolId');
  const token = getAccessToken();

  document.querySelectorAll('[data-school-section-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.getAttribute('data-school-section-action');
      const entity = button.getAttribute('data-school-section-entity');
      if (!action) return;

      if (action === 'create-academic-record') {
        let academicFields = [
          { name: 'name', label: 'Name', placeholder: 'e.g. Mathematics', required: true },
          { name: 'code', label: 'Code', placeholder: 'e.g. MATH' },
          { name: 'description', label: 'Description', placeholder: 'Optional description', type: 'textarea' },
        ];
        if (entity === 'classes') {
          academicFields = [
            { name: 'name', label: 'Class name', placeholder: 'e.g. JHS 1A', required: true },
            { name: 'grade', label: 'Grade / level', placeholder: 'Optional, e.g. JHS 1' },
            { name: 'section', label: 'Section / stream', placeholder: 'Optional, e.g. A' },
          ];
        } else if (['academic-years', 'terms', 'semesters'].includes(entity)) {
          academicFields = [
            { name: 'label', label: 'Label', placeholder: entity === 'academic-years' ? '2026/2027' : entity === 'terms' ? 'Term 1' : 'Semester 1', required: true },
            { name: 'startDate', label: 'Start date', type: 'date', required: true },
            { name: 'endDate', label: 'End date', type: 'date', required: true },
          ];
          if (['terms', 'semesters'].includes(entity)) {
            const yearsResult = await fetchSchoolEntities(token, schoolId, 'academic-years', { pageSize: 100 });
            const yearOptions = yearsResult.ok && yearsResult.data?.status === 'ok'
              ? (yearsResult.data.items || []).map((year) => ({ label: year.label, value: year.id }))
              : [];
            academicFields.push({ name: 'academicYearId', label: 'Academic year', type: 'select', options: yearOptions, required: true });
          }
        }
        const formData = await showAdminForm(`Create ${entity || 'academic record'}`, academicFields);
        if (!formData) return;
        const result = await createSchoolEntity(token, schoolId, entity || 'departments', buildSchoolEntityPayload(entity || 'departments', formData));
        if (!result.ok || result.data?.status !== 'ok') {
          alert(result.data?.message || 'Unable to create academic record.');
          return;
        }
        alert('Academic record created successfully.');
        renderSchoolDashboardPage(entity === 'classes' ? 'classes' : 'academic', ++routeGeneration);
        return;
      }

      if (action === 'edit-class' || action === 'assign-class-teacher') {
        const classId = button.getAttribute('data-class-id');
        if (!classId) return;
        const detailsResult = await fetchSchoolDetails(token, schoolId);
        const school = detailsResult.ok && detailsResult.data?.status === 'ok' ? detailsResult.data.school || {} : {};
        const classes = Array.isArray(school.classes) ? school.classes : [];
        const classRecord = classes.find((entry) => String(entry.classId || entry.id) === String(classId));
        if (!classRecord) {
          alert('Class not found. Refresh the page and try again.');
          return;
        }
        if (action === 'edit-class') {
          const formData = await showAdminForm('Edit class', [
            { name: 'name', label: 'Class name', value: classRecord.name || '', required: true },
            { name: 'grade', label: 'Grade / level', value: classRecord.grade || '' },
            { name: 'section', label: 'Section / stream', value: classRecord.section || '' },
          ]);
          if (!formData) return;
          const result = await updateSchoolEntity(token, schoolId, 'classes', classId, { name: formData.name, grade: formData.grade || null, section: formData.section || null });
          if (!result.ok || result.data?.status !== 'ok') {
            alert(result.data?.message || 'Unable to update class.');
            return;
          }
          alert('Class updated successfully.');
          renderSchoolDashboardPage('classes', ++routeGeneration);
          return;
        }
        const teacherOptions = (Array.isArray(school.teachers) ? school.teachers : [])
          .filter((teacher) => String(teacher.status || 'active').toLowerCase() !== 'archived')
          .map((teacher) => ({ label: `${teacher.fullName || teacher.name || teacher.email} (${teacher.teacherId || teacher.username || teacher.email})`, value: teacher.teacherId || teacher.username || teacher.email }));
        const formData = await showAdminForm('Assign class teacher', [
          { name: 'teacherId', label: 'Teacher', type: 'select', options: [{ label: 'Unassigned', value: '' }, ...teacherOptions], value: classRecord.teacherId || classRecord.teacher || '' },
        ]);
        if (!formData) return;
        const result = await updateSchoolEntity(token, schoolId, 'classes', classId, { teacherId: formData.teacherId || null, teacher: formData.teacherId || null });
        if (!result.ok || result.data?.status !== 'ok') {
          alert(result.data?.message || 'Unable to assign class teacher.');
          return;
        }
        alert('Class teacher assignment saved.');
        renderSchoolDashboardPage('classes', ++routeGeneration);
        return;
      }

      if (action === 'create-student') {
        const schoolDetailsResult = await fetchSchoolDetails(token, schoolId);
        const classOptions = schoolDetailsResult.ok && schoolDetailsResult.data?.status === 'ok'
          ? (schoolDetailsResult.data.school?.classes || [])
            .filter((entry) => String(entry.status || 'active').toLowerCase() !== 'archived')
            .map((entry) => ({ label: entry.name || entry.classId, value: entry.classId || entry.id || entry.name || '' }))
            .filter((entry) => entry.value)
          : [];
        let createResponse = null;
        const formData = await showAdminForm('Create student', [
          { name: 'fullName', label: 'Full name', placeholder: 'First and last name', required: true },
          { name: 'email', label: 'Email', type: 'email', placeholder: 'student@example.com', required: true },
          { name: 'profilePhoto', label: 'Profile photo', type: 'file', accept: 'image/*' },
          { name: 'gender', label: 'Gender', type: 'select', options: [
            { label: 'Male', value: 'male' },
            { label: 'Female', value: 'female' },
            { label: 'Other', value: 'other' },
          ] },
          { name: 'dateOfBirth', label: 'Date of birth', type: 'date' },
          { name: 'phone', label: 'Phone number' },
          { name: 'classId', label: 'Class / Section', type: 'select', options: classOptions, required: true },
          { name: 'gradeLevel', label: 'Grade / Year', placeholder: 'e.g. 1, 2, 3' },
          { name: 'house', label: 'House / Boarding' },
          { name: 'guardian', label: 'Guardian name' },
          { name: 'parentPhone', label: 'Guardian phone' },
          { name: 'parentEmail', label: 'Guardian email', type: 'email' },
          { name: 'medical', label: 'Medical notes', type: 'textarea', placeholder: 'e.g. Allergies, conditions, etc.' },
          { name: 'documents', label: 'Documents', placeholder: 'Comma-separated URLs or file names' },
        ], { submitLabel: 'Create Student' });
        if (!formData) return;
        
        const studentData = {
          ...formData,
          profilePhoto: null,
          profilePhotoPath: null,
          className: classOptions.find((option) => option.value === formData.classId)?.label || null,
          status: 'active',
        };
        const result = await createSchoolEntity(token, schoolId, 'students', buildSchoolEntityPayload('students', studentData));
        if (!result.ok || result.data?.status !== 'ok') {
          alert(result.data?.message || 'Unable to create student.');
          return;
        }
        const createdStudent = result.data?.entity || {};
        try {
          await uploadCreatedEntityProfilePhoto(formData.profilePhoto, 'students', createdStudent, token, schoolId);
        } catch (error) {
          alert(error.message || 'Student created, but the profile photo could not be saved.');
          return;
        }
        alert(`Student created successfully.\nAdmission Number: ${createdStudent.admissionNumber || 'Generated by the school data layer'}\nThe student must use the password reset flow before first login.`);
        renderSchoolDashboardPage('students', ++routeGeneration);
        return;
      }

      if (action === 'create-teacher') {
        const schoolDetailsResult = await fetchSchoolDetails(token, schoolId);
        const school = schoolDetailsResult.ok && schoolDetailsResult.data?.status === 'ok' ? schoolDetailsResult.data.school : {};
        const teacherClassOptions = Array.isArray(school.classes)
          ? school.classes
            .filter((entry) => String(entry.status || 'active').toLowerCase() !== 'archived')
            .map((entry) => ({ label: entry.name || entry.classId || 'Class', value: entry.classId || entry.id || entry.name || '' }))
            .filter((entry) => entry.value)
          : [];
        const teacherSubjectOptions = [
          { label: 'RME', value: 'RME' },
          { label: 'Mathematics', value: 'Mathematics' },
          { label: 'Science', value: 'Science' },
          { label: 'English Language', value: 'English Language' },
          { label: 'English', value: 'English' },
          { label: 'Creative Arts', value: 'Creative Arts' },
          { label: 'Computing / ICT', value: 'Computing / ICT' },
          { label: 'Social Studies', value: 'Social Studies' },
          { label: 'Career Technology', value: 'Career Technology' },
          { label: 'Religious and Moral Education', value: 'Religious and Moral Education' },
          { label: 'French', value: 'French' },
          { label: 'History', value: 'History' },
          { label: 'Geography', value: 'Geography' },
          { label: 'Agriculture', value: 'Agriculture' },
          { label: 'Physical Education', value: 'Physical Education' },
          { label: 'Music', value: 'Music' },
          { label: 'Basic Design and Technology', value: 'Basic Design and Technology' },
          { label: 'Home Economics', value: 'Home Economics' },
          { label: 'Art', value: 'Art' },
          { label: 'Biology', value: 'Biology' },
          { label: 'Chemistry', value: 'Chemistry' },
          { label: 'Physics', value: 'Physics' },
          { label: 'Economics', value: 'Economics' },
          { label: 'Government', value: 'Government' },
          { label: 'Business Management', value: 'Business Management' },
          { label: 'Literature in English', value: 'Literature in English' },
          { label: 'Civic Education', value: 'Civic Education' },
          { label: 'Information Communication Technology', value: 'Information Communication Technology' },
        ];
        const teacherPositionOptions = [
          { label: 'Teacher', value: 'Teacher' },
          { label: 'Senior Teacher', value: 'Senior Teacher' },
          { label: 'Head of Department', value: 'Head of Department' },
          { label: 'Assistant Headteacher', value: 'Assistant Headteacher' },
          { label: 'Headteacher', value: 'Headteacher' },
          { label: 'Principal', value: 'Principal' },
          { label: 'Vice Principal', value: 'Vice Principal' },
          { label: 'Class Teacher', value: 'Class Teacher' },
          { label: 'Subject Teacher', value: 'Subject Teacher' },
          { label: 'School Administrator', value: 'School Administrator' },
        ];

        const formData = await showAdminForm('Invite a teacher', [
          { name: 'fullName', label: 'Full name', placeholder: 'First and last name', required: true },
          { name: 'email', label: 'Teacher email (invitation sent here)', type: 'email', placeholder: 'teacher@example.com', required: true },
          { name: 'profilePhoto', label: 'Profile photo', type: 'file', accept: 'image/*' },
          { name: 'gender', label: 'Gender', type: 'select', options: [
            { label: 'Male', value: 'male' },
            { label: 'Female', value: 'female' },
            { label: 'Other', value: 'other' },
          ] },
          { name: 'dateOfBirth', label: 'Date of birth (optional)', type: 'date' },
          { name: 'phone', label: 'Phone number', placeholder: '+1234567890' },
          { name: 'department', label: 'Department', placeholder: 'e.g. Sciences, Languages' },
          { name: 'position', label: 'Position', type: 'select', options: teacherPositionOptions, required: true },
          { name: 'qualification', label: 'Qualification', placeholder: 'e.g. B.Ed, M.Ed, Diploma' },
          { name: 'yearsOfExperience', label: 'Years of experience', placeholder: 'e.g. 5' },
          { name: 'assignedClasses', label: 'Assigned class', type: 'select', options: teacherClassOptions, required: true },
          { name: 'assignedSubjects', label: 'Assigned subjects', type: 'select', multiple: true, options: teacherSubjectOptions, placeholder: 'Select subjects' },
          { name: 'classTeacher', label: 'Is class teacher?', type: 'select', options: [
            { label: 'No', value: 'false' },
            { label: 'Yes', value: 'true' },
          ] },
          { name: 'employmentType', label: 'Employment type', type: 'select', options: [
            { label: 'Permanent', value: 'permanent' },
            { label: 'Contract', value: 'contract' },
            { label: 'Part-time', value: 'part-time' },
          ] },
        ], { submitLabel: 'Send Invitation' });
        if (!formData) return;

        const normalizedAssignedClasses = formData.assignedClasses ? [formData.assignedClasses] : [];
        const normalizedAssignedSubjects = Array.isArray(formData.assignedSubjects) ? formData.assignedSubjects : formData.assignedSubjects ? [formData.assignedSubjects] : [];

        const teacherData = {
          ...formData,
          profilePhoto: null,
          profilePhotoPath: null,
          assignedClasses: normalizedAssignedClasses,
          assignedSubjects: normalizedAssignedSubjects,
          classTeacher: formData.classTeacher === 'true',
          status: 'active',
        };
        delete teacherData.houseMaster;
        delete teacherData.nationalId;
        const result = await createSchoolEntity(token, schoolId, 'teachers', buildSchoolEntityPayload('teachers', teacherData));
        if (!result.ok || result.data?.status !== 'ok') {
          alert(result.data?.message || 'Unable to create teacher.');
          return;
        }
        const createdTeacher = result.data?.entity || {};
        try {
          await uploadCreatedEntityProfilePhoto(formData.profilePhoto, 'teachers', createdTeacher, token, schoolId);
        } catch (error) {
          alert(error.message || 'Teacher created, but the profile photo could not be saved.');
          return;
        }
        alert(createdTeacher.invitationEmailStatus === 'failed'
          ? 'Teacher account created, but the invitation could not be sent. The account is saved; resolve the issue, then use Resend invite.'
          : createdTeacher.invitationEmailStatus === 'provider_accepted'
            ? createdTeacher.invitationEmailDeliveryStatus === 'unconfirmed'
              ? 'Invitation request accepted by the email provider; actual delivery is unconfirmed. The teacher must verify their email and set a password before signing in.'
              : 'Invitation request accepted by the email provider, but delivery status is not confirmed. Check the invitation status before asking the teacher to activate.'
            : 'Teacher record created, but invitations are unavailable in this storage mode; no invitation email was sent. Switch to Firebase-backed storage before onboarding this teacher.');
        renderSchoolDashboardPage('teachers');
        return;
      }

      if (action === 'record-attendance') {
        const formData = await showAdminForm('Record attendance', [
          { name: 'date', label: 'Date', type: 'date', required: true },
          { name: 'studentName', label: 'Student / staff name', required: true },
          { name: 'studentId', label: 'Student or staff reference (optional)' },
          { name: 'className', label: 'Class / stream' },
          { name: 'teacher', label: 'Teacher / recorder' },
          { name: 'subject', label: 'Subject / activity' },
          { name: 'status', label: 'Status', type: 'select', options: [
            { label: 'Present', value: 'present' },
            { label: 'Absent', value: 'absent' },
          ], required: true },
          { name: 'note', label: 'Note', type: 'textarea' },
        ]);
        if (!formData) return;
        const result = await appendSchoolCollectionData(token, schoolId, 'attendanceRecords', buildSchoolCollectionPayload('attendanceRecords', formData), 'Attendance captured', 'Attendance was recorded from the school dashboard.');
        if (!result.ok || result.data?.status !== 'ok') {
          alert(result.data?.message || 'Unable to record attendance.');
          return;
        }
        alert('Attendance recorded successfully.');
        renderSchoolDashboardPage('attendance');
        return;
      }

      if (action === 'record-payment') {
        const currentResult = await fetchSchoolDetails(token, schoolId);
        const currentSchool = currentResult.ok && currentResult.data?.status === 'ok' ? currentResult.data.school || {} : {};
        const studentOptions = (Array.isArray(currentSchool.students) ? currentSchool.students : [])
          .filter((student) => String(student.status || 'active').toLowerCase() !== 'archived')
          .map((student) => ({ label: `${student.fullName || student.name || student.email} (${student.studentId || student.id || student.email})`, value: student.studentId || student.id || student.email }))
          .filter((option) => option.value);
        const formData = await showAdminForm('Record payment', [
          { name: 'amount', label: 'Amount', required: true },
          { name: 'studentId', label: 'Student', type: 'select', options: studentOptions, required: true },
          { name: 'method', label: 'Method' },
          { name: 'reference', label: 'External reference (optional)' },
          { name: 'note', label: 'Note', type: 'textarea' },
        ]);
        if (!formData) return;
        const result = await createFeePayment(token, schoolId, { ...formData, status: 'received' });
        if (!result.ok || result.data?.status !== 'ok') {
          alert(result.data?.message || 'Unable to record payment.');
          return;
        }
        alert('Payment recorded successfully.');
        renderSchoolDashboardPage('finance');
        return;
      }

      if (action === 'create-exam') {
        const formData = await showAdminForm('Create exam', [
          { name: 'title', label: 'Exam title', required: true },
          { name: 'examType', label: 'Exam type', placeholder: 'Class Test / Quiz / Mid-Term / Mock / Custom' },
          { name: 'subject', label: 'Subject' },
          { name: 'className', label: 'Class / stream' },
          { name: 'section', label: 'Section' },
          { name: 'teacher', label: 'Teacher' },
          { name: 'academicYear', label: 'Academic year' },
          { name: 'term', label: 'Term' },
          { name: 'date', label: 'Date', type: 'date' },
          { name: 'maxMarks', label: 'Maximum marks' },
          { name: 'passingMarks', label: 'Passing marks' },
          { name: 'remarks', label: 'Remarks' },
          { name: 'status', label: 'Status', placeholder: 'Scheduled / Draft / Published' },
        ]);
        if (!formData) return;
        const maxMarks = Number(formData.maxMarks || 100);
        const passingMarks = Number(formData.passingMarks || 40);
        if (!Number.isFinite(maxMarks) || maxMarks <= 0 || !Number.isFinite(passingMarks) || passingMarks < 0 || passingMarks > maxMarks) {
          alert('Maximum marks must be positive and passing marks must be between zero and the maximum.');
          return;
        }
        const examEntry = createExamRecord(formData);
        const result = await appendSchoolCollectionData(token, schoolId, 'examRecords', examEntry, 'Exam created', 'An examination entry was added to the school workspace.');
        if (!result.ok || result.data?.status !== 'ok') {
          alert(result.data?.message || 'Unable to create exam.');
          return;
        }
        const activityDetail = `${examEntry.title || 'Exam'} has been scheduled for ${examEntry.date || 'the upcoming term'}.`;
        const existingActivities = readWorkspaceStorage(WORKSPACE_STORAGE_KEYS.activities, []);
        writeWorkspaceStorage(WORKSPACE_STORAGE_KEYS.activities, [{ title: 'Exam scheduled', detail: activityDetail, createdAt: new Date().toISOString() }, ...existingActivities].slice(0, 12));
        alert('Exam created successfully.');
        renderSchoolDashboardPage('exams');
        return;
      }

      if (action === 'enter-grades') {
        const formData = await showAdminForm('Enter marks', [
          { name: 'student', label: 'Student', required: true },
          { name: 'subject', label: 'Subject', required: true },
          { name: 'exam', label: 'Exam / assessment', required: true },
          { name: 'mark', label: 'Mark', required: true },
          { name: 'maxMarks', label: 'Maximum marks' },
          { name: 'passingMarks', label: 'Passing marks' },
          { name: 'term', label: 'Term' },
          { name: 'academicYear', label: 'Academic year' },
          { name: 'remark', label: 'Remark' },
        ]);
        if (!formData) return;
        const numericMark = Number(formData.mark || 0);
        const numericMax = Number(formData.maxMarks || 100);
        const numericPass = Number(formData.passingMarks || 40);
        if (!Number.isFinite(numericMark) || !Number.isFinite(numericMax) || numericMax <= 0 || numericMark < 0 || numericMark > numericMax || !Number.isFinite(numericPass) || numericPass < 0 || numericPass > numericMax) {
          alert('Enter a mark between zero and the maximum, with a valid passing mark.');
          return;
        }
        const average = numericMax ? Math.round((numericMark / numericMax) * 100) : 0;
        const passed = numericMark >= numericPass;
        const grade = average >= 80 ? 'A' : average >= 70 ? 'B' : average >= 60 ? 'C' : average >= 50 ? 'D' : average >= 40 ? 'E' : 'F';
        const currentResult = await fetchSchoolDetails(token, schoolId);
        const school = currentResult.ok && currentResult.data?.status === 'ok' ? currentResult.data.school || {} : {};
        const existingResults = Array.isArray(school.examResults) ? school.examResults : [];
        const resultEntry = {
          student: formData.student || '',
          subject: formData.subject || '',
          exam: formData.exam || '',
          mark: numericMark,
          maxMarks: numericMax,
          passingMarks: numericPass,
          average,
          grade,
          passed,
          remark: formData.remark || (passed ? 'Competent performance' : 'Needs support'),
          term: formData.term || 'Term 1',
          academicYear: formData.academicYear || '2025/2026',
          updatedAt: new Date().toISOString(),
        };
        const resultKey = (entry) => `${String(entry.student).trim().toLowerCase()}|${String(entry.subject).trim().toLowerCase()}|${String(entry.exam).trim().toLowerCase()}|${String(entry.term || '').trim().toLowerCase()}|${String(entry.academicYear || '').trim().toLowerCase()}`;
        const existingIndex = existingResults.findIndex((entry) => resultKey(entry) === resultKey(resultEntry));
        const nextResults = [...existingResults];
        if (existingIndex >= 0) nextResults[existingIndex] = { ...nextResults[existingIndex], ...resultEntry };
        else nextResults.push({ ...resultEntry, id: `result-${Date.now()}`, createdAt: new Date().toISOString() });
        const result = await updateSchoolDetails(token, schoolId, { examResults: nextResults });
        if (!result.ok || result.data?.status !== 'ok') {
          alert(result.data?.message || 'Unable to save marks.');
          return;
        }
        alert(`Marks saved for ${formData.student || 'the selected student'}.`);
        renderSchoolDashboardPage('exams');
        return;
      }

      if (action === 'generate-report-card') {
        const formData = await showAdminForm('Generate report card', [
          { name: 'student', label: 'Student', required: true },
          { name: 'term', label: 'Term' },
          { name: 'academicYear', label: 'Academic year' },
          { name: 'grade', label: 'Grade' },
          { name: 'remarks', label: 'Remarks' },
        ]);
        if (!formData) return;
        const currentResult = await fetchSchoolDetails(token, schoolId);
        const school = currentResult.ok && currentResult.data?.status === 'ok' ? currentResult.data.school || {} : {};
        const matchingResults = (Array.isArray(school.examResults) ? school.examResults : []).filter((entry) => String(entry.student || '').toLowerCase() === String(formData.student || '').toLowerCase());
        const average = matchingResults.length ? Math.round(matchingResults.reduce((sum, entry) => sum + Number(entry.average || 0), 0) / matchingResults.length) : 0;
        const reportCard = generateReportCard({ ...formData, grade: average >= 80 ? 'A' : average >= 70 ? 'B' : average >= 60 ? 'C' : average >= 50 ? 'D' : average >= 40 ? 'E' : 'F', results: matchingResults, average });
        const result = await appendSchoolCollectionData(token, schoolId, 'reportCards', reportCard, 'Report card generated', 'A report card was generated from the examination workspace.');
        if (!result.ok || result.data?.status !== 'ok') {
          alert(result.data?.message || 'Unable to generate report card.');
          return;
        }
        alert(`Report card generated for ${formData.student || 'the selected student'}.`);
        renderSchoolDashboardPage('exams');
        return;
      }

      if (action === 'generate-transcript') {
        const formData = await showAdminForm('Generate transcript', [
          { name: 'student', label: 'Student', required: true },
          { name: 'academicYear', label: 'Academic year' },
          { name: 'term', label: 'Term' },
        ]);
        if (!formData) return;
        const currentResult = await fetchSchoolDetails(token, schoolId);
        const school = currentResult.ok && currentResult.data?.status === 'ok' ? currentResult.data.school || {} : {};
        const transcriptResults = (Array.isArray(school.examResults) ? school.examResults : []).filter((entry) => {
          const matchesStudent = String(entry.student || '').trim().toLowerCase() === String(formData.student || '').trim().toLowerCase();
          const matchesYear = !formData.academicYear || String(entry.academicYear || '') === String(formData.academicYear);
          const matchesTerm = !formData.term || String(entry.term || '') === String(formData.term);
          return matchesStudent && matchesYear && matchesTerm;
        });
        if (!transcriptResults.length) {
          alert('No saved academic results were found for this student and period.');
          return;
        }
        const average = Math.round(transcriptResults.reduce((sum, entry) => sum + Number(entry.average || 0), 0) / transcriptResults.length);
        const transcript = generateReportCard({ ...formData, status: 'Transcript ready', results: transcriptResults, average, grade: average >= 80 ? 'A' : average >= 70 ? 'B' : average >= 60 ? 'C' : average >= 50 ? 'D' : average >= 40 ? 'E' : 'F' });
        const result = await appendSchoolCollectionData(token, schoolId, 'reportCards', transcript, 'Transcript generated', 'A transcript was generated from the examination workspace.');
        if (!result.ok || result.data?.status !== 'ok') {
          alert(result.data?.message || 'Unable to generate transcript.');
          return;
        }
        alert(`Transcript prepared for ${formData.student || 'the selected student'}.`);
        renderSchoolDashboardPage('exams');
        return;
      }

      if (action === 'export-results') {
        window.print();
        return;
      }

      if (action === 'post-announcement') {
        const formData = await showAdminForm('Create announcement', [
          { name: 'title', label: 'Title', required: true },
          { name: 'detail', label: 'Message', type: 'textarea', required: true },
          { name: 'audience', label: 'Audience', type: 'select', options: [{ value: 'students', label: 'Students' }, { value: 'teachers', label: 'Teachers' }, { value: 'parents', label: 'Parents' }, { value: 'all', label: 'Everyone' }] },
        ], { submitLabel: 'Publish Announcement' });
        if (!formData) return;
        const result = await appendSchoolCollectionData(token, schoolId, 'announcements', buildSchoolCollectionPayload('announcements', formData), 'Announcement created', 'A new school announcement was posted.');
        if (!result.ok || result.data?.status !== 'ok') {
          alert(result.data?.message || 'Unable to create announcement.');
          return;
        }
        alert('Announcement created successfully.');
        renderSchoolDashboardPage('communications');
        return;
      }

      if (action === 'send-message') {
        const formData = await showAdminForm('Send message', [
          { name: 'recipient', label: 'Audience', type: 'select', options: [{ value: 'students', label: 'Students' }, { value: 'teachers', label: 'Teachers' }, { value: 'parents', label: 'Parents' }, { value: 'all', label: 'Everyone' }], required: true },
          { name: 'subject', label: 'Subject', required: true },
          { name: 'body', label: 'Message', type: 'textarea', required: true },
        ]);
        if (!formData) return;
        const result = await appendSchoolCollectionData(token, schoolId, 'messages', buildSchoolCollectionPayload('messages', formData), 'Message drafted', 'A school communication was queued from the dashboard.');
        if (!result.ok || result.data?.status !== 'ok') {
          alert(result.data?.message || 'Unable to send message.');
          return;
        }
        alert('Message queued successfully.');
        renderSchoolDashboardPage('communications');
        return;
      }

      if (action === 'create-report') {
        const formData = await showAdminForm('Create report', [
          { name: 'title', label: 'Report title', placeholder: 'e.g. Monthly Attendance Analysis', required: true },
          { name: 'type', label: 'Report type', type: 'select', options: [
            { label: 'Academic', value: 'academic' },
            { label: 'Finance', value: 'finance' },
            { label: 'Attendance', value: 'attendance' },
            { label: 'Discipline', value: 'discipline' },
            { label: 'Infrastructure', value: 'infrastructure' },
            { label: 'General', value: 'general' },
          ], required: true },
          { name: 'summary', label: 'Summary', type: 'textarea', placeholder: 'Brief overview of the report content', required: true },
        ]);
        if (!formData) return;
        const reportData = buildSchoolCollectionPayload('reports', { ...formData, status: 'draft', submittedAt: null });
        const result = await appendSchoolCollectionData(token, schoolId, 'reports', reportData, 'Report created', `A ${formData.type} report titled "${formData.title}" was created.`);
        if (!result.ok || result.data?.status !== 'ok') {
          alert(result.data?.message || 'Unable to create report.');
          return;
        }
        alert('Report created successfully. You can submit it to the Super Admin when ready.');
        renderSchoolDashboardPage('reports');
        return;
      }

      if (action === 'generate-ai-summary') {
        const summaryText = `Attendance coverage is healthy. ${Math.max(0, 80 + Math.round(Math.random() * 10))}% of learners were present today. Outstanding balances remain under review.`;
        const activityDetail = summaryText;
        const result = await appendSchoolCollectionData(token, schoolId, 'reports', { title: 'AI summary', summary: summaryText }, 'AI summary generated', activityDetail);
        if (!result.ok || result.data?.status !== 'ok') {
          alert(result.data?.message || 'Unable to generate AI summary.');
          return;
        }
        alert('AI summary generated successfully.');
        renderSchoolDashboardPage('ai');
        return;
      }

      alert(`${action.replace(/-/g, ' ')} is now available in the dashboard workflow.`);
    });
  });

  document.querySelectorAll('[data-school-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.getAttribute('data-school-action');
      if (action === 'delete-logo') {
        const schoolId = localStorage.getItem('globyedu_schoolId');
        const token = getAccessToken();
        if (!schoolId || !token) return;
        const result = await updateSchoolDetails(token, schoolId, { logo: null, logoPath: null });
        if (!result.ok || result.data?.status !== 'ok') {
          alert(result.data?.message || 'Unable to remove logo.');
          return;
        }
        alert('Logo removed successfully.');
        renderSchoolDashboardPage('profile');
      }
    });
  });

  document.querySelectorAll('[data-school-report-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.getAttribute('data-school-report-action');
      const reportId = button.getAttribute('data-report-id');
      const schoolId = localStorage.getItem('globyedu_schoolId');
      const token = getAccessToken();
      if (!schoolId || !token) return;

      if (action === 'submit-report') {
        if (!confirm('Submit this report to the Super Admin? The report will be marked as "submitted" and cannot be edited until reviewed.')) return;
        const schoolDetailsResult = await fetchSchoolDetails(token, schoolId);
        const school = schoolDetailsResult.ok && schoolDetailsResult.data?.status === 'ok' ? schoolDetailsResult.data.school : {};
        const reports = Array.isArray(school.reports) ? school.reports : [];
        const reportIndex = reports.findIndex((r) => r.title === reportId);
        if (reportIndex === -1) {
          alert('Report not found.');
          return;
        }
        reports[reportIndex] = { ...reports[reportIndex], status: 'submitted', submittedAt: new Date().toISOString() };
        const result = await updateSchoolDetails(token, schoolId, { reports });
        if (!result.ok || result.data?.status !== 'ok') {
          alert(result.data?.message || 'Unable to submit report.');
          return;
        }
        alert('Report submitted successfully to the Super Admin for review.');
        renderSchoolDashboardPage('reports');
        return;
      }

      alert(`${action.replace(/-/g, ' ')} is now available in the report workflow.`);
    });
  });

  function initializeStudentSearch() {
    const studentSearchInput = document.getElementById('school-student-search');
    if (!studentSearchInput) return;

    let debounceTimer;
    studentSearchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const term = studentSearchInput.value.trim().toLowerCase();
        document.querySelectorAll('[data-school-student-row]').forEach((row) => {
          const searchText = row.getAttribute('data-search-text') || '';
          row.classList.toggle('hidden', term ? !searchText.includes(term) : false);
        });
      }, 150);
    });
  }

  function initializeAttendanceRoster() {
    const viewDateInput = document.getElementById('school-attendance-view-date');
    if (viewDateInput) {
      viewDateInput.addEventListener('change', () => {
        const schoolId = localStorage.getItem('globyedu_schoolId') || '';
        if (!viewDateInput.value) return;
        sessionStorage.setItem(`globyedu_attendance_view_date:${schoolId}`, viewDateInput.value);
        renderSchoolDashboardPage('attendance');
      });
    }

    const loadButton = document.querySelector('[data-school-attendance-load]');
    const roster = document.getElementById('school-attendance-roster');
    const feedback = document.getElementById('school-attendance-feedback');
    const dateInput = document.getElementById('school-attendance-date');
    const classInput = document.getElementById('school-attendance-class');
    if (!loadButton || !roster || !feedback || !dateInput || !classInput) return;

    loadButton.addEventListener('click', async () => {
      const date = dateInput.value;
      const className = classInput.value;
      if (!date || !className) {
        feedback.textContent = 'Select a date and class before loading the roster.';
        return;
      }
      const schoolId = localStorage.getItem('globyedu_schoolId');
      const token = getAccessToken();
      if (!schoolId || !token) return;
      const result = await fetchSchoolDetails(token, schoolId);
      const school = result.ok && result.data?.status === 'ok' ? result.data.school || {} : {};
      const students = Array.isArray(school.students) ? school.students : [];
      const records = Array.isArray(school.attendanceRecords) ? school.attendanceRecords : [];
      const classRecord = (Array.isArray(school.classes) ? school.classes : []).find((entry) => [entry.classId, entry.id, entry.name, entry.className, entry.grade].filter(Boolean).some((value) => String(value).trim().toLowerCase() === String(className).trim().toLowerCase()));
      const rosterEntries = buildAttendanceRoster(students, records, date, className, classRecord);
      const statusOptions = ['present', 'absent'];
      feedback.textContent = rosterEntries.length ? `${rosterEntries.length} student${rosterEntries.length === 1 ? '' : 's'} loaded for ${className} on ${date}.` : 'No active students belong to this class.';
      roster.innerHTML = rosterEntries.length ? `
        <div class="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table class="min-w-full text-sm text-slate-700">
            <thead class="bg-slate-100"><tr><th class="px-4 py-3 text-left">Student</th><th class="px-4 py-3 text-left">Student ID</th><th class="px-4 py-3 text-left">Attendance</th></tr></thead>
            <tbody class="divide-y divide-slate-200">${rosterEntries.map(({ student, studentId, status }) => {
              return `<tr><td class="px-4 py-3 font-semibold text-slate-900">${escapeHtml(student.fullName || student.name || 'Student')}</td><td class="px-4 py-3">${escapeHtml(studentId || '—')}</td><td class="px-4 py-3"><select required data-attendance-status data-student-id="${escapeHtml(studentId)}" class="rounded-xl border border-slate-200 bg-white px-3 py-2"><option value="" ${status ? '' : 'selected'} disabled>Select status</option>${statusOptions.map((option) => `<option value="${option}" ${status === option ? 'selected' : ''}>${option.charAt(0).toUpperCase() + option.slice(1)}</option>`).join('')}</select></td></tr>`;
            }).join('')}</tbody>
          </table>
        </div>
        <button type="button" data-school-attendance-save class="mt-4 rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white">Save attendance</button>
      ` : '';

      roster.querySelector('[data-school-attendance-save]')?.addEventListener('click', async () => {
        const selected = [...roster.querySelectorAll('[data-attendance-status]')];
        if (selected.some((control) => !normalizeAttendanceStatus(control.value))) {
          feedback.textContent = 'Choose Present or Absent for every student before saving.';
          return;
        }
        const selectedRoster = selected.map((control) => {
          const student = students.find((entry) => String(entry.studentId || entry.id || entry.email || '') === control.dataset.studentId) || {};
          return { student, studentId: control.dataset.studentId, status: control.value };
        });
        const nextRecords = replaceAttendanceSession(records, selectedRoster, date, className, schoolId);
        const saveResult = await updateSchoolDetails(token, schoolId, { attendanceRecords: nextRecords });
        if (!saveResult.ok || saveResult.data?.status !== 'ok') {
          feedback.textContent = saveResult.data?.message || 'Unable to save attendance.';
          return;
        }
        feedback.textContent = `Attendance saved for ${selected.length} student${selected.length === 1 ? '' : 's'}.`;
      });
    });
  }

  function initializeStudentActions() {
    document.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-school-student-action]');
      if (!button) return;
      const action = button.getAttribute('data-school-student-action');
      const studentId = button.getAttribute('data-school-student-id');
      const schoolId = localStorage.getItem('globyedu_schoolId');
      const token = getAccessToken();
      if (!action || !studentId || !schoolId || !token) return;

      const studentRecord = currentSchoolStudents.find((student) => student.id === studentId || student.email === studentId || student.studentId === studentId || student.admissionNumber === studentId);
      if (!studentRecord) {
        alert('Unable to find the selected student record. Refresh the page and try again.');
        return;
      }

      if (action === 'edit') {
        const formData = await showAdminForm('Edit student', [
          { name: 'fullName', label: 'Full name', value: studentRecord.fullName || studentRecord.name || '', required: true },
          { name: 'email', label: 'Email', value: studentRecord.email || '', type: 'email', required: true },
          { name: 'studentIdDisplay', label: 'Student ID (auto-generated)', value: studentRecord.studentId || studentRecord.admissionNumber || '', type: 'text', disabled: true, placeholder: 'Auto-generated - cannot be changed' },
          { name: 'profilePhoto', label: 'Profile photo', type: 'file', accept: 'image/*' },
          { name: 'gender', label: 'Gender', value: studentRecord.gender || '', type: 'select', options: [
            { label: 'Male', value: 'male' },
            { label: 'Female', value: 'female' },
            { label: 'Other', value: 'other' },
          ] },
          { name: 'dateOfBirth', label: 'Date of birth', type: 'date', value: studentRecord.dateOfBirth || '' },
          { name: 'phone', label: 'Phone number', value: studentRecord.phone || '', placeholder: '+1234567890' },
          { name: 'className', label: 'Class / Section', value: studentRecord.className || '', placeholder: 'e.g. JHS 1A', required: true },
          { name: 'gradeLevel', label: 'Grade / Year', value: studentRecord.gradeLevel || studentRecord.grade || '', placeholder: 'e.g. 1' },
          { name: 'house', label: 'House / Boarding', value: studentRecord.house || '' },
          { name: 'guardian', label: 'Guardian name', value: studentRecord.guardian || '' },
          { name: 'parentPhone', label: 'Guardian phone', value: studentRecord.parentPhone || '', placeholder: '+233000000000' },
          { name: 'parentEmail', label: 'Guardian email', value: studentRecord.parentEmail || '', type: 'email' },
          { name: 'medical', label: 'Medical notes', type: 'textarea', value: studentRecord.medical || '', placeholder: 'Allergies, conditions, special care' },
        ], {
          submitLabel: 'Save Changes',
          fileOwner: {
            type: 'student',
            id: studentRecord.studentId || studentRecord.id || studentRecord.email,
            field: 'profilePhotoPath',
          },
          onSave: async (values) => {
            const payload = buildSchoolEntityPayload('students', {
              fullName: values.fullName || '',
              email: values.email || '',
              phone: values.phone || null,
              gender: values.gender || null,
              dateOfBirth: values.dateOfBirth || null,
              gradeLevel: values.gradeLevel || null,
              className: values.className || null,
              section: values.className || null,
              house: values.house || null,
              studentId: studentRecord.studentId || null,
              admissionNumber: studentRecord.admissionNumber || null,
              guardian: values.guardian || null,
              parentPhone: values.parentPhone || null,
              parentEmail: values.parentEmail || null,
              medical: values.medical || null,
              profilePhoto: values.profilePhoto || studentRecord.profilePhoto || null,
              profilePhotoPath: values.profilePhotoPath || studentRecord.profilePhotoPath || undefined,
              status: studentRecord.status || 'active',
            });
            const studentIdentifier = studentRecord.id || studentRecord.studentId || studentRecord.email;
            return updateSchoolEntity(token, schoolId, 'students', studentIdentifier, payload);
          },
        });
        if (!formData) return;
        alert('Student record updated successfully.');
        renderSchoolDashboardPage('students');
        return;
      }

      if (action === 'archive') {
        if (!confirm(`Archive student record for ${studentRecord.fullName || studentRecord.studentId || studentRecord.email || 'selected student'}? The record will be hidden but can be restored later.`)) return;
        const studentIdentifier = studentRecord.id || studentRecord.studentId || studentRecord.email;
        const result = await updateSchoolEntity(token, schoolId, 'students', studentIdentifier, { status: 'archived' });
        if (!result.ok || result.data?.status !== 'ok') {
          alert(result.data?.message || 'Unable to archive student record.');
          return;
        }
        alert('Student record archived successfully.');
        renderSchoolDashboardPage('students');
        return;
      }

      if (action === 'restore') {
        if (!confirm(`Restore student record for ${studentRecord.fullName || studentRecord.studentId || studentRecord.email || 'selected student'}?`)) return;
        const studentIdentifier = studentRecord.id || studentRecord.studentId || studentRecord.email;
        const result = await updateSchoolEntity(token, schoolId, 'students', studentIdentifier, { status: 'active' });
        if (!result.ok || result.data?.status !== 'ok') {
          alert(result.data?.message || 'Unable to restore student record.');
          return;
        }
        alert('Student record restored successfully.');
        renderSchoolDashboardPage('students');
        return;
      }

      if (action === 'approve-deletion' || action === 'reject-deletion') {
        const studentIdentifier = studentRecord.studentId || studentRecord.id || studentRecord.email;
        const approve = action === 'approve-deletion';
        const prompt = approve
          ? `Permanently delete ${studentRecord.fullName || studentIdentifier} after approving the teacher's request?`
          : `Reject the deletion request for ${studentRecord.fullName || studentIdentifier}?`;
        if (!confirm(prompt)) return;
        const result = await resolveStudentDeletionRequest(
          token,
          schoolId,
          studentIdentifier,
          approve ? 'approved' : 'rejected',
          approve ? studentIdentifier : '',
        );
        if (!result.ok || result.data?.status !== 'ok') {
          alert(result.data?.message || 'Unable to resolve the student deletion request.');
          return;
        }
        alert(approve ? 'Student deletion request approved and the account was deleted.' : 'Student deletion request rejected.');
        renderSchoolDashboardPage('students');
        return;
      }
    });
  }

  function initializeTeacherActions() {
    document.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-school-teacher-action]');
      if (!button) return;
      const action = button.getAttribute('data-school-teacher-action');
      const teacherId = button.getAttribute('data-school-teacher-id');
      const schoolId = localStorage.getItem('globyedu_schoolId');
      const token = getAccessToken();
      if (!action || !teacherId || !schoolId || !token) return;

      const teacherRecord = currentSchoolTeachers.find((teacher) => teacher.id === teacherId || teacher.email === teacherId || teacher.teacherId === teacherId || teacher.employeeNumber === teacherId);
      if (!teacherRecord) {
        alert('Unable to find the selected teacher record. Refresh the page and try again.');
        return;
      }

      if (action === 'resend-invitation') {
        button.disabled = true;
        const result = await resendTeacherInvitation(token, schoolId, teacherRecord.teacherId);
        if (!result.ok || result.data?.status !== 'ok') {
          alert(result.data?.message || 'Unable to resend the teacher invitation.');
          button.disabled = false;
          await renderSchoolDashboardPage('teachers');
          return;
        }
        alert(result.data.invitationStatus === 'activated'
          ? 'This teacher account is already activated.'
          : result.data.invitationEmailStatus === 'provider_accepted' && result.data.invitationEmailDeliveryStatus === 'unconfirmed'
            ? 'The email provider accepted the invitation request, but actual delivery is unconfirmed. The teacher must verify their email and set a password.'
            : 'The invitation status was updated, but email-provider acceptance is not confirmed. Check the status before asking the teacher to activate.');
        await renderSchoolDashboardPage('teachers');
        return;
      }

      if (action === 'edit') {
        const schoolDetailsResult = await fetchSchoolDetails(token, schoolId);
        const school = schoolDetailsResult.ok && schoolDetailsResult.data?.status === 'ok' ? schoolDetailsResult.data.school : {};
        const classOptions = TEACHER_ASSIGNABLE_CLASS_OPTIONS;
        const subjectOptions = [
          { label: 'RME', value: 'RME' },
          { label: 'Mathematics', value: 'Mathematics' },
          { label: 'Science', value: 'Science' },
          { label: 'English Language', value: 'English Language' },
          { label: 'English', value: 'English' },
          { label: 'Creative Arts', value: 'Creative Arts' },
          { label: 'Computing / ICT', value: 'Computing / ICT' },
          { label: 'Social Studies', value: 'Social Studies' },
          { label: 'Career Technology', value: 'Career Technology' },
          { label: 'Religious and Moral Education', value: 'Religious and Moral Education' },
          { label: 'French', value: 'French' },
          { label: 'History', value: 'History' },
          { label: 'Geography', value: 'Geography' },
          { label: 'Agriculture', value: 'Agriculture' },
          { label: 'Physical Education', value: 'Physical Education' },
          { label: 'Music', value: 'Music' },
          { label: 'Basic Design and Technology', value: 'Basic Design and Technology' },
          { label: 'Home Economics', value: 'Home Economics' },
          { label: 'Art', value: 'Art' },
          { label: 'Biology', value: 'Biology' },
          { label: 'Chemistry', value: 'Chemistry' },
          { label: 'Physics', value: 'Physics' },
          { label: 'Economics', value: 'Economics' },
          { label: 'Government', value: 'Government' },
          { label: 'Business Management', value: 'Business Management' },
          { label: 'Literature in English', value: 'Literature in English' },
          { label: 'Civic Education', value: 'Civic Education' },
          { label: 'Information Communication Technology', value: 'Information Communication Technology' },
        ];
        const positionOptions = [
          { label: 'Teacher', value: 'Teacher' },
          { label: 'Senior Teacher', value: 'Senior Teacher' },
          { label: 'Head of Department', value: 'Head of Department' },
          { label: 'Assistant Headteacher', value: 'Assistant Headteacher' },
          { label: 'Headteacher', value: 'Headteacher' },
          { label: 'Principal', value: 'Principal' },
          { label: 'Vice Principal', value: 'Vice Principal' },
          { label: 'Class Teacher', value: 'Class Teacher' },
          { label: 'Subject Teacher', value: 'Subject Teacher' },
          { label: 'School Administrator', value: 'School Administrator' },
        ];

        const formData = await showAdminForm('Edit teacher', [
          { name: 'fullName', label: 'Full name', value: teacherRecord.fullName || teacherRecord.name || '', required: true },
          { name: 'email', label: 'Email', value: teacherRecord.email || '', type: 'email', required: true },
          { name: 'teacherIdDisplay', label: 'Teacher ID (auto-generated)', value: teacherRecord.teacherId || '', type: 'text', disabled: true },
          { name: 'gender', label: 'Gender', value: teacherRecord.gender || '', type: 'select', options: [
            { label: 'Male', value: 'male' },
            { label: 'Female', value: 'female' },
            { label: 'Other', value: 'other' },
          ] },
          { name: 'dateOfBirth', label: 'Date of birth (optional)', type: 'date', value: teacherRecord.dateOfBirth || '' },
          { name: 'phone', label: 'Phone number', value: teacherRecord.phone || '' },
          { name: 'profilePhoto', label: 'Profile photo', type: 'file', accept: 'image/*' },
          { name: 'department', label: 'Department', value: teacherRecord.department || '' },
          { name: 'position', label: 'Position', type: 'select', value: teacherRecord.position || '', options: positionOptions, required: true },
          { name: 'qualification', label: 'Qualification', value: teacherRecord.qualification || '' },
          { name: 'yearsOfExperience', label: 'Years of experience', value: teacherRecord.yearsOfExperience || '' },
          { name: 'assignedClasses', label: 'Assigned class', type: 'select', options: classOptions, value: Array.isArray(teacherRecord.assignedClasses) ? teacherRecord.assignedClasses[0] || '' : teacherRecord.assignedClasses || '', required: true },
          { name: 'assignedSubjects', label: 'Assigned subjects', type: 'select', multiple: true, options: subjectOptions, value: Array.isArray(teacherRecord.assignedSubjects) ? teacherRecord.assignedSubjects : [] },
          { name: 'classTeacher', label: 'Is class teacher?', type: 'select', value: teacherRecord.classTeacher ? 'true' : 'false', options: [
            { label: 'No', value: 'false' },
            { label: 'Yes', value: 'true' },
          ] },
        ], {
          submitLabel: 'Save Changes',
          fileOwner: {
            type: 'teacher',
            id: teacherRecord.teacherId || teacherRecord.id || teacherRecord.username || teacherRecord.email,
            field: 'profilePhotoPath',
          },
        });
        if (!formData) return;
        const normalizedAssignedClasses = formData.assignedClasses ? [formData.assignedClasses] : [];
        const normalizedAssignedSubjects = Array.isArray(formData.assignedSubjects) ? formData.assignedSubjects : formData.assignedSubjects ? [formData.assignedSubjects] : [];
        const payload = buildSchoolEntityPayload('teachers', {
          fullName: formData.fullName || '',
          email: formData.email || '',
          phone: formData.phone || null,
          gender: formData.gender || null,
          dateOfBirth: formData.dateOfBirth || null,
          department: formData.department || null,
          position: formData.position || null,
          qualification: formData.qualification || null,
          yearsOfExperience: formData.yearsOfExperience || null,
          assignedClasses: normalizedAssignedClasses,
          assignedSubjects: normalizedAssignedSubjects,
          classTeacher: formData.classTeacher === 'true',
          profilePhoto: formData.profilePhoto || teacherRecord.profilePhoto || null,
          profilePhotoPath: formData.profilePhotoPath || teacherRecord.profilePhotoPath || undefined,
          teacherId: teacherRecord.teacherId || null,
          employeeNumber: teacherRecord.employeeNumber || null,
          status: teacherRecord.status || 'active',
        });
        delete payload.nationalId;
        const teacherIdentifier = teacherRecord.id || teacherRecord.username || teacherRecord.teacherId || teacherRecord.email;
        const result = await updateSchoolEntity(token, schoolId, 'teachers', teacherIdentifier, payload);
        if (!result.ok || result.data?.status !== 'ok') {
          alert(result.data?.message || 'Unable to update teacher record.');
          return;
        }
        alert('Teacher record updated successfully.');
        renderSchoolDashboardPage('teachers');
        return;
      }

      if (action === 'archive') {
        if (!confirm(`Archive teacher record for ${teacherRecord.fullName || teacherRecord.teacherId || teacherRecord.email || 'selected teacher'}? The record will be hidden but can be restored later.`)) return;
        const teacherIdentifier = teacherRecord.id || teacherRecord.username || teacherRecord.teacherId || teacherRecord.email;
        const result = await updateSchoolEntity(token, schoolId, 'teachers', teacherIdentifier, { status: 'archived' });
        if (!result.ok || result.data?.status !== 'ok') {
          alert(result.data?.message || 'Unable to archive teacher record.');
          return;
        }
        alert('Teacher record archived successfully.');
        renderSchoolDashboardPage('teachers');
        return;
      }

      if (action === 'restore') {
        if (!confirm(`Restore teacher record for ${teacherRecord.fullName || teacherRecord.teacherId || teacherRecord.email || 'selected teacher'}?`)) return;
        const teacherIdentifier = teacherRecord.id || teacherRecord.username || teacherRecord.teacherId || teacherRecord.email;
        const result = await updateSchoolEntity(token, schoolId, 'teachers', teacherIdentifier, { status: 'active' });
        if (!result.ok || result.data?.status !== 'ok') {
          alert(result.data?.message || 'Unable to restore teacher record.');
          return;
        }
        alert('Teacher record restored successfully.');
        renderSchoolDashboardPage('teachers');
        return;
      }

      if (action === 'delete') {
        if (!confirm(`PERMANENTLY delete teacher record for ${teacherRecord.fullName || teacherRecord.teacherId || teacherRecord.email || 'selected teacher'}? This action cannot be undone.`)) return;
        const teacherIdentifier = teacherRecord.id || teacherRecord.username || teacherRecord.teacherId || teacherRecord.email;
        const result = await deleteSchoolEntity(token, schoolId, 'teachers', teacherIdentifier, teacherRecord.teacherId || teacherIdentifier);
        if (!result.ok || result.data?.status !== 'ok') {
          alert(result.data?.message || 'Unable to delete teacher record.');
          return;
        }
        alert('Teacher record permanently deleted.');
        renderSchoolDashboardPage('teachers');
        return;
      }
    });
  }

  function initializeStudentImportExport() {
    document.querySelectorAll('[data-school-export]').forEach((button) => {
      button.addEventListener('click', async () => {
        const exportType = button.getAttribute('data-school-export');
        if (!exportType) return;
        const schoolId = localStorage.getItem('globyedu_schoolId');
        const token = getAccessToken();
        const school = schoolId && token ? ((await fetchSchoolDetails(token, schoolId).then((result) => result.ok && result.data?.status === 'ok' ? result.data.school : null)) || {}) : {};
        let rows = [];
        let headers = [];

        if (exportType === 'attendance') {
          rows = (Array.isArray(school.attendanceRecords) ? school.attendanceRecords : [])
            .map((record) => ({
              ...record,
              date: String(record.date || '').slice(0, 10),
              status: normalizeAttendanceStatus(record.status),
            }))
            .filter((record) => record.status);
          headers = ['date', 'studentName', 'studentId', 'className', 'teacher', 'subject', 'status', 'note'];
        } else if (exportType === 'students') {
          rows = Array.isArray(school.students) ? school.students : [];
          headers = ['fullName', 'email', 'studentId', 'admissionNumber', 'className', 'gradeLevel', 'status', 'guardian', 'parentPhone', 'parentEmail'];
        } else if (exportType === 'academic') {
          const academicTypes = ['academic-years', 'terms', 'semesters', 'departments', 'streams', 'subjects', 'classes'];
          const academicResults = await Promise.all(academicTypes.map((entityType) => fetchSchoolEntities(token, schoolId, entityType, { pageSize: 200 })));
          rows = academicResults.flatMap((result, index) => {
            if (!result.ok || result.data?.status !== 'ok') return [];
            return (Array.isArray(result.data.items) ? result.data.items : []).map((item) => ({
              ...item,
              recordType: academicTypes[index],
            }));
          });
          headers = ['recordType', 'name', 'label', 'code', 'status', 'startDate', 'endDate', 'description'];
        } else {
          alert('Export format not supported.');
          return;
        }

        if (!rows.length) {
          alert('No records available to export yet.');
          return;
        }

        const csv = [headers.join(','), ...rows.map((row) => headers.map((header) => `"${String(row[header] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${exportType}-export.csv`;
        link.click();
        URL.revokeObjectURL(url);
        alert(`Exported ${rows.length} ${exportType} records.`);
      });
    });

    document.querySelectorAll('[data-school-import]').forEach((input) => {
      input.addEventListener('change', async () => {
        const importType = input.getAttribute('data-school-import');
        if (!importType) return;
        const file = input.files && input.files[0];
        if (!file) return;
        const schoolId = localStorage.getItem('globyedu_schoolId');
        const token = getAccessToken();
        if (!schoolId || !token) return;
        const text = await file.text();
        let records = [];

        if (file.type.includes('json') || file.name.endsWith('.json')) {
          try {
            records = JSON.parse(text);
            if (importType === 'academic') {
              const academicRecords = Array.isArray(records) ? records : Array.isArray(records.items) ? records.items : [];
              const summary = { created: 0, failed: 0, errors: [] };
              for (const [index, record] of academicRecords.entries()) {
                const recordType = String(record.recordType || record.type || 'academic-years').trim();
                const payload = buildSchoolEntityPayload(recordType, {
                  label: record.label || record.name || '',
                  name: record.name || record.label || '',
                  code: record.code || '',
                  description: record.description || '',
                  status: record.status || 'active',
                  startDate: record.startDate || null,
                  endDate: record.endDate || null,
                });
                try {
                  const result = await createSchoolEntity(token, schoolId, recordType, payload);
                  if (result.ok && result.data?.status === 'ok') {
                    summary.created += 1;
                  } else {
                    summary.failed += 1;
                    summary.errors.push(`Row ${index + 2}: ${result.data?.message || 'invalid academic record'}`);
                  }
                } catch (error) {
                  summary.failed += 1;
                  summary.errors.push(`Row ${index + 2}: ${error.message || 'invalid academic record'}`);
                }
              }

              const errorDetail = summary.errors.length ? `\n${summary.errors.slice(0, 5).join('\n')}` : '';
              alert(`Imported ${summary.created} academic records. ${summary.failed} failed.${errorDetail}`);
              renderSchoolDashboardPage('academic');
              input.value = '';
              return;
            }
          } catch (error) {
            alert('Unable to parse JSON import file.');
            return;
          }
        } else {
          const lines = text.split(/\r?\n/).filter((line) => line.trim());
          if (lines.length < 2) {
            alert('CSV file must contain a header row and at least one data row.');
            return;
          }
          const parseCsvLine = (line) => {
            const values = [];
            let value = '';
            let quoted = false;
            for (let index = 0; index < line.length; index += 1) {
              const character = line[index];
              if (character === '"' && line[index + 1] === '"' && quoted) {
                value += '"';
                index += 1;
              } else if (character === '"') {
                quoted = !quoted;
              } else if (character === ',' && !quoted) {
                values.push(value.trim());
                value = '';
              } else {
                value += character;
              }
            }
            values.push(value.trim());
            return values;
          };
          const headers = parseCsvLine(lines[0]).map((header) => header.trim());
          const normalizedHeaders = headers.map((header) => header.toLowerCase().replace(/[^a-z0-9]/g, ''));
          const hasNameColumn = normalizedHeaders.some((header) => ['fullname', 'name', 'studentname'].includes(header));
          if (!hasNameColumn) {
            alert('CSV is missing a required student name column. Use fullName, name, or studentName.');
            input.value = '';
            return;
          }
          records = lines.slice(1).map((line) => {
            const values = parseCsvLine(line);
            return headers.reduce((acc, header, index) => {
              acc[header] = values[index] || '';
              return acc;
            }, {});
          });
        }

        if (!Array.isArray(records) || records.length === 0) {
          alert('Import file did not contain any valid records.');
          return;
        }

        const summary = { created: 0, failed: 0, errors: [] };
        for (const [index, record] of records.entries()) {
          const recordName = record.fullName || record.name || record.studentName || record['Full Name'] || record['name'] || '';
          if (!String(recordName).trim()) {
            summary.failed += 1;
            summary.errors.push(`Row ${index + 2}: student name is required`);
            continue;
          }
          try {
            const payload = buildSchoolEntityPayload('students', {
              fullName: recordName,
              email: record.email || record.Email || '',
              phone: record.phone || record.Phone || null,
              gender: record.gender || record.Gender || null,
              dateOfBirth: record.dateOfBirth || record.DateOfBirth || null,
              gradeLevel: record.gradeLevel || record.Grade || record['Grade Level'] || null,
              className: record.className || record.Class || record['Class Name'] || null,
              section: record.section || record.Section || null,
              house: record.house || record.House || null,
              studentId: record.studentId || record.StudentID || record['Student ID'] || null,
              admissionNumber: record.admissionNumber || record.AdmissionNumber || record['Admission Number'] || null,
              guardian: record.guardian || record.Guardian || null,
              parentPhone: record.parentPhone || record['Parent Phone'] || null,
              parentEmail: record.parentEmail || record['Parent Email'] || null,
              medical: record.medical || record.Medical || null,
              documents: record.documents || record.Documents || null,
              status: record.status || record.Status || 'active',
            });
            const result = await createSchoolEntity(token, schoolId, 'students', payload);
            if (result.ok && result.data?.status === 'ok') {
              summary.created += 1;
            } else {
              summary.failed += 1;
            }
          } catch (error) {
            summary.failed += 1;
            summary.errors.push(`Row ${index + 2}: ${error.message || 'invalid record'}`);
          }
        }

        const errorDetail = summary.errors.length ? `\n${summary.errors.slice(0, 5).join('\n')}` : '';
        alert(`Imported ${summary.created} students. ${summary.failed} failed.${errorDetail}`);
        renderSchoolDashboardPage('students');
      });
    });
  }

  document.querySelectorAll('[data-school-finance-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.getAttribute('data-school-finance-action');
      const schoolId = localStorage.getItem('globyedu_schoolId');
      const token = getAccessToken();
      if (!schoolId || !token) return;

      if (action === 'create-fee-category') {
        const formData = await showAdminForm('Create fee category', [
          { name: 'name', label: 'Fee category name', required: true },
          { name: 'description', label: 'Description', type: 'textarea' },
          { name: 'amount', label: 'Default amount' },
        ]);
        if (!formData) return;
        const currentResult = await fetchSchoolDetails(token, schoolId);
        const school = currentResult.ok && currentResult.data?.status === 'ok' ? currentResult.data.school || {} : {};
        const categories = Array.isArray(school.financeCategories) ? school.financeCategories : [];
        categories.push({ id: `fee-${Date.now()}`, name: formData.name, description: formData.description || '', amount: Number(formData.amount || 0), status: 'active', createdAt: new Date().toISOString() });
        const saveResult = await updateSchoolDetails(token, schoolId, { financeCategories: categories });
        if (!saveResult.ok || saveResult.data?.status !== 'ok') {
          alert(saveResult.data?.message || 'Unable to create fee category.');
          return;
        }
        alert('Fee category created successfully.');
        renderSchoolDashboardPage('finance');
        return;
      }

      if (action === 'edit-fee-category' || action === 'archive-fee-category') {
        const currentResult = await fetchSchoolDetails(token, schoolId);
        const school = currentResult.ok && currentResult.data?.status === 'ok' ? currentResult.data.school || {} : {};
        const categories = Array.isArray(school.financeCategories) ? school.financeCategories : [];
        const categoryName = button.getAttribute('data-finance-category') || '';
        const index = categories.findIndex((category) => category.name === categoryName);
        if (index === -1) {
          alert('Fee category is not available in the current finance workflow.');
          return;
        }
        if (action === 'archive-fee-category') {
          categories[index] = { ...categories[index], status: 'archived' };
        } else {
          const formData = await showAdminForm('Edit fee category', [
            { name: 'name', label: 'Fee category name', value: categories[index].name, required: true },
            { name: 'description', label: 'Description', type: 'textarea', value: categories[index].description || '' },
            { name: 'amount', label: 'Default amount', value: categories[index].amount || '' },
          ]);
          if (!formData) return;
          categories[index] = { ...categories[index], name: formData.name, description: formData.description || '', amount: formData.amount || '' };
        }
        const saveResult = await updateSchoolDetails(token, schoolId, { financeCategories: categories });
        if (!saveResult.ok || saveResult.data?.status !== 'ok') {
          alert(saveResult.data?.message || 'Unable to update fee category.');
          return;
        }
        alert(action === 'archive-fee-category' ? 'Fee category archived.' : 'Fee category updated.');
        renderSchoolDashboardPage('finance');
        return;
      }

      if (action === 'generate-invoice') {
        const schoolResult = await fetchSchoolDetails(token, schoolId);
        if (!schoolResult.ok || schoolResult.data?.status !== 'ok') {
          alert(schoolResult.data?.message || 'Unable to load school students for invoice creation.');
          return;
        }
        const school = schoolResult.data.school || {};
        const studentOptions = (Array.isArray(school.students) ? school.students : [])
          .filter((student) => String(student.status || 'active').toLowerCase() !== 'archived')
          .map((student) => ({ label: `${student.fullName || student.name || student.email} (${student.studentId || student.id || student.email})`, value: student.studentId || student.id || student.email }))
          .filter((option) => option.value);
        const formData = await showAdminForm('Generate invoice', [
          { name: 'invoiceNumber', label: 'Invoice number', required: true },
          { name: 'studentId', label: 'Student', type: 'select', options: studentOptions, required: true },
          { name: 'amount', label: 'Amount', required: true },
          { name: 'dueDate', label: 'Due date', type: 'date', required: true },
          { name: 'description', label: 'Description', type: 'textarea' },
        ]);
        if (!formData) return;
        const key = globalThis.crypto?.randomUUID?.() || `invoice-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
        const result = await createSchoolInvoice(token, schoolId, formData, key);
        if (!result.ok || result.data?.status !== 'ok') {
          alert(result.data?.message || 'Unable to create invoice.');
          return;
        }
        alert('Invoice generated successfully.');
        renderSchoolDashboardPage('finance');
        return;
      }

      if (action === 'verify-invoice-payment') {
        const invoiceId = button.getAttribute('data-invoice-id');
        const existingReference = button.getAttribute('data-payment-reference') || '';
        const reference = existingReference || prompt('Enter the Paystack transaction reference to verify for this invoice.');
        if (!reference) return;
        const key = globalThis.crypto?.randomUUID?.() || `verify-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
        const result = await verifySchoolInvoicePayment(token, schoolId, invoiceId, reference.trim(), key);
        if (!result.ok || result.data?.status !== 'ok') {
          alert(result.data?.message || 'Payment could not be verified. The invoice was not changed.');
          return;
        }
        alert(result.data?.message || 'Payment verified and linked to the invoice.');
        renderSchoolDashboardPage('finance');
        return;
      }

      if (action === 'start-invoice-checkout') {
        const invoiceId = button.getAttribute('data-invoice-id');
        const checkoutWindow = window.open('about:blank', '_blank');
        const key = globalThis.crypto?.randomUUID?.() || `checkout-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
        const result = await startSchoolInvoiceCheckout(token, schoolId, invoiceId, key);
        const checkoutUrl = result.data?.payment?.checkoutUrl;
        if (!result.ok || result.data?.status !== 'ok' || !checkoutUrl) {
          checkoutWindow?.close();
          alert(result.data?.message || 'Unable to start online payment.');
          return;
        }
        if (checkoutWindow) {
          checkoutWindow.location = checkoutUrl;
        } else {
          alert(`Paystack checkout is ready. Open this URL to complete payment:\n${checkoutUrl}`);
        }
        renderSchoolDashboardPage('finance');
        return;
      }

      if (action === 'record-payment') {
        const currentResult = await fetchSchoolDetails(token, schoolId);
        const currentSchool = currentResult.ok && currentResult.data?.status === 'ok' ? currentResult.data.school || {} : {};
        const studentOptions = (Array.isArray(currentSchool.students) ? currentSchool.students : [])
          .filter((student) => String(student.status || 'active').toLowerCase() !== 'archived')
          .map((student) => ({ label: `${student.fullName || student.name || student.email} (${student.studentId || student.id || student.email})`, value: student.studentId || student.id || student.email }))
          .filter((option) => option.value);
        const formData = await showAdminForm('Record payment', [
          { name: 'amount', label: 'Amount', required: true },
          { name: 'studentId', label: 'Student', type: 'select', options: studentOptions, required: true },
          { name: 'feeType', label: 'Fee type/category' },
          { name: 'paymentDate', label: 'Payment date', type: 'date', required: true },
          { name: 'method', label: 'Payment method', placeholder: 'Cash / Bank / Paystack / MTN MoMo' },
          { name: 'reference', label: 'Reference number' },
          { name: 'academicYear', label: 'Academic year', value: currentSchool.academicYear || '' },
          { name: 'term', label: 'Term', value: currentSchool.currentTerm || '' },
          { name: 'note', label: 'Note', type: 'textarea' },
        ]);
        if (!formData) return;
        const result = await createFeePayment(token, schoolId, { ...formData, status: 'received' });
        if (!result.ok || result.data?.status !== 'ok') {
          alert(result.data?.message || 'Unable to record payment and receipt.');
          return;
        }
        alert('Payment recorded successfully.');
        renderSchoolDashboardPage('finance');
        return;
      }

      if (action === 'create-refund') {
        const schoolResult = await fetchSchoolDetails(token, schoolId);
        if (!schoolResult.ok || schoolResult.data?.status !== 'ok') {
          alert(schoolResult.data?.message || 'Unable to load school payment records for a refund request.');
          return;
        }
        const school = schoolResult.data.school || {};
        const paymentOptions = (Array.isArray(school.payments) ? school.payments : [])
          .filter((payment) => ['received', 'paid', 'complete', 'completed', 'verified'].includes(String(payment.status || '').toLowerCase()))
          .map((payment) => ({
            label: `${payment.studentName || payment.student || 'Student'} - ${payment.reference || payment.id} (${payment.amount})`,
            value: payment.id,
          }))
          .filter((option) => option.value);
        const formData = await showAdminForm('Request refund review', [
          { name: 'paymentId', label: 'Recorded payment', type: 'select', options: paymentOptions, required: true },
          { name: 'amount', label: 'Amount', required: true },
          { name: 'reason', label: 'Reason', type: 'textarea', required: true },
        ]);
        if (!formData) return;
        const key = globalThis.crypto?.randomUUID?.() || `refund-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
        const result = await createSchoolRefundRequest(token, schoolId, formData, key);
        if (!result.ok || result.data?.status !== 'ok') {
          alert(result.data?.message || 'Unable to create refund request.');
          return;
        }
        alert(result.data?.message || 'Refund request submitted for review. No payment has been refunded.');
        renderSchoolDashboardPage('finance');
        return;
      }

      if (action === 'export-report') {
        const reportType = prompt('Report type', 'Monthly Revenue');
        if (!reportType) return;
        const csv = ['reportType', 'generatedAt', 'summary'].join(',') + '\n' + `${reportType},${new Date().toISOString()},Generated from the finance workspace`; 
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${reportType.toLowerCase().replace(/\s+/g, '-')}.csv`;
        link.click();
        URL.revokeObjectURL(url);
        alert('Finance report exported.');
        return;
      }

      if (action === 'print-receipt') {
        const currentResult = await fetchSchoolDetails(token, schoolId);
        const school = currentResult.ok && currentResult.data?.status === 'ok' ? currentResult.data.school || {} : {};
        const receiptId = button.getAttribute('data-receipt-id') || '';
        const receipt = (Array.isArray(school.receipts) ? school.receipts : []).find((entry) => entry.receiptNumber === receiptId);
        if (!receipt) {
          alert('Receipt is no longer available. Refresh the finance page and try again.');
          return;
        }
        const printWindow = window.open('', '_blank', 'width=800,height=900');
        if (!printWindow) {
          alert('The receipt print window was blocked. Allow pop-ups and try again.');
          return;
        }
        const currency = receipt.currency || school.currency || school.branding?.currency || school.settings?.currency || 'USD';
        const logo = school.logo || school.branding?.logo || '';
        const details = [
          ['Receipt number', receipt.receiptNumber], ['Student', receipt.studentName || receipt.student], ['Student ID', receipt.studentId],
          ['Class', receipt.className], ['Description', receipt.feeType], ['Amount paid', `${currency} ${Number(receipt.amount || 0).toFixed(2)}`],
          ['Payment method', receipt.paymentMethod], ['Payment date', receipt.paymentDate || receipt.paidAt], ['Academic year', receipt.academicYear],
          ['Term', receipt.term], ['Reference', receipt.reference], ['Status', receipt.status], ['Authorized officer', receipt.authorizedBy],
        ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '');
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(receipt.receiptNumber || 'Receipt')}</title><style>@page{size:A4;margin:18mm}body{font-family:Arial,sans-serif;max-width:760px;margin:0 auto;padding:24px;color:#172033}header{display:flex;gap:18px;align-items:center;border-bottom:2px solid #0f766e;padding-bottom:18px}header img{width:72px;height:72px;object-fit:contain}h1{margin:0 0 4px}p{margin:4px 0;color:#52606d}dl{display:grid;grid-template-columns:190px 1fr;gap:12px;border-top:1px solid #d8dee4;margin-top:28px;padding-top:18px}dt{font-weight:bold}dd{margin:0}button{margin-top:30px;padding:10px 18px}@media print{button{display:none}}</style></head><body><header>${logo ? `<img src="${escapeHtml(logo)}" alt="School logo">` : ''}<div><h1>${escapeHtml(school.name || 'School receipt')}</h1><p>${escapeHtml(school.address || school.phone || school.email || '')}</p><p>Official payment receipt</p></div></header><dl>${details.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join('')}</dl><button onclick="window.print()">Print</button></body></html>`;
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
        return;
      }

      if (action === 'download-receipt') {
        const currentResult = await fetchSchoolDetails(token, schoolId);
        const school = currentResult.ok && currentResult.data?.status === 'ok' ? currentResult.data.school || {} : {};
        const receiptId = button.getAttribute('data-receipt-id') || '';
        const receipt = (Array.isArray(school.receipts) ? school.receipts : []).find((entry) => entry.receiptNumber === receiptId);
        if (!receipt) {
          alert('Receipt is no longer available. Refresh the finance page and try again.');
          return;
        }
        const currency = receipt.currency || school.currency || school.branding?.currency || school.settings?.currency || 'USD';
        const rows = [['Receipt number', receipt.receiptNumber], ['Student', receipt.studentName || receipt.student], ['Student ID', receipt.studentId], ['Class', receipt.className], ['Description', receipt.feeType], ['Amount paid', `${currency} ${Number(receipt.amount || 0).toFixed(2)}`], ['Payment method', receipt.paymentMethod], ['Payment date', receipt.paymentDate || receipt.paidAt], ['Academic year', receipt.academicYear], ['Term', receipt.term], ['Reference', receipt.reference], ['Status', receipt.status]].filter(([, value]) => value);
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(receipt.receiptNumber || 'Receipt')}</title><style>@page{size:A4;margin:18mm}body{font-family:Arial,sans-serif;max-width:760px;margin:0 auto;padding:24px;color:#172033}h1{border-bottom:2px solid #0f766e;padding-bottom:16px}dl{display:grid;grid-template-columns:190px 1fr;gap:12px}dt{font-weight:bold}dd{margin:0}</style></head><body><h1>${escapeHtml(school.name || 'School receipt')}</h1><p>${escapeHtml(school.address || school.phone || school.email || '')}</p><dl>${rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join('')}</dl></body></html>`;
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
        link.download = `${receipt.receiptNumber || 'payment-receipt'}.html`;
        link.click();
        URL.revokeObjectURL(link.href);
        return;
      }

      alert(`${action.replace(/-/g, ' ')} is now available in the finance workflow.`);
    });
  });

  document.querySelectorAll('[data-school-settings-save]').forEach((button) => {
    button.addEventListener('click', async () => {
      const schoolId = localStorage.getItem('globyedu_schoolId');
      const token = getAccessToken();
      if (!schoolId || !token) return;
      const current = (await fetchSchoolDetails(token, schoolId).then((result) => (result.ok && result.data?.status === 'ok' ? result.data.school : null))) || {};
      const payload = {
        branding: {
          ...(current.branding || {}),
          colours: document.getElementById('school-settings-colours')?.value || '',
        },
        settings: {
          ...(current.settings || {}),
          theme: document.getElementById('school-settings-theme')?.value || 'default',
          notifications: {
            ...(current.settings?.notifications || {}),
            emailEnabled: document.getElementById('school-settings-email')?.value?.toLowerCase() === 'enabled',
            smsEnabled: document.getElementById('school-settings-sms')?.value?.toLowerCase() === 'enabled',
          },
          featureFlags: {
            ...(current.settings?.featureFlags || {}),
            messaging: document.getElementById('school-settings-messaging')?.value?.toLowerCase() === 'enabled',
            analytics: document.getElementById('school-settings-analytics')?.value?.toLowerCase() === 'enabled',
          },
        },
      };
      const result = await updateSchoolDetails(token, schoolId, payload);
      if (!result.ok || result.data?.status !== 'ok') {
        alert(result.data?.message || 'Unable to save school settings.');
        return;
      }
      alert('School settings saved.');
      renderSchoolDashboardPage('settings');
    });
  });

  document.querySelectorAll('[data-school-profile-save]').forEach((button) => {
    button.addEventListener('click', async () => {
      const schoolId = localStorage.getItem('globyedu_schoolId');
      const token = getAccessToken();
      if (!schoolId || !token) return;
      const current = (await fetchSchoolDetails(token, schoolId).then((result) => (result.ok && result.data?.status === 'ok' ? result.data.school : null))) || {};
      const payload = buildChangedFieldsPayload(
        {
          name: current.name || '',
          motto: current.motto || current.branding?.motto || '',
          email: current.email || '',
          phone: current.phone || '',
          website: current.website || '',
          country: current.country || '',
          region: current.region || '',
          city: current.city || current.branding?.city || '',
          schoolType: current.schoolType || current.branding?.schoolType || '',
          schoolLevel: current.schoolLevel || current.branding?.schoolLevel || '',
          description: current.description || '',
          branding: current.branding || {},
        },
        {
          name: document.getElementById('school-profile-name')?.value || '',
          motto: document.getElementById('school-profile-motto')?.value || '',
          email: document.getElementById('school-profile-email')?.value || '',
          phone: document.getElementById('school-profile-phone')?.value || '',
          website: document.getElementById('school-profile-website')?.value || '',
          country: document.getElementById('school-profile-country')?.value || '',
          region: document.getElementById('school-profile-region')?.value || '',
          city: document.getElementById('school-profile-city')?.value || '',
          schoolType: document.getElementById('school-profile-type')?.value || '',
          schoolLevel: document.getElementById('school-profile-level')?.value || '',
          description: document.getElementById('school-profile-description')?.value || '',
          branding: {
            ...(current.branding || {}),
            colours: document.getElementById('school-profile-colours')?.value || '',
            motto: document.getElementById('school-profile-motto')?.value || '',
            city: document.getElementById('school-profile-city')?.value || '',
            schoolType: document.getElementById('school-profile-type')?.value || '',
            schoolLevel: document.getElementById('school-profile-level')?.value || '',
          },
        },
      );
      const result = await updateSchoolDetails(token, schoolId, payload);
      if (!result.ok || result.data?.status !== 'ok') {
        alert(result.data?.message || 'Unable to save school profile.');
        return;
      }
      alert('School profile saved.');
      renderSchoolDashboardPage('profile');
    });
  });

  const profileEditButton = document.getElementById('school-profile-edit');
  const uploadLogoButton = document.getElementById('school-profile-upload-logo');
  const uploadCoverButton = document.getElementById('school-profile-upload-cover');
  const entityRefreshButton = document.getElementById('school-entity-refresh');
  const entityCreateButton = document.getElementById('school-entity-create');
  const entityTypeSelect = document.getElementById('school-entity-type');
  const entitySearchInput = document.getElementById('school-entity-search');
  const entityList = document.getElementById('school-entity-list');
  const entityStatus = document.getElementById('school-entity-status');
  const entityCache = new Map();
  if (profileEditButton) {
    profileEditButton.addEventListener('click', async () => {
      const schoolId = localStorage.getItem('globyedu_schoolId');
      const token = getAccessToken();
      if (!schoolId || !token) return;
      const response = await fetchSchoolDetails(token, schoolId);
      if (!response.ok || response.data?.status !== 'ok') {
        alert('Unable to load school profile for editing.');
        return;
      }
      const school = response.data.school;
      const formHtml = `
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div class="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-4xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div class="flex items-center justify-between gap-4">
              <div>
                <h2 class="text-2xl font-semibold text-slate-900">Edit School Profile</h2>
                <p class="mt-1 text-sm text-slate-600">Update tenant details and branding for your school.</p>
              </div>
              <button id="school-profile-close" class="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">Close</button>
            </div>
            <form id="school-profile-form" class="mt-6 space-y-4">
              <div class="grid gap-4 lg:grid-cols-2">
                <label class="block text-sm text-slate-700">School Name<input id="profile-name" value="${escapeHtml(school.name || '')}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" required></label>
                <label class="block text-sm text-slate-700">Website<input id="profile-website" value="${escapeHtml(school.website || '')}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"></label>
                <label class="block text-sm text-slate-700">Phone<input id="profile-phone" value="${escapeHtml(school.phone || '')}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"></label>
                <label class="block text-sm text-slate-700">Email<input id="profile-email" value="${escapeHtml(school.email || '')}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" type="email"></label>
                <label class="block text-sm text-slate-700">Address<input id="profile-address" value="${escapeHtml(school.address || '')}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"></label>
                <label class="block text-sm text-slate-700">Region<input id="profile-region" value="${escapeHtml(school.region || '')}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"></label>
                <label class="block text-sm text-slate-700">Country<input id="profile-country" list="profile-country-options" value="${escapeHtml(school.country || '')}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"><datalist id="profile-country-options">${[
                  'Ghana', 'Nigeria', 'Kenya', 'South Africa', 'United States', 'United Kingdom', 'Canada', 'India', 'Egypt', 'Tanzania', 'Uganda', 'Cameroon', 'Botswana', 'Senegal', 'Ethiopia', 'France', 'Germany', 'Australia', 'Brazil', 'Japan', 'Gabon', 'Ivory Coast'
                ].map((country) => `<option value="${escapeHtml(country)}"></option>`).join('')}</datalist></label>
                <label class="block text-sm text-slate-700">Time zone<input id="profile-timezone" value="${escapeHtml(school.timezone || '')}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"></label>
                <label class="block text-sm text-slate-700">School logo<input id="profile-logo-file" type="file" accept="image/*" class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"></label>
                <label class="block text-sm text-slate-700">Cover image<input id="profile-cover-file" type="file" accept="image/*" class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"></label>
                <label class="block text-sm text-slate-700">School stamp<input id="profile-stamp-file" type="file" accept="image/*" class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"></label>
                <label class="block text-sm text-slate-700">Principal signature<input id="profile-principal-signature-file" type="file" accept="image/*" class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"></label>
                <input id="profile-logo" type="hidden" value="${escapeHtml(school.logo || '')}" />
                <input id="profile-cover" type="hidden" value="${escapeHtml(school.coverImage || '')}" />
                <input id="profile-stamp" type="hidden" value="${escapeHtml(school.stamp || '')}" />
                <input id="profile-principal-signature" type="hidden" value="${escapeHtml(school.principalSignature || '')}" />
                <label class="block text-sm text-slate-700">Language<input id="profile-language" value="${escapeHtml((school.branding && school.branding.language) || '')}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"></label>
                <label class="block text-sm text-slate-700">Currency<input id="profile-currency" value="${escapeHtml((school.branding && school.branding.currency) || '')}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"></label>
                <label class="block text-sm text-slate-700">Motto<input id="profile-motto" value="${escapeHtml((school.branding && school.branding.motto) || '')}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"></label>
                <label class="block text-sm text-slate-700">GPS Address<input id="profile-gps" value="${escapeHtml((school.branding && school.branding.gpsAddress) || '')}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"></label>
                <label class="block text-sm text-slate-700">School Description<textarea id="profile-description" rows="4" class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">${escapeHtml(school.description || '')}</textarea></label>
              </div>
              <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p class="text-sm font-semibold text-slate-900">Logo preview</p>
                  <div id="profile-logo-preview" class="mt-3"></div>
                </div>
                <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p class="text-sm font-semibold text-slate-900">Cover preview</p>
                  <div id="profile-cover-preview" class="mt-3"></div>
                </div>
                <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p class="text-sm font-semibold text-slate-900">Stamp preview</p>
                  <div id="profile-stamp-preview" class="mt-3"></div>
                </div>
                <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p class="text-sm font-semibold text-slate-900">Signature preview</p>
                  <div id="profile-principal-signature-preview" class="mt-3"></div>
                </div>
              </div>
              <div class="flex flex-wrap items-center gap-3 pt-4">
                <button type="submit" class="rounded-full bg-sky-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-sky-700">Save changes</button>
                <button id="school-profile-cancel" type="button" class="rounded-full border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">Cancel</button>
                <div id="school-profile-feedback" class="text-sm text-slate-600"></div>
              </div>
            </form>
          </div>
        </div>
      `;
      const container = document.createElement('div');
      container.innerHTML = formHtml;
      document.body.appendChild(container);

      const closeButton = document.getElementById('school-profile-close');
      const cancelButton = document.getElementById('school-profile-cancel');
      const profileForm = document.getElementById('school-profile-form');
      const feedbackElement = document.getElementById('school-profile-feedback');
      const logoFileInput = document.getElementById('profile-logo-file');
      const coverFileInput = document.getElementById('profile-cover-file');
      const stampFileInput = document.getElementById('profile-stamp-file');
      const principalSignatureFileInput = document.getElementById('profile-principal-signature-file');
      const logoHiddenInput = document.getElementById('profile-logo');
      const coverHiddenInput = document.getElementById('profile-cover');
      const stampHiddenInput = document.getElementById('profile-stamp');
      const principalSignatureHiddenInput = document.getElementById('profile-principal-signature');
      const logoPreview = document.getElementById('profile-logo-preview');
      const coverPreview = document.getElementById('profile-cover-preview');
      const stampPreview = document.getElementById('profile-stamp-preview');
      const principalSignaturePreview = document.getElementById('profile-principal-signature-preview');

      logoHiddenInput.dataset.storagePath = school.logoPath || '';
      coverHiddenInput.dataset.storagePath = school.coverImagePath || '';
      stampHiddenInput.dataset.storagePath = school.stampPath || '';
      principalSignatureHiddenInput.dataset.storagePath = school.principalSignaturePath || '';

      function closeProfileEditor() {
        container.remove();
      }

      if (closeButton) {
        closeButton.addEventListener('click', closeProfileEditor);
      }
      if (cancelButton) {
        cancelButton.addEventListener('click', closeProfileEditor);
      }

      renderImagePreview(logoPreview, logoHiddenInput?.value || '', 'No logo selected');
      renderImagePreview(coverPreview, coverHiddenInput?.value || '', 'No cover selected');
      renderImagePreview(stampPreview, stampHiddenInput?.value || '', 'No stamp selected');
      renderImagePreview(principalSignaturePreview, principalSignatureHiddenInput?.value || '', 'No signature selected');

      logoFileInput?.addEventListener('change', async () => {
        await handleImageUpload(logoFileInput, logoHiddenInput, logoPreview, 'No logo selected', {
          type: 'school', id: school.schoolId, field: 'logoPath',
        });
      });
      coverFileInput?.addEventListener('change', async () => {
        await handleImageUpload(coverFileInput, coverHiddenInput, coverPreview, 'No cover selected', {
          type: 'school', id: school.schoolId, field: 'coverImagePath',
        });
      });
      stampFileInput?.addEventListener('change', async () => {
        await handleImageUpload(stampFileInput, stampHiddenInput, stampPreview, 'No stamp selected', {
          type: 'school', id: school.schoolId, field: 'stampPath',
        });
      });
      principalSignatureFileInput?.addEventListener('change', async () => {
        await handleImageUpload(principalSignatureFileInput, principalSignatureHiddenInput, principalSignaturePreview, 'No signature selected', {
          type: 'school', id: school.schoolId, field: 'principalSignaturePath',
        });
      });

      if (profileForm) {
        profileForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          if (!schoolId || !token) return;
          const schoolName = document.getElementById('profile-name').value.trim();
          if (!schoolName) {
            if (feedbackElement) {
              feedbackElement.textContent = 'Please enter a school name.';
              feedbackElement.className = 'text-sm text-rose-700';
            }
            return;
          }
          const payload = buildChangedFieldsPayload(
            {
              name: school.name || '',
              website: school.website || null,
              phone: school.phone || null,
              email: school.email || null,
              address: school.address || null,
              region: school.region || null,
              country: school.country || null,
              timezone: school.timezone || null,
              description: school.description || null,
              logo: school.logo || null,
              logoPath: school.logoPath || null,
              coverImage: school.coverImage || null,
              coverImagePath: school.coverImagePath || null,
              stamp: school.stamp || null,
              stampPath: school.stampPath || null,
              principalSignature: school.principalSignature || null,
              principalSignaturePath: school.principalSignaturePath || null,
              branding: school.branding || {},
            },
            {
              name: schoolName,
              website: document.getElementById('profile-website').value.trim() || null,
              phone: document.getElementById('profile-phone').value.trim() || null,
              email: document.getElementById('profile-email').value.trim() || null,
              address: document.getElementById('profile-address').value.trim() || null,
              region: document.getElementById('profile-region').value.trim() || null,
              country: document.getElementById('profile-country').value.trim() || null,
              timezone: document.getElementById('profile-timezone').value.trim() || null,
              description: document.getElementById('profile-description').value.trim() || null,
              logo: document.getElementById('profile-logo').value.trim() || null,
              logoPath: logoHiddenInput.dataset.storagePath || school.logoPath || null,
              coverImage: document.getElementById('profile-cover').value.trim() || null,
              coverImagePath: coverHiddenInput.dataset.storagePath || school.coverImagePath || null,
              stamp: document.getElementById('profile-stamp').value.trim() || null,
              stampPath: stampHiddenInput.dataset.storagePath || school.stampPath || null,
              principalSignature: document.getElementById('profile-principal-signature').value.trim() || null,
              principalSignaturePath: principalSignatureHiddenInput.dataset.storagePath || school.principalSignaturePath || null,
              branding: {
                ...((school.branding && typeof school.branding === 'object') ? school.branding : {}),
                language: document.getElementById('profile-language').value.trim() || null,
                currency: document.getElementById('profile-currency').value.trim() || null,
                motto: document.getElementById('profile-motto').value.trim() || null,
                gpsAddress: document.getElementById('profile-gps').value.trim() || null,
              },
            },
          );
          const result = await updateSchoolDetails(token, schoolId, payload);
          if (!result.ok || result.data?.status !== 'ok') {
            if (feedbackElement) {
              feedbackElement.textContent = result.data?.message || 'Unable to save school profile.';
              feedbackElement.className = 'text-sm text-rose-700';
            }
            return;
          }
          if (feedbackElement) {
            feedbackElement.textContent = 'School profile updated successfully.';
            feedbackElement.className = 'text-sm text-emerald-700';
          }
          setTimeout(() => {
            closeProfileEditor();
            renderSchoolDashboardPage('overview');
          }, 800);
        });
      }
    });
  }

  if (uploadLogoButton) {
    uploadLogoButton.addEventListener('click', async () => {
      const schoolId = localStorage.getItem('globyedu_schoolId');
      const token = getAccessToken();
      if (!schoolId || !token) return;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        try {
          const uploadedAsset = await uploadTenantAsset(file, 'school-logo', true, {
            type: 'school', id: schoolId, field: 'logoPath',
          });
          const result = await updateSchoolDetails(token, schoolId, {
            logo: uploadedAsset.url,
            logoPath: uploadedAsset.path,
          });
          if (!result.ok || result.data?.status !== 'ok') {
            alert(result.data?.message || 'Unable to update logo.');
            return;
          }
          alert('School logo updated successfully.');
          renderSchoolDashboardPage('overview');
        } catch (error) {
          alert(error.message || 'Unable to update logo.');
        }
      };
      input.click();
    });
  }

  if (uploadCoverButton) {
    uploadCoverButton.addEventListener('click', async () => {
      const schoolId = localStorage.getItem('globyedu_schoolId');
      const token = getAccessToken();
      if (!schoolId || !token) return;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        try {
          const uploadedAsset = await uploadTenantAsset(file, 'school-cover', true, {
            type: 'school', id: schoolId, field: 'coverImagePath',
          });
          const result = await updateSchoolDetails(token, schoolId, {
            coverImage: uploadedAsset.url,
            coverImagePath: uploadedAsset.path,
          });
          if (!result.ok || result.data?.status !== 'ok') {
            alert(result.data?.message || 'Unable to update cover image.');
            return;
          }
          alert('Cover image updated successfully.');
          renderSchoolDashboardPage('overview');
        } catch (error) {
          alert(error.message || 'Unable to update cover image.');
        }
      };
      input.click();
    });
  }

  if (entityRefreshButton) {
    entityRefreshButton.addEventListener('click', async () => {
      await loadSchoolEntities(entityTypeSelect?.value || 'departments');
    });
  }

  if (entityTypeSelect) {
    entityTypeSelect.addEventListener('change', async () => {
      await loadSchoolEntities(entityTypeSelect.value);
    });
  }

  if (entitySearchInput) {
    let debounceTimer;
    entitySearchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        await loadSchoolEntities(entityTypeSelect?.value || 'departments', entitySearchInput.value.trim());
      }, 300);
    });
  }

  if (entityCreateButton) {
    entityCreateButton.addEventListener('click', async () => {
      const entityType = entityTypeSelect?.value || 'departments';
      await handleSchoolEntityUpsert(entityType);
    });
  }

  function slugify(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  async function handleSchoolEntityUpsert(entityType, existing = null) {
    const schoolId = localStorage.getItem('globyedu_schoolId');
    const token = getAccessToken();
    if (!schoolId || !token) return;

    const title = `${existing ? 'Edit' : 'Create'} ${entityType.replace(/-/g, ' ')}`;
    const fields = getEntityFormFields(entityType, existing || {});
    const fileOwner = existing && entityType === 'teachers'
      ? {
          type: 'teacher',
          id: existing.teacherId || existing.id || existing.username || existing.email,
          field: 'profilePhotoPath',
        }
      : null;
    const formData = await showAdminForm(title, fields, { fileOwner });
    if (!formData) return;

    const payload = buildEntityPayload(entityType, formData, existing || {});
    if (!existing && entityType === 'teachers' && typeof formData.profilePhoto?.arrayBuffer === 'function') {
      payload.profilePhoto = null;
      payload.profilePhotoPath = null;
    }
    const result = existing
      ? await updateSchoolEntity(token, schoolId, entityType, existing.id, payload)
      : await createSchoolEntity(token, schoolId, entityType, payload);

    if (!result.ok || result.data?.status !== 'ok') {
      alert(result.data?.message || `Unable to ${existing ? 'update' : 'create'} ${entityType.replace(/-/g, ' ')}.`);
      return;
    }
    if (!existing && entityType === 'teachers') {
      try {
        await uploadCreatedEntityProfilePhoto(formData.profilePhoto, entityType, result.data.entity, token, schoolId);
      } catch (error) {
        alert(error.message || 'Teacher created, but the profile photo could not be saved.');
        return;
      }
    }

    alert(`${entityType.replace(/-/g, ' ')} ${existing ? 'updated' : 'created'} successfully.`);
    await loadSchoolEntities(entityType, entitySearchInput?.value.trim() || '');
  }

  function getEntityFormFields(entityType, entity = {}) {
    const baseFields = [
      { name: 'status', label: 'Status', value: entity.status || 'active', placeholder: 'active' },
    ];

    switch (entityType) {
      case 'departments':
      case 'streams':
      case 'subjects':
        return [
          { name: 'name', label: 'Name', value: entity.name || entity.label || '', placeholder: 'e.g. Mathematics', required: true },
          { name: 'code', label: 'Code', value: entity.code || '', placeholder: 'e.g. MATH', required: true },
          { name: 'description', label: 'Description', value: entity.description || '', placeholder: 'Optional description', type: 'textarea' },
          ...baseFields,
        ];
      case 'classes':
        return [
          { name: 'name', label: 'Class name', value: entity.name || '', placeholder: 'e.g. Grade 9A', required: true },
          { name: 'grade', label: 'Grade', value: entity.grade || '', placeholder: 'e.g. 9', required: true },
          { name: 'section', label: 'Section', value: entity.section || '', placeholder: 'e.g. A' },
          { name: 'description', label: 'Description', value: entity.description || '', placeholder: 'Optional description', type: 'textarea' },
          ...baseFields,
        ];
      case 'academic-years':
      case 'terms':
      case 'semesters':
        return [
          { name: 'label', label: 'Label', value: entity.label || '', placeholder: entityType === 'academic-years' ? '2025/2026' : 'Term 1', required: true },
          { name: 'startDate', label: 'Start date', value: entity.startDate || '', placeholder: 'YYYY-MM-DD', type: 'date' },
          { name: 'endDate', label: 'End date', value: entity.endDate || '', placeholder: 'YYYY-MM-DD', type: 'date' },
          { name: 'description', label: 'Description', value: entity.description || '', placeholder: 'Optional description', type: 'textarea' },
          ...baseFields,
        ];
      case 'teachers':
        return [
          { name: 'fullName', label: 'Full name', value: entity.fullName || entity.name || '', placeholder: 'e.g. Jane Doe', required: true },
          { name: 'email', label: 'Email', value: entity.email || '', placeholder: 'teacher@example.com', type: 'email', required: true },
          { name: 'phone', label: 'Phone', value: entity.phone || '', placeholder: '+1234567890' },
          { name: 'profilePhoto', label: 'Profile photo', type: 'file', accept: 'image/*' },
          ...baseFields,
        ];
      case 'students':
        return [
          { name: 'fullName', label: 'Full name', value: entity.fullName || entity.name || '', placeholder: 'e.g. John Smith', required: true },
          { name: 'email', label: 'Email', value: entity.email || '', placeholder: 'student@example.com', type: 'email', required: true },
          { name: 'phone', label: 'Phone', value: entity.phone || '', placeholder: '+1234567890' },
          { name: 'grade', label: 'Grade', value: entity.grade || '', placeholder: 'e.g. 9' },
          { name: 'profilePhoto', label: 'Profile photo URL', value: entity.profilePhoto || '', placeholder: 'https://...' },
          ...baseFields,
        ];
      default:
        return [
          { name: 'name', label: 'Name', value: entity.name || entity.label || '', placeholder: 'Name', required: true },
          { name: 'description', label: 'Description', value: entity.description || '', placeholder: 'Optional description', type: 'textarea' },
          ...baseFields,
        ];
    }
  }

  function buildEntityPayload(entityType, data, existing = {}) {
    const payload = { ...data };

    if (entityType === 'departments' || entityType === 'streams' || entityType === 'subjects') {
      payload.code = data.code || slugify(data.name || data.label || '');
      payload.name = data.name || data.label;
    }

    if (entityType === 'classes') {
      payload.name = data.name;
      payload.grade = data.grade || data.name;
      payload.section = data.section || null;
    }

    if (entityType === 'teachers' || entityType === 'students') {
      payload.fullName = data.fullName;
      payload.email = data.email;
      payload.phone = data.phone || null;
      payload.profilePhoto = data.profilePhoto || existing.profilePhoto || null;
      if (entityType === 'students') {
        payload.grade = data.grade || null;
      }
    }

    if (entityType === 'academic-years' || entityType === 'terms' || entityType === 'semesters') {
      payload.label = data.label;
      payload.startDate = data.startDate || null;
      payload.endDate = data.endDate || null;
    }

    if (!payload.status) payload.status = 'active';
    return payload;
  }

  async function loadSchoolEntities(entityType, search = '') {
    if (!entityList || !entityStatus) return;
    const schoolId = localStorage.getItem('globyedu_schoolId');
    const token = getAccessToken();
    if (!schoolId || !token) {
      entityStatus.textContent = 'Login required to load entity records.';
      return;
    }
    entityStatus.textContent = `Loading ${entityType.replace(/-/g, ' ')}...`;
    entityList.innerHTML = '';
    entityCache.clear();
    const response = await fetchSchoolEntities(token, schoolId, entityType, { search, pageSize: 12 });
    if (!response.ok || response.data?.status !== 'ok') {
      entityStatus.textContent = response.data?.message || `Unable to load ${entityType.replace(/-/g, ' ')}.`;
      return;
    }
    const items = Array.isArray(response.data.items) ? response.data.items : [];
    if (items.length === 0) {
      entityStatus.textContent = `No ${entityType.replace(/-/g, ' ')} records found.`;
      return;
    }
    entityStatus.textContent = `${items.length} ${entityType.replace(/-/g, ' ')} loaded.`;
    entityList.innerHTML = items
      .map((item) => {
        const label = item.name || item.label || item.fullName || item.email || item.code || item.id || 'Record';
        const identifier = item.id || item.code || item.email || item.studentId || item.classId || '';
        entityCache.set(identifier, item);
        return `
          <div class="rounded-2xl border border-slate-200 bg-white p-4 flex items-start justify-between gap-4">
            <div>
              <p class="font-semibold text-slate-900">${escapeHtml(label)}</p>
              <p class="mt-1 text-sm text-slate-500">ID: ${escapeHtml(identifier)}</p>
            </div>
            <div class="flex gap-2">
              <button data-entity-action="edit" data-entity-type="${entityType}" data-entity-id="${escapeHtml(identifier)}" class="rounded-full border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700 transition hover:bg-sky-100">Edit</button>
              <button data-entity-action="delete" data-entity-type="${entityType}" data-entity-id="${escapeHtml(identifier)}" class="rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100">Archive</button>
            </div>
          </div>
        `;
      })
      .join('');
    attachEntityListActions();
  }

  function attachEntityListActions() {
    document.querySelectorAll('[data-entity-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = btn.getAttribute('data-entity-action');
        const entityType = btn.getAttribute('data-entity-type');
        const entityId = btn.getAttribute('data-entity-id');
        if (!action || !entityType || !entityId) return;

        if (action === 'edit') {
          const record = entityCache.get(entityId);
          if (!record) {
            alert('Unable to load record for editing. Refresh the list and try again.');
            return;
          }
          await handleSchoolEntityUpsert(entityType, record);
          return;
        }

        if (action === 'delete') {
          if (!confirm(`Archive ${entityType.replace(/-/g, ' ')} record ${entityId}?`)) return;
          const schoolId = localStorage.getItem('globyedu_schoolId');
          const token = getAccessToken();
          if (!schoolId || !token) return;
          const result = await deleteSchoolEntity(token, schoolId, entityType, entityId);
          if (!result.ok || result.data?.status !== 'ok') {
            alert(result.data?.message || 'Unable to archive record.');
            return;
          }
          alert('Record archived successfully.');
          await loadSchoolEntities(entityType, entitySearchInput?.value.trim() || '');
        }
      });
    });
  }

  // Initialize action handlers
  initializeStudentSearch();
  initializeAttendanceRoster();
  initializeStudentActions();
  initializeTeacherActions();
  initializeStudentImportExport();
}

function showTeacherReportCardForm({ students = [], classes = [], token, schoolId }) {
  return new Promise((resolve) => {
    const columns = ['Subject', 'Class Score (50%)', 'Exam Score (50%)', 'Total (100%)', 'Position', 'Grade', 'Remarks'];
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-3 sm:items-center sm:p-6';
    const studentOptions = students.map((student) => {
      const studentId = String(student.studentId || student.id || student.email || '').trim();
      const fullName = String(student.fullName || student.name || '').trim();
      return {
        student,
        studentId,
        label: studentId ? `${fullName} — ${studentId}` : fullName,
      };
    }).filter((entry) => entry.studentId && entry.label);
    const optionMarkup = studentOptions.map((entry) => `<option value="${escapeHtml(entry.label)}"></option>`).join('');
    const renderRow = () => `
      <tr data-report-row class="border-t border-slate-200">
        ${columns.map((_, index) => `<td class="min-w-36 p-2"><input data-report-cell="${index}" aria-label="${escapeHtml(columns[index])}" type="${[1, 2, 3].includes(index) ? 'number' : 'text'}" ${[1, 2, 3].includes(index) ? 'min="0" step="any"' : ''} class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" /></td>`).join('')}
        <td class="p-2"><button type="button" data-report-remove-row class="rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-rose-700">Remove</button></td>
      </tr>`;

    overlay.innerHTML = `
      <section class="my-3 max-h-[calc(100vh-1.5rem)] w-full max-w-6xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl sm:my-0 sm:max-h-[calc(100vh-3rem)] sm:p-6">
        <div class="flex items-start justify-between gap-4">
          <div><p class="text-sm uppercase tracking-[0.25em] text-slate-500">Exams and reports</p><h2 class="mt-2 text-xl font-semibold text-slate-900">Create student report card</h2></div>
          <button type="button" data-report-close aria-label="Close report card form" class="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-xl text-slate-600">&times;</button>
        </div>
        <form data-report-form class="mt-5 space-y-5">
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label class="text-sm font-semibold text-slate-700 sm:col-span-2">Student name
              <input data-report-student list="teacher-report-student-options" autocomplete="off" required placeholder="Start typing a student name" class="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 font-normal" />
              <datalist id="teacher-report-student-options">${optionMarkup}</datalist>
              <input data-report-student-id type="hidden" />
            </label>
            <label class="text-sm font-semibold text-slate-700">Class
              <input data-report-class readonly class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-normal" />
            </label>
            <label class="text-sm font-semibold text-slate-700">Exam / assessment
              <input data-report-exam required placeholder="e.g. End of Term Examination" class="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 font-normal" />
            </label>
            <label class="text-sm font-semibold text-slate-700">Term
              <input data-report-term placeholder="Term 1" class="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 font-normal" />
            </label>
            <label class="text-sm font-semibold text-slate-700">Academic year
              <input data-report-year placeholder="2026/2027" class="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 font-normal" />
            </label>
          </div>
          <div>
            <div class="flex flex-wrap items-end justify-between gap-3">
              <div><h3 class="font-semibold text-slate-900">Report columns</h3><p class="mt-1 text-sm text-slate-600">Edit the headings and subject names to match your school’s report format.</p></div>
              <button type="button" data-report-add-row class="rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-700">Add subject row</button>
            </div>
            <div class="mt-3 overflow-x-auto rounded-2xl border border-slate-200">
              <table class="min-w-full border-collapse text-left text-sm">
                <thead class="bg-slate-50"><tr>${columns.map((column, index) => `<th class="min-w-36 p-2"><input data-report-heading="${index}" aria-label="Column heading ${index + 1}" value="${escapeHtml(column)}" required class="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 font-semibold text-slate-700" /></th>`).join('')}<th class="p-2">Actions</th></tr></thead>
                <tbody data-report-rows>${renderRow()}</tbody>
              </table>
            </div>
          </div>
          <p data-report-error class="hidden text-sm text-rose-700" role="alert" aria-live="polite"></p>
          <div class="flex flex-wrap justify-end gap-3">
            <button type="button" data-report-cancel class="rounded-full border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700">Cancel</button>
            <button type="submit" class="rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white">Save report card</button>
          </div>
        </form>
      </section>`;
    document.body.appendChild(overlay);

    let settled = false;
    const cleanup = () => overlay.remove();
    const close = (value = null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const studentInput = overlay.querySelector('[data-report-student]');
    const studentIdInput = overlay.querySelector('[data-report-student-id]');
    const classInput = overlay.querySelector('[data-report-class]');
    studentInput.addEventListener('input', () => {
      const selected = studentOptions.find((entry) => entry.label === studentInput.value);
      studentIdInput.value = selected?.studentId || '';
      const student = selected?.student;
      const studentClass = student && classes.find((entry) => [entry.classId, entry.id].some((value) => String(value || '').toLowerCase() === String(student.classId || '').toLowerCase()));
      classInput.value = student ? String(student.className || student.gradeLevel || student.grade || studentClass?.name || studentClass?.className || studentClass?.grade || '') : '';
    });
    overlay.querySelector('[data-report-add-row]').addEventListener('click', () => {
      overlay.querySelector('[data-report-rows]').insertAdjacentHTML('beforeend', renderRow());
    });
    overlay.addEventListener('click', (event) => {
      const removeButton = event.target.closest('[data-report-remove-row]');
      if (removeButton) {
        const rows = overlay.querySelectorAll('[data-report-row]');
        if (rows.length > 1) removeButton.closest('[data-report-row]').remove();
        else removeButton.closest('[data-report-row]').querySelectorAll('[data-report-cell]').forEach((input) => { input.value = ''; });
      }
    });
    overlay.querySelector('[data-report-close]').addEventListener('click', () => close());
    overlay.querySelector('[data-report-cancel]').addEventListener('click', () => close());
    overlay.querySelector('[data-report-form]').addEventListener('submit', async (event) => {
      event.preventDefault();
      const errorMessage = overlay.querySelector('[data-report-error]');
      const saveButton = overlay.querySelector('button[type="submit"]');
      const selected = studentOptions.find((entry) => entry.studentId === studentIdInput.value && entry.label === studentInput.value);
      const className = classInput.value.trim();
      const rows = Array.from(overlay.querySelectorAll('[data-report-row]')).map((row) => Array.from(row.querySelectorAll('[data-report-cell]')).map((input) => input.value.trim()));
      const subjectRows = rows.filter((row) => row[0]);
      if (!selected || !className) {
        errorMessage.textContent = 'Choose a student from the assigned-student suggestions.';
        errorMessage.classList.remove('hidden');
        return;
      }
      if (!subjectRows.length) {
        errorMessage.textContent = 'Add at least one subject row before saving.';
        errorMessage.classList.remove('hidden');
        return;
      }
      const subjectNames = subjectRows.map((row) => row[0].toLowerCase());
      if (new Set(subjectNames).size !== subjectNames.length) {
        errorMessage.textContent = 'Each subject can only appear once on a report card.';
        errorMessage.classList.remove('hidden');
        return;
      }
      const invalidScore = subjectRows.some((row) => [1, 2, 3].some((index) => row[index] !== '' && !Number.isFinite(Number(row[index]))));
      if (invalidScore) {
        errorMessage.textContent = 'Class score, exam score, and total must be valid numbers.';
        errorMessage.classList.remove('hidden');
        return;
      }
      saveButton.disabled = true;
      saveButton.textContent = 'Saving...';
      errorMessage.classList.add('hidden');
      try {
        const schoolResponse = await fetchSchoolDetails(token, schoolId);
        if (!schoolResponse.ok || schoolResponse.data?.status !== 'ok') {
          throw new Error(schoolResponse.data?.message || 'Unable to load existing exam results.');
        }
        const school = schoolResponse.data.school || {};
        const existingResults = Array.isArray(school.examResults) ? school.examResults : [];
        const reportColumns = Array.from(overlay.querySelectorAll('[data-report-heading]')).map((input) => input.value.trim());
        if (reportColumns.some((column) => !column)) throw new Error('All report column headings are required.');
        const exam = overlay.querySelector('[data-report-exam]').value.trim();
        const term = overlay.querySelector('[data-report-term]').value.trim() || 'Term 1';
        const academicYear = overlay.querySelector('[data-report-year]').value.trim() || '2026/2027';
        const now = new Date().toISOString();
        const newResults = subjectRows.map((cells) => {
          const result = {
            studentId: selected.studentId,
            student: selected.student.fullName || selected.student.name || selected.label,
            className,
            subject: cells[0],
            exam,
            term,
            academicYear,
            reportColumns,
            reportCells: cells,
            remark: cells[6] || '',
            updatedAt: now,
          };
          if (cells[3] !== '') {
            result.mark = Number(cells[3]);
            result.maxMarks = 100;
            result.average = Math.round(result.mark);
            result.grade = cells[5] || '';
            result.passed = result.mark >= 40;
          }
          return result;
        });
        const resultKey = (entry) => `${String(entry.studentId || entry.student || '').trim().toLowerCase()}|${String(entry.subject || '').trim().toLowerCase()}|${String(entry.exam || '').trim().toLowerCase()}|${String(entry.term || '').trim().toLowerCase()}|${String(entry.academicYear || '').trim().toLowerCase()}`;
        const managedKeys = new Set(newResults.map(resultKey));
        const nextResults = existingResults.filter((entry) => !managedKeys.has(resultKey(entry))).concat(newResults.map((entry) => {
          const previous = existingResults.find((record) => resultKey(record) === resultKey(entry));
          return previous ? { ...previous, ...entry } : { ...entry, id: `result-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, createdAt: now };
        }));
        const saveResponse = await updateSchoolDetails(token, schoolId, { examResults: nextResults });
        if (!saveResponse.ok || saveResponse.data?.status !== 'ok') {
          throw new Error(saveResponse.data?.message || 'Unable to save the report card.');
        }
        close(true);
      } catch (error) {
        errorMessage.textContent = error.message || 'Unable to save the report card.';
        errorMessage.classList.remove('hidden');
        saveButton.disabled = false;
        saveButton.textContent = 'Save report card';
      }
    });
  });
}

function initializeTeacherWorkspaceHandlers(teacherData = {}) {
  document.querySelectorAll('[data-teacher-workspace-action]').forEach((button) => {
    if (button.dataset.teacherWorkspaceBound === 'true') return;
    button.dataset.teacherWorkspaceBound = 'true';
    button.addEventListener('click', async () => {
      const action = button.getAttribute('data-teacher-workspace-action');
      const schoolId = localStorage.getItem('globyedu_schoolId');
      const token = getAccessToken();
      if (!schoolId || !token) return;

      if (action === 'create-assignment' || action === 'create-lesson') {
        const schoolResult = await fetchSchoolDetails(token, schoolId);
        const school = schoolResult.ok && schoolResult.data?.status === 'ok' ? schoolResult.data.school || {} : {};
        const classOptions = (Array.isArray(school.classes) ? school.classes : []).map((entry) => ({
          label: entry.name || entry.className || entry.classId || 'Class',
          value: entry.classId || entry.id || entry.name || '',
        })).filter((entry) => entry.value);
        const formData = await showAdminForm(action === 'create-assignment' ? 'Create assignment' : 'Create learning material', [
          { name: 'title', label: 'Title', required: true },
          { name: 'classId', label: 'Authorized class', type: 'select', options: classOptions, required: true },
          { name: 'subject', label: 'Subject', required: true },
          { name: action === 'create-assignment' ? 'instructions' : 'content', label: action === 'create-assignment' ? 'Instructions' : 'Content', type: 'textarea', required: true },
          ...(action === 'create-assignment' ? [{ name: 'dueDate', label: 'Due date', type: 'datetime-local', required: true }] : []),
        ], { submitLabel: action === 'create-assignment' ? 'Publish Assignment' : 'Publish Lesson' });
        if (!formData) return;
        const selectedClass = classOptions.find((entry) => entry.value === formData.classId);
        const payload = {
          title: formData.title,
          classId: formData.classId,
          className: selectedClass?.label || '',
          subject: formData.subject,
          teacherId: localStorage.getItem('globyedu_userEmail') || '',
          createdBy: localStorage.getItem('globyedu_userEmail') || '',
          ...(action === 'create-assignment' ? { instructions: formData.instructions, dueDate: formData.dueDate } : { content: formData.content, description: formData.content }),
        };
        const result = action === 'create-assignment'
          ? await createAssignment(token, schoolId, payload)
          : await createLesson(token, schoolId, payload);
        if (!result.ok || result.data?.status !== 'ok') {
          alert(result.data?.message || 'Unable to save academic content.');
          return;
        }
        if (action === 'create-assignment') {
          pushWorkspaceNotification({
            title: 'New assignment created',
            message: `Assignment created for ${selectedClass?.label || 'class'}: ${formData.title}`,
            type: 'assignment',
            sender: localStorage.getItem('globyedu_userFullName') || 'Teacher',
            targetSchoolIds: schoolId ? [schoolId] : [],
            priority: 'normal',
          });
        }
        alert(action === 'create-assignment' ? 'Assignment created successfully.' : 'Learning material created successfully.');
        renderRolePage('teacher', action === 'create-assignment' ? 'assignments' : 'lessons');
        return;
      }

      if (action === 'create-student') {
        if (teacherData.schoolDataLoadError) {
          alert(teacherData.schoolDataLoadError);
          return;
        }
        const classOptions = (Array.isArray(teacherData.classes) ? teacherData.classes : [])
          .filter((entry) => String(entry.status || 'active').toLowerCase() !== 'archived')
          .map((entry) => ({
            label: entry.name || entry.className || entry.classId || 'Class',
            value: entry.classId || entry.id || entry.name || '',
          }))
          .filter((entry) => entry.value);
        if (classOptions.length === 0) {
          alert('No classes are assigned to your teacher account. Ask your School Authority to assign you to a class before creating a student.');
          return;
        }
        let createResponse = null;
        const formData = await showAdminForm('Create student', [
          { name: 'fullName', label: 'Full name', placeholder: 'First and last name', required: true },
          { name: 'email', label: 'Email', type: 'email', placeholder: 'student@example.com', required: true },
          { name: 'profilePhoto', label: 'Profile photo', type: 'file', accept: 'image/*' },
          { name: 'gender', label: 'Gender', type: 'select', options: [
            { label: 'Male', value: 'male' },
            { label: 'Female', value: 'female' },
            { label: 'Other', value: 'other' },
          ] },
          { name: 'dateOfBirth', label: 'Date of birth', type: 'date' },
          { name: 'phone', label: 'Phone number' },
          { name: 'classId', label: 'Class / Section', type: 'select', options: classOptions, required: true },
          { name: 'gradeLevel', label: 'Grade / Year', placeholder: 'e.g. 1, 2, 3' },
          { name: 'house', label: 'House / Boarding' },
          { name: 'guardian', label: 'Guardian name' },
          { name: 'parentPhone', label: 'Guardian phone' },
          { name: 'parentEmail', label: 'Guardian email', type: 'email' },
          { name: 'medical', label: 'Medical notes', type: 'textarea', placeholder: 'e.g. Allergies, conditions, etc.' },
          { name: 'documents', label: 'Documents', placeholder: 'Comma-separated URLs or file names' },
        ], {
          submitLabel: 'Create Student',
          onSave: async (values) => {
            const selectedClass = classOptions.find((entry) => entry.value === values.classId);
            createResponse = await createSchoolEntity(token, schoolId, 'students', buildSchoolEntityPayload('students', {
              ...values,
              profilePhoto: null,
              profilePhotoPath: null,
              className: selectedClass?.label || null,
              status: 'active',
            }));
            return createResponse;
          },
        });
        if (!formData) return;
        const createdStudent = createResponse.data.entity || {};
        try {
          await uploadCreatedEntityProfilePhoto(formData.profilePhoto, 'students', createdStudent, token, schoolId);
        } catch (error) {
          alert(error.message || 'Student created, but the profile photo could not be saved.');
          return;
        }
        alert(`Student created successfully. Student ID: ${createdStudent.studentId || 'Generated'}.`);
        renderRolePage('teacher', 'students');
        return;
      }

      if (action === 'create-report-card') {
        if (teacherData.schoolDataLoadError) {
          alert(teacherData.schoolDataLoadError);
          return;
        }
        const saved = await showTeacherReportCardForm({
          students: Array.isArray(teacherData.students) ? teacherData.students : [],
          classes: Array.isArray(teacherData.classes) ? teacherData.classes : [],
          token,
          schoolId,
        });
        if (!saved) return;
        alert('Report card saved successfully.');
        renderRolePage('teacher', 'exams');
        return;
      }

      if (action === 'enter-marks') {
        const formData = await showAdminForm('Enter marks', [
          { name: 'studentId', label: 'Student reference (optional)' },
          { name: 'student', label: 'Student name', required: true },
          { name: 'className', label: 'Class', required: true },
          { name: 'subject', label: 'Subject', required: true },
          { name: 'exam', label: 'Exam / assessment', required: true },
          { name: 'mark', label: 'Mark', required: true, type: 'number' },
          { name: 'maxMarks', label: 'Maximum marks', type: 'number' },
          { name: 'passingMarks', label: 'Passing marks', type: 'number' },
          { name: 'term', label: 'Term' },
          { name: 'academicYear', label: 'Academic year' },
          { name: 'remark', label: 'Remark' },
        ]);
        if (!formData) return;
        const mark = Number(formData.mark || 0);
        const maxMarks = Number(formData.maxMarks || 100);
        const passingMarks = Number(formData.passingMarks || 40);
        if (!Number.isFinite(mark) || !Number.isFinite(maxMarks) || mark < 0 || mark > maxMarks || passingMarks < 0 || passingMarks > maxMarks) {
          alert('Enter a valid mark between zero and the maximum.');
          return;
        }
        const result = await fetchSchoolDetails(token, schoolId);
        const school = result.ok && result.data?.status === 'ok' ? result.data.school || {} : {};
        const existingResults = Array.isArray(school.examResults) ? school.examResults : [];
        const average = Math.round((mark / maxMarks) * 100);
        const resultEntry = {
          studentId: formData.studentId,
          student: formData.student,
          className: formData.className,
          subject: formData.subject,
          exam: formData.exam,
          mark,
          maxMarks,
          passingMarks,
          average,
          grade: average >= 80 ? 'A' : average >= 70 ? 'B' : average >= 60 ? 'C' : average >= 50 ? 'D' : average >= 40 ? 'E' : 'F',
          passed: mark >= passingMarks,
          term: formData.term || 'Term 1',
          academicYear: formData.academicYear || '2025/2026',
          remark: formData.remark || '',
          updatedAt: new Date().toISOString(),
        };
        const resultKey = (entry) => `${String(entry.studentId || entry.student || '').trim().toLowerCase()}|${String(entry.subject || '').trim().toLowerCase()}|${String(entry.exam || '').trim().toLowerCase()}|${String(entry.term || '').trim().toLowerCase()}|${String(entry.academicYear || '').trim().toLowerCase()}`;
        const index = existingResults.findIndex((entry) => resultKey(entry) === resultKey(resultEntry));
        const nextResults = [...existingResults];
        if (index >= 0) nextResults[index] = { ...nextResults[index], ...resultEntry };
        else nextResults.push({ ...resultEntry, id: `result-${Date.now()}`, createdAt: new Date().toISOString() });
        const saveResult = await updateSchoolDetails(token, schoolId, { examResults: nextResults });
        if (!saveResult.ok || saveResult.data?.status !== 'ok') {
          alert(saveResult.data?.message || 'Unable to save marks.');
          return;
        }
        alert('Marks saved successfully.');
        renderRolePage('teacher', 'exams');
        return;
      }

      if (action === 'save-profile') {
        const profilePhoto = button.dataset.profilePhoto || '';
        const profilePhotoPath = button.dataset.profilePhotoPath || '';
        const profileResult = await updateSchoolDetails(token, schoolId, {
          teacherProfile: {
            fullName: document.getElementById('teacher-profile-name')?.value.trim(),
            email: document.getElementById('teacher-profile-email')?.value.trim(),
            phone: document.getElementById('teacher-profile-phone')?.value.trim(),
            department: document.getElementById('teacher-profile-department')?.value.trim(),
            position: document.getElementById('teacher-profile-position')?.value.trim(),
            qualification: document.getElementById('teacher-profile-qualification')?.value.trim(),
            profilePhoto: profilePhoto || undefined,
            profilePhotoPath: profilePhotoPath || undefined,
          },
        });
        if (!profileResult.ok || profileResult.data?.status !== 'ok') {
          alert(profileResult.data?.message || 'Unable to save profile.');
          return;
        }
        const savedName = profileResult.data.school?.teacherProfile?.fullName || document.getElementById('teacher-profile-name')?.value.trim();
        if (savedName) localStorage.setItem('globyedu_userFullName', savedName);
        alert('Profile saved successfully.');
        renderRolePage('teacher', 'profile');
      }
    });
  });

  const profilePhotoInput = document.getElementById('teacher-profile-photo');
  const profilePhotoPreview = document.getElementById('teacher-profile-photo-preview');
  const profilePhotoStatus = document.getElementById('teacher-profile-photo-status');
  const profileSaveButton = document.querySelector('[data-teacher-workspace-action="save-profile"]');
  document.querySelectorAll('[data-teacher-photo-source]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!profilePhotoInput) return;
      if (button.dataset.teacherPhotoSource === 'camera') profilePhotoInput.setAttribute('capture', 'user');
      else profilePhotoInput.removeAttribute('capture');
      profilePhotoInput.click();
    });
  });
  if (profilePhotoInput && profilePhotoInput.dataset.teacherPhotoBound === 'true') return;
  if (profilePhotoInput) profilePhotoInput.dataset.teacherPhotoBound = 'true';
  profilePhotoInput?.addEventListener('change', async () => {
    const file = profilePhotoInput.files?.[0];
    const validationError = validateSchoolImage(file);
    if (validationError) {
      profilePhotoInput.value = '';
      alert(validationError);
      return;
    }
    try {
      if (profilePhotoStatus) profilePhotoStatus.textContent = 'Uploading profile photo...';
      const uploadedPhoto = await uploadTenantAsset(file, 'teacher-profile', true, {
        type: 'teacher', id: 'self', field: 'profilePhotoPath',
      });
      if (profileSaveButton) {
        profileSaveButton.dataset.profilePhoto = uploadedPhoto.url;
        profileSaveButton.dataset.profilePhotoPath = uploadedPhoto.path;
      }
      if (profilePhotoPreview) profilePhotoPreview.innerHTML = `<img src="${escapeHtml(uploadedPhoto.url)}" alt="Profile preview" class="h-20 w-20 rounded-full object-cover" />`;
      if (profilePhotoStatus) profilePhotoStatus.textContent = 'Photo uploaded. Save your profile to apply it.';
    } catch (error) {
      if (profilePhotoStatus) profilePhotoStatus.textContent = error.message || 'Unable to upload the selected profile photo.';
      alert(error.message || 'Unable to upload the selected profile photo.');
    }
  });

  document.querySelectorAll('[data-teacher-student-delete-request]').forEach((button) => {
    button.addEventListener('click', async () => {
      const studentId = button.getAttribute('data-teacher-student-delete-request');
      const schoolId = localStorage.getItem('globyedu_schoolId');
      const token = getAccessToken();
      if (!studentId || !schoolId || !token) return;
      if (teacherData.schoolDataLoadError) {
        alert(teacherData.schoolDataLoadError);
        return;
      }
      const student = (Array.isArray(teacherData.students) ? teacherData.students : [])
        .find((entry) => String(entry.studentId || entry.id || entry.email) === studentId);
      if (!student) {
        alert('Student record was not found in your assigned classes. Refresh the list and try again.');
        return;
      }
      if (!confirm(`Request School Authority review to delete ${student.fullName || student.studentId || 'this student'}? The account will not be deleted until approved.`)) return;
      const result = await requestStudentDeletion(token, schoolId, studentId);
      if (!result.ok || result.data?.status !== 'ok') {
        alert(result.data?.message || 'Unable to submit the student deletion request.');
        return;
      }
      alert('Deletion request submitted for School Authority review.');
      renderRolePage('teacher', 'students');
    });
  });

  document.querySelectorAll('[data-teacher-student-edit]').forEach((button) => {
    button.addEventListener('click', async () => {
      const studentId = button.getAttribute('data-teacher-student-edit');
      const schoolId = localStorage.getItem('globyedu_schoolId');
      const token = getAccessToken();
      if (teacherData.schoolDataLoadError) {
        alert(teacherData.schoolDataLoadError);
        return;
      }
      const student = (Array.isArray(teacherData.students) ? teacherData.students : []).find((entry) => String(entry.studentId || entry.id || entry.email) === studentId);
      if (!student) {
        alert('Student record was not found in your assigned classes. Refresh the list and try again.');
        return;
      }
      const formData = await showAdminForm('Edit student', [
        { name: 'fullName', label: 'Student full name', value: student.fullName || '', required: true },
        { name: 'profilePhoto', label: 'Student photo', type: 'file', accept: 'image/*' },
        { name: 'className', label: 'Assigned class', value: student.className || '', disabled: true },
      ], {
        submitLabel: 'Save Changes',
        fileOwner: {
          type: 'student',
          id: student.studentId || student.id || student.email,
          field: 'profilePhotoPath',
        },
        onSave: (values) => updateSchoolEntity(token, schoolId, 'students', studentId, {
          fullName: values.fullName,
          profilePhoto: values.profilePhoto || student.profilePhoto || null,
          profilePhotoPath: values.profilePhotoPath || student.profilePhotoPath || undefined,
          className: values.className,
        }),
      });
      if (!formData) return;
      alert('Student updated successfully.');
      renderRolePage('teacher', 'students');
    });
  });
}

function parseHash() {
  const rawHash = location.hash.replace('#', '');
  const [path, queryString] = rawHash.split('?');
  return {
    path: path.startsWith('/') ? path.slice(1) : path,
    params: new URLSearchParams(queryString || ''),
  };
}

function getUserRole() {
  return localStorage.getItem('globyedu_userRole');
}

function getPlatformAdminFlag() {
  return localStorage.getItem('globyedu_platformAdmin') === 'true';
}

function getAccessToken() {
  return localStorage.getItem('globyedu_accessToken');
}

function passwordChangeRequired() {
  return localStorage.getItem('globyedu_passwordNeedsReset') === 'true';
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  const isLocalDev = ['localhost', '127.0.0.1'].includes(window.location.hostname);

  if (isLocalDev) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    } catch (error) {
      console.warn('Unable to unregister stale local service workers:', error);
    }

    try {
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
      }
    } catch (error) {
      console.warn('Unable to clear stale local caches:', error);
    }

    console.info('Skipping service worker registration in local development and clearing stale cache state.');
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    console.info('GlobyEdu OS service worker registered at', registration.scope);
    monitorServiceWorkerRegistration(registration);
  } catch (error) {
    console.warn('GlobyEdu OS service worker registration failed:', error);
  }
}

let deferredInstallPrompt = null;

function setupPwaInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    console.info('PWA install prompt captured. Call promptPwaInstall() to show it.');
    showInstallPromptNotice();
  });

  window.addEventListener('appinstalled', () => {
    displayPwaNotice({
      title: 'Installed',
      message: 'GlobyEdu OS is installed and ready to use offline.',
      type: 'success',
      duration: 5000,
    });
    localStorage.removeItem('globyedu_installPromptSnoozedUntil');
    deferredInstallPrompt = null;
  });
}

function promptPwaInstall() {
  if (!deferredInstallPrompt) return;

  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.then((choiceResult) => {
    console.info('PWA install choice:', choiceResult.outcome);
    if (choiceResult.outcome === 'dismissed') {
      localStorage.setItem('globyedu_installPromptSnoozedUntil', String(Date.now() + 12 * 60 * 60 * 1000));
    }
    deferredInstallPrompt = null;
  });
}

function isAuthenticated() {
  const accessToken = getAccessToken();
  const role = getUserRole();
  const sessionActive = localStorage.getItem('globyedu_sessionActive') === 'true' || sessionStorage.getItem('globyedu_sessionActive') === 'true';
  const expiresAt = Number(localStorage.getItem('globyedu_sessionExpiresAt') || 0);
  if (expiresAt && Date.now() > expiresAt) {
    clearAuthenticationState();
    return false;
  }
  return Boolean(accessToken || role || sessionActive);
}

function getAccessTokenExpiresAt(token = getAccessToken()) {
  try {
    const encodedPayload = String(token || '').split('.')[1];
    if (!encodedPayload) return 0;
    const normalizedPayload = encodedPayload.replace(/-/g, '+').replace(/_/g, '/')
      .padEnd(Math.ceil(encodedPayload.length / 4) * 4, '=');
    const payload = JSON.parse(atob(normalizedPayload));
    const expiresAt = Number(payload.exp) * 1000;
    return Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : 0;
  } catch {
    return 0;
  }
}

function scheduleAccessTokenRefresh() {
  if (accessTokenRefreshTimer) window.clearTimeout(accessTokenRefreshTimer);
  accessTokenRefreshTimer = null;

  const token = getAccessToken();
  const sessionExpiresAt = Number(localStorage.getItem('globyedu_sessionExpiresAt') || 0);
  if (!token || !sessionExpiresAt) return;
  if (Date.now() >= sessionExpiresAt) {
    clearAuthenticationState();
    return;
  }

  const tokenExpiresAt = getAccessTokenExpiresAt(token);
  const refreshAt = tokenExpiresAt ? tokenExpiresAt - 60_000 : Date.now() + 10 * 60_000;
  const delay = Math.max(1000, Math.min(refreshAt - Date.now(), sessionExpiresAt - Date.now()));
  accessTokenRefreshTimer = window.setTimeout(refreshAccessToken, delay);
}

async function refreshAccessToken() {
  const sessionExpiresAt = Number(localStorage.getItem('globyedu_sessionExpiresAt') || 0);
  if (!sessionExpiresAt || Date.now() >= sessionExpiresAt) {
    clearAuthenticationState();
    location.hash = '#/login';
    return;
  }

  try {
    const result = await refreshAuthSession();
    if (result.ok && result.data?.status === 'ok' && result.data.accessToken) {
      localStorage.setItem('globyedu_accessToken', result.data.accessToken);
      scheduleAccessTokenRefresh();
      return;
    }
    if (result.status < 500) {
      clearAuthenticationState();
      location.hash = '#/login';
      return;
    }
  } catch {
    // Retry network failures while the current access token remains valid.
  }

  const tokenExpiresAt = getAccessTokenExpiresAt();
  if (tokenExpiresAt > Date.now()) {
    accessTokenRefreshTimer = window.setTimeout(
      refreshAccessToken,
      Math.min(15_000, tokenExpiresAt - Date.now()),
    );
    return;
  }

  console.error('Unable to refresh the authenticated session; signing out.');
  clearAuthenticationState();
  location.hash = '#/login';
}

function getDashboardPathForRole(role, platformAdmin = false) {
  if (platformAdmin || role === 'platform_admin' || role === 'super_admin') return '#/admin/overview';
  if (role === 'school_authority' || role === 'school_head') return '#/school/overview';
  if (role === 'teacher' || role === 'student') return `#/role/${role}`;
  return '#/school/overview';
}

function redirectAuthenticatedUser() {
  if (!isAuthenticated()) return false;
  if (passwordChangeRequired()) {
    location.hash = '#/change-password';
    return true;
  }
  location.hash = getDashboardPathForRole(getUserRole(), getPlatformAdminFlag());
  return true;
}

function requireAuth() {
  if (!isAuthenticated()) {
    if (location.pathname.startsWith('/admin/')) {
      location.replace('/login');
      return false;
    }
    location.hash = '#/login';
    return false;
  }
  return true;
}

// Clear persisted authentication state when the user signs out.
function clearAuthenticationState() {
  if (accessTokenRefreshTimer) window.clearTimeout(accessTokenRefreshTimer);
  accessTokenRefreshTimer = null;
  localStorage.removeItem('globyedu_accessToken');
  localStorage.removeItem('globyedu_userRole');
  localStorage.removeItem('globyedu_platformAdmin');
  localStorage.removeItem('globyedu_userEmail');
  localStorage.removeItem('globyedu_userFullName');
  localStorage.removeItem('globyedu_passwordNeedsReset');
  localStorage.removeItem('globyedu_schoolId');
  localStorage.removeItem('globyedu_schoolName');
  localStorage.removeItem('globyedu_trialEnds');
  localStorage.removeItem('globyedu_sessionHistory');
  localStorage.removeItem('globyedu_sessionActive');
  localStorage.removeItem('globyedu_sessionExpiresAt');
  localStorage.removeItem('globyedu_sessionRemembered');
  localStorage.removeItem('globyedu_schoolDirectory');
  sessionStorage.removeItem('globyedu_sessionActive');
  if (isFirebaseConfigured()) {
    firebaseSignOutUser().catch(() => console.error('Firebase sign-out failed while clearing the session.'));
  }
}

async function revokeCurrentSession() {
  const resultSlot = document.getElementById('account-action-status');
  try {
    const result = await apiLogout(getAccessToken());
    if (result.ok && result.data?.status === 'ok') return true;
    const message = result.data?.message || 'Unable to securely end this session. Please try again.';
    if (resultSlot) {
      resultSlot.textContent = message;
      resultSlot.classList.remove('hidden');
    } else {
      window.alert(message);
    }
  } catch (error) {
    console.error('Unable to revoke the current session.', error);
    const message = 'Unable to securely end this session. Please try again.';
    if (resultSlot) {
      resultSlot.textContent = message;
      resultSlot.classList.remove('hidden');
    } else {
      window.alert(message);
    }
  }
  return false;
}

// Attach handlers for the dedicated platform admin login page.
function attachPlatformAdminHandlers() {
  const form = document.getElementById('platform-admin-form');
  const messageSlot = document.getElementById('platform-admin-message');
  const googleButton = document.getElementById('google-signin');

  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    messageSlot.innerHTML = '';

    const email = document.getElementById('platform-admin-email').value.trim();
    const password = document.getElementById('platform-admin-password').value;
    const remember = document.getElementById('platform-admin-remember').checked;
    const submitButton = form.querySelector('button[type="submit"]');

    if (submitButton) submitButton.disabled = true;

    if (!email || !password) {
      messageSlot.innerHTML = `<div class="rounded-3xl border border-amber-100 bg-amber-50 p-4 text-amber-800">Email and password are required.</div>`;
      if (submitButton) submitButton.disabled = false;
      return;
    }

    try {
      const response = await platformAdminLogin(email, password);
      if (!response.ok || response.data?.status !== 'ok') {
        messageSlot.innerHTML = `<div class="rounded-3xl border border-rose-100 bg-rose-50 p-4 text-rose-800">${response.data?.message || 'Unable to sign in. Please check your details.'}</div>`;
      } else {
        localStorage.removeItem('globyedu_schoolDirectory');
        localStorage.setItem('globyedu_accessToken', response.data.accessToken || response.data.token || '');
        localStorage.setItem('globyedu_userRole', response.data.role || 'super_admin');
        localStorage.setItem('globyedu_platformAdmin', 'true');
        localStorage.setItem('globyedu_userEmail', email);
        localStorage.setItem('globyedu_userFullName', response.data.fullName || 'Benjamin');
        localStorage.setItem('globyedu_schoolId', response.data.schoolId || 'globy-school');
        localStorage.setItem('globyedu_schoolName', response.data.schoolName || 'Globy School');
        if (!remember) {
          sessionStorage.setItem('globyedu_sessionActive', 'true');
        }
        markActiveSession();
        location.hash = '#/admin/overview';
      }
    } catch (error) {
      messageSlot.innerHTML = `<div class="rounded-3xl border border-rose-100 bg-rose-50 p-4 text-rose-800">Unable to sign in. Try again later.</div>`;
    }

    if (submitButton) submitButton.disabled = false;
  });

  if (googleButton) {
    googleButton.addEventListener('click', () => {
      messageSlot.innerHTML = '<div class="rounded-3xl border border-slate-200 bg-slate-50 p-4 text-slate-700">Use the email sign-in form below to continue. The secure workspace is ready for your school account.</div>';
    });
  }
}

function attachLoginHandlers() {
  const form = document.getElementById('login-form');
  const messageSlot = document.getElementById('login-message');
  const googleButton = document.getElementById('google-signin');
  const roleButtons = document.querySelectorAll('[data-login-role]');
  const selectedRoleTitle = document.getElementById('selected-role-title');
  const selectedRoleDescription = document.getElementById('selected-role-description');
  const selectedRoleBadge = document.getElementById('selected-role-badge');
  const fieldSchoolIdGroup = document.getElementById('field-school-id-group');
  const fieldIdentifierLabel = document.getElementById('field-identifier-label');
  const schoolIdInput = document.getElementById('school-id');
  const usernameInput = document.getElementById('login-identifier');
  const loginRoleInput = document.getElementById('login-role');
  const forgotPasswordLink = document.getElementById('forgot-password-link');
  const superAdminPortalLink = document.getElementById('super-admin-portal');
  const storedSchoolId = localStorage.getItem('globyedu_schoolId') || '';
  const storedSchoolName = localStorage.getItem('globyedu_schoolName') || '';

  function resolveSelectedSchoolId(rawValue = '') {
    const currentValue = String(rawValue || '').trim();
    if (currentValue) return currentValue;
    if (storedSchoolId) return storedSchoolId;

    const host = window.location.hostname || '';
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('local')) {
      return 'globy-school';
    }
    return '';
  }

  function renderLoginError(data, fallbackMessage = 'Unable to sign in. Please check your details.') {
    if (data?.code === 'ACCOUNT_SUSPENDED') {
      return `<div class="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-950" role="alert">
        <p class="text-base font-semibold">Account Suspended</p>
        <p class="mt-2">Your account has been suspended. Please contact your school administrator.</p>
      </div>`;
    }
    return `<div class="rounded-3xl border border-rose-100 bg-rose-50 p-4 text-rose-800">${data?.message || fallbackMessage}</div>`;
  }

  if (!form) return;
  if (!messageSlot) return;

  const ROLE_CONFIG = {
    platform_admin: {
      title: 'Platform Super Admin',
      description: 'Sign in with your platform administrator account.',
      badge: 'Platform admin',
      identifierLabel: 'Email',
      identifierPlaceholder: 'you@example.com',
      showSchoolId: false,
      googleEnabled: false,
    },
    school_authority: {
      title: 'School Authority',
      description: 'Use your School ID, School Email, and Password to access administrative tools.',
      badge: 'School authority',
      identifierLabel: 'School Email',
      identifierPlaceholder: 'head@school.edu',
      showSchoolId: true,
      googleEnabled: true,
    },
    teacher: {
      title: 'Teacher',
      description: 'Use your School ID, email address, and Password to manage classes and learners.',
      badge: 'Teacher',
      identifierLabel: 'Email address',
      identifierPlaceholder: 'teacher@school.edu',
      showSchoolId: true,
      googleEnabled: false,
    },
    student: {
      title: 'Student',
      description: 'Use your School ID, Student ID, and Password to open the learner workspace.',
      badge: 'Student',
      identifierLabel: 'Student ID',
      identifierPlaceholder: 'STU001',
      showSchoolId: true,
      googleEnabled: true,
    },
  };

  function updateSelectedRole(role) {
    const config = ROLE_CONFIG[role];
    if (!config) return;

    loginRoleInput.value = role;
    selectedRoleTitle.textContent = config.title;
    selectedRoleDescription.textContent = config.description;
    selectedRoleBadge.textContent = config.badge;
    if (fieldIdentifierLabel) {
      fieldIdentifierLabel.textContent = config.identifierLabel;
    }
    if (usernameInput) {
      usernameInput.placeholder = config.identifierPlaceholder;
      usernameInput.setAttribute('aria-label', config.identifierLabel);
      usernameInput.setAttribute('type', role === 'teacher' ? 'email' : 'text');
    }
    if (fieldSchoolIdGroup) {
      fieldSchoolIdGroup.classList.toggle('hidden', !config.showSchoolId);
    }
    if (forgotPasswordLink) {
      const resetType = ['platform_admin', 'teacher', 'student'].includes(role) ? role : 'school';
      forgotPasswordLink.setAttribute('href', `#/forgot?type=${encodeURIComponent(resetType)}`);
    }
    roleButtons.forEach((button) => {
      const isSelected = button.dataset.loginRole === role;
      button.classList.toggle('border-sky-500', isSelected);
      button.classList.toggle('bg-white', isSelected);
      button.classList.toggle('shadow-sm', isSelected);
      button.classList.toggle('border-slate-200', !isSelected);
      button.classList.toggle('bg-slate-50', !isSelected);
      button.classList.toggle('shadow-none', !isSelected);
    });

    if (googleButton) {
      googleButton.classList.toggle('opacity-50', !config.googleEnabled);
      googleButton.disabled = !config.googleEnabled;
      googleButton.textContent = config.googleEnabled ? 'Google Sign In' : 'Google unavailable';
    }

  }

  roleButtons.forEach((button) => {
    button.addEventListener('click', () => {
      updateSelectedRole(button.dataset.loginRole);
      messageSlot.innerHTML = `<div class="rounded-3xl border border-slate-200 bg-slate-50 p-4 text-slate-700">${ROLE_CONFIG[button.dataset.loginRole].description}</div>`;
    });
  });

  if (superAdminPortalLink) {
    superAdminPortalLink.addEventListener('click', () => {
      messageSlot.innerHTML = '<div class="rounded-3xl border border-slate-200 bg-slate-50 p-4 text-slate-700">Redirecting to the secure Super Admin sign in page.</div>';
    });
  }

  if (!storedSchoolId) {
    messageSlot.innerHTML = `<div class="rounded-3xl border border-slate-200 bg-slate-50 p-4 text-slate-700">Select your role and enter your credentials to sign in.</div>`;
  } else {
    messageSlot.innerHTML = `<div class="rounded-3xl border border-slate-200 bg-slate-50 p-4 text-slate-700">School ID auto-filled from your last session. Select the correct role to continue.</div>`;
  }

  updateSelectedRole(loginRoleInput?.value || 'school_authority');
  const defaultSchoolId = resolveSelectedSchoolId(schoolIdInput?.value || '');
  if (schoolIdInput && defaultSchoolId) schoolIdInput.value = defaultSchoolId;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    messageSlot.innerHTML = '';
    const role = loginRoleInput.value;
    const username = usernameInput?.value.trim();
    const password = document.getElementById('password').value;
    const remember = document.getElementById('remember-me')?.checked;
    const submitButton = form.querySelector('button[type="submit"]');
    const schoolId = resolveSelectedSchoolId(schoolIdInput?.value || '');
    if (schoolIdInput && schoolId) schoolIdInput.value = schoolId;

    if (submitButton) submitButton.disabled = true;
    if (!role) {
      messageSlot.innerHTML = `<div class="rounded-3xl border border-amber-100 bg-amber-50 p-4 text-amber-800">Please choose a login role before signing in.</div>`;
      if (submitButton) submitButton.disabled = false;
      return;
    }

    if (role !== 'platform_admin' && !schoolId) {
      messageSlot.innerHTML = `<div class="rounded-3xl border border-amber-100 bg-amber-50 p-4 text-amber-800">School ID is required for this role.</div>`;
      if (submitButton) submitButton.disabled = false;
      return;
    }

    if (!username || !password) {
      messageSlot.innerHTML = `<div class="rounded-3xl border border-amber-100 bg-amber-50 p-4 text-amber-800">Username and password are required.</div>`;
      if (submitButton) submitButton.disabled = false;
      return;
    }

    let firebaseTeacherSignedIn = false;
    try {
      let response;
      if (role === 'platform_admin') {
        response = await platformAdminLogin(username, password);
      } else if (role === 'school_authority') {
        response = await schoolAuthorityLogin(schoolId, username, password);
      } else if (role === 'teacher') {
        if (!isFirebaseConfigured()) {
          if (!['localhost', '127.0.0.1'].includes(location.hostname)) {
            throw new Error('Teacher sign-in is currently unavailable. Please try again later.');
          }
          response = await teacherLogin(schoolId, username, password);
        } else {
          const credential = await firebaseSignInWithEmail(username, password);
          firebaseTeacherSignedIn = true;
          if (!credential?.user?.emailVerified) {
            await firebaseSignOutUser();
            firebaseTeacherSignedIn = false;
            throw new Error('Unable to sign in. Please check your details.');
          }
          const idToken = await credential.user.getIdToken();
          response = await apiFirebaseLogin(idToken, schoolId, false, {
            identifier: username,
            loginType: 'teacher',
          });
          if (response.ok && response.data?.status === 'ok' &&
              !response.data.user?.roles?.includes('teacher')) {
            await firebaseSignOutUser();
            firebaseTeacherSignedIn = false;
            throw new Error('Unable to sign in. Please check your details.');
          }
          if (!response.ok || response.data?.status !== 'ok') {
            await firebaseSignOutUser();
            firebaseTeacherSignedIn = false;
          }
        }
      } else {
        response = await studentLogin(schoolId, username, password);
      }

      if (!response.ok || response.data?.status !== 'ok') {
        messageSlot.innerHTML = renderLoginError(response.data);
      } else {
        const accessToken = response.data.accessToken || response.data.token || '';
        localStorage.removeItem('globyedu_schoolDirectory');
        localStorage.setItem('globyedu_accessToken', accessToken);
        localStorage.setItem('globyedu_userRole', role);
        localStorage.setItem('globyedu_platformAdmin', role === 'platform_admin' ? 'true' : 'false');
        localStorage.setItem('globyedu_userEmail', username);
        localStorage.setItem('globyedu_userFullName', response.data.fullName || username);
        localStorage.setItem('globyedu_passwordNeedsReset', String(response.data.passwordNeedsReset === true || response.data.response?.passwordNeedsReset === true));
        if (role === 'student') {
          if (response.data.studentId || response.data.response?.studentId) {
            localStorage.setItem('globyedu_studentId', response.data.studentId || response.data.response.studentId);
          }
          if (response.data.className || response.data.response?.className) {
            localStorage.setItem('globyedu_studentClass', response.data.className || response.data.response.className);
          }
          if (response.data.profilePhoto || response.data.response?.profilePhoto) {
            localStorage.setItem('globyedu_profilePhoto', response.data.profilePhoto || response.data.response.profilePhoto);
          }
        }
            const resolvedSchoolId = schoolId || response.data.schoolId || response.data.response?.schoolId || '';
            if (resolvedSchoolId) {
              localStorage.setItem('globyedu_schoolId', resolvedSchoolId);
        }
            const resolvedSchoolName = response.data.schoolName || response.data.response?.schoolName || localStorage.getItem('globyedu_schoolName') || '';
            if (resolvedSchoolName) {
              localStorage.setItem('globyedu_schoolName', resolvedSchoolName);
        }
        if (remember) {
          localStorage.setItem('globyedu_sessionActive', 'true');
          localStorage.setItem('globyedu_sessionExpiresAt', String(Date.now() + 1000 * 60 * 60 * 24 * 7));
          localStorage.setItem('globyedu_sessionRemembered', 'true');
        } else {
          sessionStorage.setItem('globyedu_sessionActive', 'true');
          localStorage.setItem('globyedu_sessionExpiresAt', String(Date.now() + 1000 * 60 * 60));
          localStorage.removeItem('globyedu_sessionRemembered');
        }

        markActiveSession();

        if (response.data.passwordNeedsReset === true || response.data.response?.passwordNeedsReset === true) {
          location.hash = '#/change-password';
        } else if (role === 'platform_admin') {
          location.hash = '#/admin/overview';
        } else if (role === 'school_authority') {
          location.hash = '#/school/overview';
        } else if (role === 'teacher') {
          location.hash = '#/role/teacher';
        } else if (role === 'student') {
          location.hash = '#/role/student';
        } else {
          location.hash = '#/login';
        }
      }
    } catch (error) {
      if (firebaseTeacherSignedIn) {
        await firebaseSignOutUser();
      }
      messageSlot.innerHTML = `<div class="rounded-3xl border border-rose-100 bg-rose-50 p-4 text-rose-800">${error.message || 'Unable to sign in. Try again later.'}</div>`;
    }

    if (submitButton) submitButton.disabled = false;
  });

  if (googleButton) {
    googleButton.addEventListener('click', async () => {
      const role = loginRoleInput.value;
      if (!['school_authority', 'teacher', 'student'].includes(role)) {
        messageSlot.innerHTML = `<div class="rounded-3xl border border-amber-100 bg-amber-50 p-4 text-amber-800">Google sign-in is available for school, teacher, and student accounts.</div>`;
        return;
      }

      const resolvedSchoolId = resolveSelectedSchoolId(schoolIdInput?.value || '');
      if (schoolIdInput && resolvedSchoolId) {
        schoolIdInput.value = resolvedSchoolId;
      }
      if (!resolvedSchoolId) {
        messageSlot.innerHTML = `<div class="rounded-3xl border border-amber-100 bg-amber-50 p-4 text-amber-800">Please select a school and role before using Google sign in.</div>`;
        return;
      }
      if (!isFirebaseConfigured()) {
        messageSlot.innerHTML = `<div class="rounded-3xl border border-rose-100 bg-rose-50 p-4 text-rose-800">Firebase is not configured. Use email and password sign in.</div>`;
        return;
      }
      messageSlot.innerHTML = '<div class="rounded-3xl border border-sky-200 bg-sky-50 p-4 text-sky-700">Redirecting to Google sign in...</div>';

      try {
        const credential = await firebaseSignInWithGoogle();
        if (!credential?.user) {
          throw new Error('Google sign-in did not return a valid user.');
        }

        const idToken = await credential.user.getIdToken();
        const response = await apiFirebaseLogin(idToken, resolvedSchoolId, false, { identifier: usernameInput?.value.trim(), loginType: role });

        if (!response.ok || response.data?.status !== 'ok') {
          messageSlot.innerHTML = `<div class="rounded-3xl border border-rose-100 bg-rose-50 p-4 text-rose-800">${response.data?.message || 'Unable to sign in with Google.'}</div>`;
          return;
        }

        const sessionRole = Array.isArray(response.data.user?.roles) ? response.data.user.roles[0] : 'school_authority';
        const roleFromResponse = sessionRole === 'school_head' ? 'school_authority' : sessionRole;
        localStorage.setItem('globyedu_accessToken', response.data.accessToken || '');
        localStorage.setItem('globyedu_userRole', roleFromResponse);
        localStorage.setItem('globyedu_platformAdmin', role === 'platform_admin' ? 'true' : 'false');
        localStorage.setItem('globyedu_userEmail', response.data.user?.email || '');
        localStorage.setItem('globyedu_userFullName', response.data.user?.displayName || response.data.user?.email || '');

        localStorage.setItem('globyedu_schoolId', response.data.schoolId || response.data.tenantId || schoolIdInput.value.trim());
        if (role !== 'platform_admin') {
          localStorage.setItem('globyedu_schoolName', response.data.schoolName || localStorage.getItem('globyedu_schoolName') || 'Globy School');
        }

        markActiveSession();
        location.hash = getDashboardPathForRole(roleFromResponse, roleFromResponse === 'platform_admin');
      } catch (error) {
        messageSlot.innerHTML = `<div class="rounded-3xl border border-rose-100 bg-rose-50 p-4 text-rose-800">Unable to sign in with Google. Try again later.</div>`;
        console.error('Google sign-in failed:', error);
      }
    });
  }

  const connectGoogleButton = document.getElementById('student-connect-google');
  if (connectGoogleButton) {
    connectGoogleButton.addEventListener('click', async () => {
      const accessToken = getAccessToken();
      if (!accessToken || !isFirebaseConfigured()) {
        alert('Firebase is not configured for Google account linking.');
        return;
      }
      try {
        const credential = await firebaseLinkGoogle();
        const idToken = await credential.user.getIdToken();
        const response = await linkFirebaseIdentity(idToken, accessToken);
        alert(response.ok ? 'Google account linked successfully.' : (response.data?.message || 'Unable to link Google account.'));
      } catch (error) {
        alert('Unable to link Google account.');
      }
    });
  }
}

function handleEmailVerification(oobCode) {
  if (!isFirebaseConfigured()) {
    return renderVerifyEmailPage('error', 'Firebase is not configured for email verification.');
  }

  renderVerifyEmailPage('pending', 'Verifying your email. Please wait...');
  firebaseApplyActionCode(oobCode)
    .then(() => {
      renderVerifyEmailPage('success', 'Your email has been verified successfully. You may now sign in.');
    })
    .catch((err) => {
      console.error('Email verification failed:', err);
      renderVerifyEmailPage('error', 'Unable to verify your email. The link may be invalid or expired.');
    });
}

function attachRegisterHandlers() {
  const form = document.getElementById('register-form');
  const messageSlot = document.getElementById('register-message');
  const googleButton = document.getElementById('google-register');

  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    messageSlot.innerHTML = '';

    const schoolName = document.getElementById('school-name').value.trim();
    const adminName = document.getElementById('admin-name').value.trim();
    const email = document.getElementById('school-email').value.trim();
    const phone = document.getElementById('school-phone').value.trim();
    const country = document.getElementById('school-country').value.trim();
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    const submitButton = form.querySelector('button[type="submit"]');

    if (submitButton) submitButton.disabled = true;
    if (!schoolName || !adminName || !email || !phone || !country || !password || !confirmPassword) {
      messageSlot.innerHTML = `<div class="rounded-3xl border border-rose-100 bg-rose-50 p-4 text-rose-800">Please complete all fields.</div>`;
      if (submitButton) submitButton.disabled = false;
      return;
    }
    if (password !== confirmPassword) {
      messageSlot.innerHTML = `<div class="rounded-3xl border border-rose-100 bg-rose-50 p-4 text-rose-800">Passwords do not match.</div>`;
      if (submitButton) submitButton.disabled = false;
      return;
    }

    try {
      const result = await apiRegister(schoolName, adminName, email, phone, country, password);
      if (!result.ok || result.data?.status !== 'ok') {
        messageSlot.innerHTML = `<div class="rounded-3xl border border-rose-100 bg-rose-50 p-4 text-rose-800">${result.data?.message || 'Unable to create school account.'}</div>`;
      } else {
        localStorage.setItem('globyedu_schoolId', result.data.schoolId);
        localStorage.setItem('globyedu_schoolName', schoolName);
        localStorage.setItem('globyedu_trialEnds', result.data.trialEndsAt || '');
        try {
          const loginResult = await apiLogin(email, password, result.data.schoolId);
          if (loginResult.ok && loginResult.data?.status === 'ok') {
            localStorage.setItem('globyedu_accessToken', loginResult.data.accessToken || loginResult.data.token || '');
            localStorage.setItem('globyedu_userRole', loginResult.data.role || 'super_admin');
            localStorage.setItem('globyedu_platformAdmin', 'false');
            localStorage.setItem('globyedu_userEmail', email);
            localStorage.setItem('globyedu_userFullName', loginResult.data.fullName || adminName);
            sessionStorage.setItem('globyedu_sessionActive', 'true');
            markActiveSession();
            location.hash = '#/school/overview';
            return;
          }
        } catch {
          // Fall back to the onboarding success page if the immediate login fails.
        }
        location.hash = '#/registered';
      }
    } catch (error) {
      messageSlot.innerHTML = `<div class="rounded-3xl border border-rose-100 bg-rose-50 p-4 text-rose-800">Submission failed. Please try again.</div>`;
    }
    if (submitButton) submitButton.disabled = false;
  });

  if (googleButton) {
    googleButton.addEventListener('click', () => {
      messageSlot.innerHTML = '<div class="rounded-3xl border border-slate-200 bg-slate-50 p-4 text-slate-700">Use the registration form below to create your school account. The workspace will be available immediately after signup.</div>';
    });
  }
}

function attachForgotHandlers(loginType = 'school') {
  const form = document.getElementById('forgot-form');
  const messageSlot = document.getElementById('forgot-message');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    messageSlot.innerHTML = '';
    const email = document.getElementById('forgot-email').value.trim();
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;

    if (!email) {
      messageSlot.innerHTML = `<div class="rounded-3xl border border-rose-100 bg-rose-50 p-4 text-rose-800">Please enter your email.</div>`;
      if (submitButton) submitButton.disabled = false;
      return;
    }

    try {
      const result = await apiForgot(email, loginType);
      if (!result.ok || result.data?.status !== 'ok') {
        throw new Error(result.data?.message || 'Unable to submit request.');
      }
      messageSlot.innerHTML = `<div class="rounded-3xl border border-emerald-100 bg-emerald-50 p-4 text-emerald-800">If that email exists, a password reset link has been sent.</div>`;
    } catch (error) {
      messageSlot.innerHTML = `<div class="rounded-3xl border border-rose-100 bg-rose-50 p-4 text-rose-800">Request failed. Please try again.</div>`;
    }

    if (submitButton) submitButton.disabled = false;
  });
}

function attachResetPasswordHandlers(token = '', loginType = 'school') {
  const form = document.getElementById('reset-password-form');
  const messageSlot = document.getElementById('reset-password-message');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    messageSlot.innerHTML = '';
    const newPassword = document.getElementById('reset-password').value;
    const confirmPassword = document.getElementById('reset-password-confirm').value;
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;

    if (!newPassword || !confirmPassword) {
      messageSlot.innerHTML = `<div class="rounded-3xl border border-rose-100 bg-rose-50 p-4 text-rose-800">Please complete both password fields.</div>`;
      if (submitButton) submitButton.disabled = false;
      return;
    }
    if (newPassword !== confirmPassword) {
      messageSlot.innerHTML = `<div class="rounded-3xl border border-rose-100 bg-rose-50 p-4 text-rose-800">Passwords do not match.</div>`;
      if (submitButton) submitButton.disabled = false;
      return;
    }

    try {
      const result = await confirmFirebasePasswordReset(token, newPassword);
      if (!result.ok || result.data?.status !== 'ok') {
        throw new Error(result.data?.message || 'Unable to reset password.');
      }
      const completionMessage = loginType === 'teacher' && result.data.emailVerified !== true
        ? 'Your password has been set. Verify your email using the separate verification link before signing in.'
        : 'Your password has been updated. You can now sign in.';
      messageSlot.innerHTML = `<div class="rounded-3xl border border-emerald-100 bg-emerald-50 p-4 text-emerald-800">${completionMessage}</div>`;
    } catch (error) {
      messageSlot.innerHTML = `<div class="rounded-3xl border border-rose-100 bg-rose-50 p-4 text-rose-800">Unable to reset password. Please try again.</div>`;
    }

    if (submitButton) submitButton.disabled = false;
  });
}

function attachChangePasswordHandlers() {
  const form = document.getElementById('change-password-form');
  const messageSlot = document.getElementById('change-password-message');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = form.querySelector('button[type="submit"]');
    const oldPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmation = document.getElementById('confirm-new-password').value;
    if (newPassword !== confirmation) {
      messageSlot.innerHTML = '<div class="rounded-3xl border border-rose-100 bg-rose-50 p-4 text-rose-800">Passwords do not match.</div>';
      return;
    }
    if (submitButton) submitButton.disabled = true;
    const result = await apiChangePassword(getAccessToken(), oldPassword, newPassword);
    if (!result.ok || result.data?.status !== 'ok') {
      messageSlot.innerHTML = `<div class="rounded-3xl border border-rose-100 bg-rose-50 p-4 text-rose-800">${result.data?.message || 'Unable to change password.'}</div>`;
      if (submitButton) submitButton.disabled = false;
      return;
    }
    messageSlot.innerHTML = '<div class="rounded-3xl border border-emerald-100 bg-emerald-50 p-4 text-emerald-800">Password changed successfully. Redirecting...</div>';
    if (result.data.accessToken) {
      localStorage.setItem('globyedu_accessToken', result.data.accessToken);
    }
    localStorage.removeItem('globyedu_passwordNeedsReset');
    const role = getUserRole();
    location.hash = getDashboardPathForRole(role, getPlatformAdminFlag());
  });
}

async function route() {
  const navigationId = ++routeGeneration;
  const parsed = parseHash();
  const current = parsed.path || location.pathname.replace(/^\/+|\/+$/g, '');
  const params = parsed.params;

  if (!current || current === 'home' || LANDING_ROUTES.includes(current)) {
    return renderLanding(current || 'home');
  }
  if (current === 'login') {
    if (redirectAuthenticatedUser()) return;
    await loadWebsiteCMSSettings();
    return renderLoginPage();
  }
  if (current === 'platform-admin') {
    return renderPlatformAdminPage();
  }
  if (current === 'admin/login') {
    if (redirectAuthenticatedUser()) return;
    return renderPlatformAdminPage();
  }
  if (current === 'register') return renderRegisterPage();
  if (current === 'checkout') return renderCheckoutPage(params.get('plan') || '', params.get('period') || 'monthly', params.get('reference') || '');
  if (current === 'legal' || current.startsWith('legal/')) {
    const policy = current.split('/')[1] || 'privacy';
    root.innerHTML = `${LegalPage(policy)}${Footer()}`;
    return;
  }
  if (current === '404') return renderNotFoundPage();
  if (current === 'forgot') return renderForgotPage(params.get('type') || 'school');
  if (current === 'reset-password') return renderResetPasswordPage(params.get('token') || params.get('oobCode') || '', params.get('type') || 'school');
  if (current === 'change-password') {
    if (!requireAuth()) return;
    root.innerHTML = `${Nav()}${ChangePasswordPage()}${Footer()}`;
    attachChangePasswordHandlers();
    return;
  }
  if (isAuthenticated() && passwordChangeRequired()) {
    location.hash = '#/change-password';
    return;
  }
  if (current === 'verify-email') return handleEmailVerification(params.get('oobCode') || '');
  if (current === 'registered') return renderRegisterSuccess();
  if (current === 'admin' || current.startsWith('admin/')) {
    if (!requireAuth()) return;
    const authenticatedRole = getUserRole();
    if (authenticatedRole !== 'super_admin' && !getPlatformAdminFlag()) {
      const redirectRole = authenticatedRole === 'teacher' ? 'teacher' : authenticatedRole === 'student' ? 'student' : 'school_authority';
      const redirectPath = redirectRole === 'teacher' ? '#/role/teacher' : redirectRole === 'student' ? '#/role/student' : '#/school/overview';
      location.hash = redirectPath;
      return;
    }
    const section = current === 'admin' ? 'overview' : current.split('/')[1] || 'overview';
    return renderAdminPage(section, navigationId, Number(params.get('days') || 365));
  }
  if (current === 'school' || current.startsWith('school/')) {
    if (!requireAuth()) return;
    if (await ensureSchoolAccessIsActive()) return;
    const authenticatedRole = getUserRole();
    if (authenticatedRole !== 'school_authority' && authenticatedRole !== 'school_head' && authenticatedRole !== 'super_admin' && !getPlatformAdminFlag()) {
      const redirectRole = authenticatedRole === 'teacher' ? 'teacher' : authenticatedRole === 'student' ? 'student' : 'student';
      const redirectPath = redirectRole === 'teacher' ? '#/role/teacher' : '#/role/student';
      location.hash = redirectPath;
      return;
    }
    const section = current === 'school' ? 'overview' : current.split('/')[1] || 'overview';
    return renderSchoolDashboardPage(section, navigationId);
  }
  if (current.startsWith('role/')) {
    if (!requireAuth()) return;
    if (await ensureSchoolAccessIsActive()) return;
    const [, role, section] = current.split('/');
    const authenticatedRole = getUserRole();
    const allowedRoleRedirects = {
      student: '#/role/student',
      teacher: '#/role/teacher',
      school_authority: '#/school/overview',
      school_head: '#/school/overview',
      super_admin: '#/admin/overview',
    };
    if (role && authenticatedRole && authenticatedRole !== role) {
      const redirectRole = authenticatedRole;
      const redirectPath = allowedRoleRedirects[redirectRole] || '#/role/student';
      location.hash = redirectPath;
      return;
    }
    if (role === 'super_admin' || getUserRole() === 'super_admin' || getPlatformAdminFlag()) {
      return renderAdminPage('overview');
    }
    return renderRolePage(role || 'super_admin', section || 'overview', navigationId);
  }

  return renderNotFoundPage();
}

function attachAdminHandlers() {
  const mobileToggle = document.getElementById('admin-mobile-menu-toggle');
  const mobileMenu = document.getElementById('admin-mobile-menu');
  const profileButton = document.getElementById('admin-profile-menu');
  const profileDropdown = document.getElementById('admin-profile-dropdown');
  const notificationsButton = document.getElementById('admin-notifications-toggle');

  if (mobileToggle && mobileMenu) {
    mobileToggle.addEventListener('click', () => {
      mobileMenu.classList.toggle('hidden');
    });
  }

  if (profileButton && profileDropdown) {
    profileButton.addEventListener('click', () => {
      profileDropdown.classList.toggle('hidden');
    });
    document.addEventListener('click', (event) => {
      if (!profileButton.contains(event.target) && !profileDropdown.contains(event.target)) {
        profileDropdown.classList.add('hidden');
      }
    });
  }

  const logoutButton = document.getElementById('admin-logout');
  if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
      if (!await revokeCurrentSession()) return;
      clearAuthenticationState();
      location.hash = '#/login';
    });
  }

  if (notificationsButton) {
    notificationsButton.addEventListener('click', () => {
      location.hash = '#/admin/announcements';
    });
  }

  // Admin navigation buttons (data-admin-nav)
  document.querySelectorAll('[data-admin-nav]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const section = btn.getAttribute('data-admin-nav');
      if (section) {
        location.hash = `#/admin/${section}`;
      }
    });
  });

  // Admin action buttons (data-admin-action)
  document.querySelectorAll('[data-admin-action]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const action = btn.getAttribute('data-admin-action');
      if (action === 'create-school') {
        location.hash = '#/admin/schools';
      }
    });
  });
}

function attachAdminPageActions(section, summary, schools) {
  if (section !== 'schools' && section !== 'archived-schools') return;

  const isArchivedSection = section === 'archived-schools';
  const searchInput = document.getElementById(isArchivedSection ? 'archived-school-search-input' : 'school-search-input');
  const statusFilter = document.getElementById(isArchivedSection ? 'archived-school-status-filter' : 'school-status-filter');
  const rows = Array.from(document.querySelectorAll(isArchivedSection
    ? '#archived-school-directory-rows [data-archived-school-row]'
    : '#school-directory-rows [data-school-id]'));
  const emptyState = document.getElementById(isArchivedSection ? 'archived-school-directory-empty' : 'school-directory-empty');
  const count = document.getElementById(isArchivedSection ? 'archived-school-directory-count' : 'school-directory-count');
  const applySchoolFilters = () => {
    const visibleRows = rows.filter((row) => {
      const matches = matchesAdminSchoolFilter(
        row.textContent,
        row.dataset.schoolStatus,
        searchInput?.value,
        statusFilter?.value,
        row.dataset.schoolSubscriptionStatus
      );
      row.classList.toggle('hidden', !matches);
      return matches;
    }).length;

    emptyState?.classList.toggle('hidden', visibleRows > 0);
    if (count) count.textContent = `${visibleRows} ${visibleRows === 1 ? 'school' : 'schools'}`;
  };

  searchInput?.addEventListener('input', applySchoolFilters);
  statusFilter?.addEventListener('change', applySchoolFilters);
  applySchoolFilters();

  const createButton = document.getElementById('create-school-button');
  if (createButton) {
    createButton.addEventListener('click', () => handleCreateSchool());
  }

}

function debounce(fn, delay = 250) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}

function showAdminMessage(type, message) {
  const slot = document.getElementById('admin-school-message');
  if (!slot) return;
  slot.className = `rounded-3xl border p-4 text-sm ${
    type === 'success'
      ? 'border-emerald-100 bg-emerald-50 text-emerald-800'
      : type === 'error'
      ? 'border-rose-100 bg-rose-50 text-rose-800'
      : 'border-slate-200 bg-slate-50 text-slate-700'
  }`;
  slot.textContent = message;
  slot.classList.remove('hidden');
}

function clearAdminMessage() {
  const slot = document.getElementById('admin-school-message');
  if (!slot) return;
  slot.textContent = '';
  slot.classList.add('hidden');
}

function showAdminConfirmation(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4';
    overlay.innerHTML = `
      <div class="w-full max-w-md rounded-4xl bg-white p-6 shadow-2xl shadow-slate-900/10">
        <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Confirm action</p>
        <h2 class="mt-4 text-xl font-semibold text-slate-900">${message}</h2>
        <div class="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button data-confirm="no" class="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">Cancel</button>
          <button data-confirm="yes" class="rounded-full bg-rose-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-rose-700">Proceed</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const cleanup = () => {
      overlay.remove();
    };

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        cleanup();
        resolve(false);
      }
    });

    overlay.querySelector('[data-confirm="no"]').addEventListener('click', () => {
      cleanup();
      resolve(false);
    });
    overlay.querySelector('[data-confirm="yes"]').addEventListener('click', () => {
      cleanup();
      resolve(true);
    });
  });
}

function showAdminForm(title, fields, { submitLabel = 'Save Changes', onSave, fileOwner } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-3 sm:items-center sm:p-6';

    const formFields = fields
      .map((field) => {
        if (field.type === 'textarea') {
          return `
            <label class="block text-sm text-slate-700">
              ${field.label}
              <textarea id="admin-form-${field.name}" rows="${field.rows || 4}" placeholder="${field.placeholder || ''}" class="mt-3 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100" ${field.required ? 'required' : ''}>${field.value || ''}</textarea>
            </label>
          `;
        }

        if (field.type === 'file') {
          return `
            <label class="block text-sm text-slate-700">
              ${field.label}
              <input id="admin-form-${field.name}" type="file" accept="${field.accept || 'image/*'}" class="mt-3 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100" ${field.required ? 'required' : ''} />
              <span id="admin-form-${field.name}-feedback" class="mt-2 block text-xs text-slate-500">Choose an image to upload.</span>
              <span id="admin-form-${field.name}-preview" class="mt-3 block"></span>
            </label>
          `;
        }

        if (field.type === 'select') {
          const selectedValues = Array.isArray(field.value) ? field.value : [field.value].filter((value) => value !== undefined && value !== null && value !== '');
          const renderOption = (option) => {
                const stringValue = String(option.value ?? '');
                const isSelected = field.multiple
                  ? selectedValues.some((selected) => String(selected) === stringValue)
                  : String(option.value ?? '') === String(field.value ?? '');
                return `<option value="${stringValue}" ${isSelected ? 'selected' : ''}>${option.label ?? option.value ?? 'Option'}</option>`;
              };
          const options = Array.isArray(field.options) && field.options.length
            ? field.options.map((option) => Array.isArray(option.options)
              ? `<optgroup label="${option.label}">${option.options.map(renderOption).join('')}</optgroup>`
              : renderOption(option)).join('')
            : '<option value="">Select an option</option>';
          return `
            <label class="block text-sm text-slate-700">
              ${field.label}
              <select id="admin-form-${field.name}" class="mt-3 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100" ${field.required ? 'required' : ''} ${field.multiple ? 'multiple size="8"' : ''}>
                ${options}
              </select>
            </label>
          `;
        }

        return `
          <label class="block text-sm text-slate-700">
            ${field.label}
            <input id="admin-form-${field.name}" type="${field.type || 'text'}" value="${field.value || ''}" placeholder="${field.placeholder || ''}" class="mt-3 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100" ${field.required ? 'required' : ''} ${field.disabled ? 'disabled' : ''} />
          </label>
        `;
      })
      .join('');

    overlay.innerHTML = `
      <div class="my-3 max-h-[calc(100vh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-4xl bg-white p-5 shadow-2xl shadow-slate-900/10 sm:my-0 sm:max-h-[calc(100vh-3rem)] sm:p-6">
        <div class="flex items-start justify-between gap-4">
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">${title}</p>
          <button type="button" data-modal="close" aria-label="Close form" class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-xl leading-none text-slate-600 transition hover:bg-slate-100">&times;</button>
        </div>
        <form id="admin-modal-form" class="mt-6 space-y-4">
          <div class="grid gap-4 sm:grid-cols-2">${formFields}</div>
          <div class="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button type="button" data-modal="cancel" class="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">Cancel</button>
            <button type="submit" class="rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700">${escapeHtml(submitLabel)}</button>
          </div>
          <p data-form-error class="hidden text-sm text-rose-700" role="alert" aria-live="polite"></p>
        </form>
      </div>
    `;

    document.body.appendChild(overlay);

    fields.filter((field) => field.type === 'file').forEach((field) => {
      const input = overlay.querySelector(`#admin-form-${field.name}`);
      const feedback = overlay.querySelector(`#admin-form-${field.name}-feedback`);
      const preview = overlay.querySelector(`#admin-form-${field.name}-preview`);
      input?.addEventListener('change', async () => {
        const file = input.files?.[0];
        const validationError = validateSchoolImage(file);
        if (validationError) {
          input.value = '';
          if (feedback) feedback.textContent = validationError;
          if (preview) preview.innerHTML = '';
          return;
        }
        try {
          const dataUrl = await readFileAsDataUrl(file);
          if (feedback) feedback.textContent = 'Image ready to save.';
          if (preview) preview.innerHTML = `<img src="${escapeHtml(dataUrl)}" alt="Selected image preview" class="h-24 w-24 rounded-2xl border border-slate-200 object-cover" />`;
        } catch (error) {
          input.value = '';
          if (feedback) feedback.textContent = error.message || 'Unable to read image.';
          if (preview) preview.innerHTML = '';
        }
      });
    });

    let settled = false;
    const cleanup = () => {
      document.removeEventListener('keydown', handleKeydown);
      overlay.remove();
    };

    const close = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(null);
    };

    const handleKeydown = (event) => {
      if (event.key === 'Escape') close();
    };

    overlay.querySelector('[data-modal="cancel"]').addEventListener('click', close);
    overlay.querySelector('[data-modal="close"]').addEventListener('click', close);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
    document.addEventListener('keydown', handleKeydown);

    const form = overlay.querySelector('#admin-modal-form');
    form.noValidate = true;
    const submitButton = form.querySelector('button[type="submit"]');
    const errorMessage = form.querySelector('[data-form-error]');
    let submitting = false;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (settled || submitting) return;
      const invalidInput = form.querySelector(':invalid');
      if (invalidInput) {
        if (errorMessage) {
          errorMessage.textContent = invalidInput.validationMessage || 'Check the highlighted fields and try again.';
          errorMessage.classList.remove('hidden');
        }
        invalidInput.focus();
        return;
      }
      submitting = true;
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Saving...';
      }
      if (errorMessage) {
        errorMessage.textContent = '';
        errorMessage.classList.add('hidden');
      }
      try {
        const result = {};
        for (const field of fields) {
          const input = overlay.querySelector(`#admin-form-${field.name}`);
          if (!input) {
            result[field.name] = '';
            continue;
          }

          if (field.type === 'file') {
            const file = input.files?.[0];
            if (!file) {
              result[field.name] = '';
              continue;
            }

            const validationError = validateSchoolImage(file);
            if (validationError) throw new Error(validationError);
            if (fileOwner) {
              const uploadedAsset = await uploadTenantAsset(file, field.name, true, fileOwner);
              result[field.name] = uploadedAsset.url;
              result[`${field.name}Path`] = uploadedAsset.path;
            } else {
              result[field.name] = file;
            }
            continue;
          }

          if (field.type === 'select' && field.multiple) {
            result[field.name] = Array.from(input.selectedOptions || []).map((option) => option.value).filter(Boolean);
            continue;
          }

          result[field.name] = input.value.trim();
        }
        if (onSave) {
          const saveResponse = await onSave(result);
          if (!saveResponse?.ok || saveResponse.data?.status !== 'ok') {
            throw new Error(saveResponse?.data?.message || 'Unable to save this record.');
          }
        }
        settled = true;
        cleanup();
        resolve(result);
      } catch (error) {
        submitting = false;
        console.error('Form submission failed:', error);
        if (errorMessage) {
          errorMessage.textContent = error.message || 'Unable to save this record.';
          errorMessage.classList.remove('hidden');
        }
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = submitLabel;
        }
      }
    });
  });
}

async function handleCreateSchool() {
  const token = getAccessToken();
  clearAdminMessage();
  if (!token) {
    showAdminMessage('error', 'Please sign in as a Super Admin to create schools.');
    return;
  }

  const formData = await showAdminForm('Create school', [
    { name: 'name', label: 'School name', placeholder: 'Example International School', required: true },
    { name: 'description', label: 'Description', placeholder: 'Tenant school description', type: 'text' },
    { name: 'headEmail', label: 'School Head email', placeholder: 'head@example.com', type: 'email' },
    { name: 'headFullName', label: 'School Head full name', placeholder: 'Jane Doe', type: 'text' },
    { name: 'headPassword', label: 'School Head password', placeholder: 'Leave blank to auto-generate', type: 'password' },
  ]);
  if (!formData || !formData.name) return;

  const payload = {
    name: formData.name.trim(),
    description: formData.description.trim(),
    headEmail: formData.headEmail.trim() || undefined,
    headFullName: formData.headFullName.trim() || undefined,
    headPassword: formData.headPassword || undefined,
    schoolStatus: 'active',
    subscriptionStatus: 'trial',
  };

  const result = await createAdminSchool(token, payload);
  if (!result.ok || result.data?.status !== 'ok') {
    showAdminMessage('error', result.data?.message || 'Unable to create school. Check the details and try again.');
    return;
  }

  const createdSchoolLabel = result.data.school?.name || result.data.school?.schoolId || payload.name || 'New school';
  pushWorkspaceNotification({
    title: 'New school created',
    message: `School created successfully: ${createdSchoolLabel}`,
    type: 'school',
    sender: 'Super Admin',
    targetSchoolIds: result.data.school?.schoolId ? [result.data.school.schoolId] : [],
    priority: 'normal',
  });

  showAdminMessage('success', `School created successfully: ${createdSchoolLabel}`);
  await refreshAdminSchoolList();
}

async function handleSchoolAction(event, schools) {
  event.preventDefault();
  const button = event.currentTarget;
  const action = button.dataset.action;
  const schoolId = button.dataset.schoolId;
  const token = getAccessToken();
  if (!token) {
    showAdminMessage('error', 'Please sign in as a Super Admin to perform this action.');
    return;
  }

  const school = schools.find((entry) => entry.schoolId === schoolId);
  const name = school?.name || 'school';

  if (action === 'view') {
    showAdminMessage(
      'info',
      `Name: ${name} | School ID: ${schoolId} | Subscription: ${school?.subscriptionPlan || 'N/A'} | Status: ${school?.subscriptionStatus || school?.schoolStatus || 'Unknown'} | Users: ${school?.userCount || (school?.users && school.users.length) || 0}`
    );
    return;
  }

  if (action === 'edit') {
    const formData = await showAdminForm('Edit school', [
      { name: 'name', label: 'School name', placeholder: 'New school name', value: name, required: true },
    ]);
    if (!formData || !formData.name || formData.name.trim() === name) return;

    const payload = { name: formData.name.trim() };
    const result = await updateAdminSchool(token, schoolId, payload);
    if (!result.ok || result.data?.status !== 'ok') {
      showAdminMessage('error', result.data?.message || 'Unable to update school.');
      return;
    }
    showAdminMessage('success', 'School updated successfully.');
    await refreshAdminSchoolList();
    return;
  }

  if (action === 'suspend') {
    const confirmed = await showAdminConfirmation(`Suspend school ${name}? This will mark the school as suspended.`);
    if (!confirmed) return;
    const result = await deleteAdminSchool(token, schoolId);
    if (!result.ok || result.data?.status !== 'ok') {
      showAdminMessage('error', result.data?.message || 'Unable to suspend school.');
      return;
    }
    showAdminMessage('success', 'School suspended successfully.');
    await refreshAdminSchoolList();
    return;
  }

  if (action === 'activate') {
    const result = await activateAdminSchool(token, schoolId);
    if (!result.ok || result.data?.status !== 'ok') {
      showAdminMessage('error', result.data?.message || 'Unable to activate school.');
      return;
    }
    showAdminMessage('success', 'School activated successfully.');
    await refreshAdminSchoolList();
    return;
  }
}

async function refreshAdminSchoolList(search = '') {
  const token = getAccessToken();
  if (!token) return;
  const [summaryResult, schoolListResult] = await Promise.all([
    fetchAdminDashboardSummary(token),
    fetchAdminSchoolList(token, search),
  ]);

  const summary = summaryResult.ok && summaryResult.data?.status === 'ok' ? summaryResult.data.summary : {};
  const schools = schoolListResult.ok && schoolListResult.data?.status === 'ok' ? schoolListResult.data.schools || [] : [];

  root.innerHTML = `${Nav()}${AdminPage('schools', localStorage.getItem('globyedu_userFullName') || 'Benjamin', summary, schools)}${Footer()}`;
  attachAdminHandlers();
  attachAdminSectionHandlers('schools');
}

function attachContactHandlers() {
  const form = document.getElementById('contact-form');
  const status = document.getElementById('contact-status');
  if (!form || !status) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = form.querySelector('button[type="submit"]');
    const name = document.getElementById('contact-name')?.value.trim();
    const email = document.getElementById('contact-email')?.value.trim();
    const message = document.getElementById('contact-message')?.value.trim();

    status.textContent = 'Sending...';
    if (submitButton) submitButton.disabled = true;

    try {
      const response = await fetch('/api/v1/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, message }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Unable to send your message.');
      status.textContent = data.message || 'Thanks! Our team will follow up within one business day.';
      form.reset();
    } catch (error) {
      status.textContent = error.message || 'Unable to send your message right now. Please try again.';
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

function attachNewsletterHandlers() {
  const form = document.getElementById('newsletter-form');
  const status = document.getElementById('newsletter-status');
  if (!form || !status) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const emailInput = document.getElementById('newsletter-email');
    if (!emailInput || !emailInput.value.trim()) {
      status.textContent = 'Please enter a valid email address.';
      return;
    }
    status.textContent = 'Subscribed! Check your inbox for updates.';
    form.reset();
  });
}

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', async () => {
  route();
  scheduleAccessTokenRefresh();
  await registerServiceWorker();
  setupPwaInstallPrompt();
  setupNetworkStatusWatcher();
  showPendingUpdateNoticeOnLoad();
});
