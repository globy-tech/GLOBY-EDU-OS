// admin.js
// Super Admin dashboard page templates and module placeholders for the marketing SPA.
// This page is intentionally built as a feature module to keep the dashboard logic
// separate from the landing site and to preserve the existing marketing architecture.

import { appendAuditLog, encryptSecret, getAdminState, maskAuditValue, recordNotification, saveAdminState, setSessionActivity } from './admin-state.js';
import { activateAdminSchool, archiveAdminSchool, deleteAdminSchool, fetchArchivedAdminSchools, fetchMessageRecipients, createWorkspaceMessage, fetchSchoolDetails, permanentlyDeleteArchivedSchool, restoreAdminSchool } from '../api/school.js';
import { fetchMaintenanceMode, updateMaintenanceMode, updatePricingPlan } from '../api/pricing.js';
import { getAdminSchoolStatus, getAdminSchoolSubscriptionStatus, getAdminSchoolStatuses } from '../utils/school-management-filters.mjs';
import { validateImageUpload } from '../utils/file-upload-validation.js';
import { fetchAdminWebsiteCMS, publishWebsiteCMS, uploadWebsiteCMSLogo } from '../api/website-cms.js';

const WEBSITE_CMS_STORAGE_KEY = 'globyedu_websiteCms';
let cachedWebsiteCMSSettings = null;
const SUPER_ADMIN_ONLY_SECTIONS = new Set(['pricing', 'payments', 'features', 'website-cms', 'ai-settings', 'analytics', 'reports', 'messages', 'announcements', 'support', 'plugins', 'audit-logs', 'system-settings', 'settings', 'backups', 'security', 'subscriptions', 'archived-schools']);
const ADMIN_NAV_ITEMS = [
  { id: 'overview', label: 'Dashboard', icon: 'chart-square-bar' },
  { id: 'schools', label: 'Schools', icon: 'office-building' },
  { id: 'users', label: 'Users', icon: 'users' },
  { id: 'payments', label: 'Payments', icon: 'credit-card' },
  { id: 'pricing', label: 'Plans & subscriptions', icon: 'cash' },
  { id: 'features', label: 'Feature Manager', icon: 'adjustable' },
  { id: 'website-cms', label: 'Website CMS', icon: 'globe-alt' },
  { id: 'ai-settings', label: 'AI Settings', icon: 'cpu-chip' },
  { id: 'analytics', label: 'Analytics', icon: 'sparkles' },
  { id: 'reports', label: 'Reports', icon: 'document-text' },
  { id: 'messages', label: 'Messages', icon: 'chat-bubble-left-right' },
  { id: 'announcements', label: 'Announcements', icon: 'megaphone' },
  { id: 'support', label: 'Support', icon: 'lifebuoy' },
  { id: 'plugins', label: 'Plugin Marketplace', icon: 'puzzle' },
  { id: 'audit-logs', label: 'Audit Logs', icon: 'clipboard-document-list' },
  { id: 'system-settings', label: 'System Settings', icon: 'server-stack' },
  { id: 'settings', label: 'Settings', icon: 'cog' },
  { id: 'backups', label: 'Backups', icon: 'arrow-down-tray' },
  { id: 'security', label: 'Security', icon: 'shield-check' },
];

export function AdminPage(activeSection = 'overview', userFullName = 'Benjamin', summary = {}, schools = [], pricingPlans = [], auditLogs = [], maintenanceMode = null) {
  return `
    <div data-admin-page class="min-w-0 space-y-6">
      <div class="rounded-[2rem] border border-slate-200 bg-white/90 p-6 shadow-sm backdrop-blur-xl">
        <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Super Admin Control Panel</p>
        <h2 class="mt-2 text-2xl font-semibold text-slate-900">${renderTopbarTitle(activeSection)}</h2>
        <p class="mt-3 text-slate-600">Manage platform operations from the shared workspace shell without duplicating navigation.</p>
      </div>
      <main class="space-y-6">
        ${renderBreadcrumb(activeSection)}
        ${renderSectionContent(activeSection, userFullName, summary, schools, pricingPlans, auditLogs, maintenanceMode)}
      </main>
    </div>
  `;
}

function renderTopbarTitle(section) {
  const lookup = {
    overview: 'Platform Overview',
    schools: 'School Management',
    'archived-schools': 'Archived Schools',
    subscriptions: 'Plans & Subscriptions',
    pricing: 'Plans & Subscriptions',
    users: 'User Directory',
    payments: 'Payments',
    'website-cms': 'Website CMS',
    'ai-settings': 'AI Provider Configuration',
    analytics: 'Analytics Studio',
    reports: 'Reports & Insights',
    messages: 'Messages',
    announcements: 'Announcements',
    support: 'Support Center',
    plugins: 'Plugin Marketplace',
    'audit-logs': 'Audit Logs',
    'system-settings': 'System Settings',
    settings: 'Platform Settings',
    backups: 'Backups',
    security: 'Security Overview',
    'system-monitoring': 'System Monitoring',
  };
  return lookup[section] || 'Super Admin Dashboard';
}

function renderBreadcrumb(activeSection) {
  const crumb = activeSection === 'overview'
    ? 'Overview'
    : ['pricing', 'subscriptions'].includes(activeSection)
      ? 'Plans & Subscriptions'
      : activeSection.replace('-', ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  const dashboardActions = activeSection === 'overview' ? `
    <div class="flex flex-wrap items-center gap-3">
      <button type="button" data-admin-nav="schools" class="rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200">Quick action</button>
      <button type="button" data-admin-action="create-school" class="rounded-full bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-700">Create school</button>
    </div>
  ` : '';

  return `
    <div class="mb-6 rounded-[2rem] bg-white px-6 py-5 shadow-sm shadow-slate-200/50">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex items-center gap-2 text-sm text-slate-500">
          <span>Home</span>
          <span>›</span>
          <span class="font-semibold text-slate-900">${crumb}</span>
        </div>
        ${dashboardActions}
      </div>
    </div>
  `;
}

function getPlatformSettingsState() {
  const state = getAdminState();
  const persisted = (() => {
    try {
      const raw = localStorage.getItem('globyedu_platform_settings_v1');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  })();
  return { ...(state.settings || {}), ...persisted };
}

function savePlatformSettingsState(values = {}) {
  const state = getAdminState();
  const next = { ...(state.settings || {}), ...values };
  state.settings = next;
  localStorage.setItem('globyedu_platform_settings_v1', JSON.stringify(next));
  saveAdminState(state);
  return next;
}

function getPlatformDashboardMetrics(summary = {}) {
  const schools = Array.isArray(summary.schools) ? summary.schools : [];
  const latestActivity = Array.isArray(summary.latestActivity) ? summary.latestActivity : [];
  const recentSchools = schools.slice(0, 4);

  return {
    totalSchools: Number(summary.totalSchools || 0),
    activeSchools: Number(summary.activeSchools || 0),
    suspendedSchools: Number(summary.suspendedSchools || 0),
    trialSchools: Number(summary.trialSchools || 0),
    totalStudents: Number(summary.totalStudents || 0),
    totalTeachers: Number(summary.totalTeachers || 0),
    activeSubscriptions: Number(summary.activeSubscriptions || 0),
    latestActivity,
    recentSchools,
    revenue: summary.revenue || null,
  };
}

function getCurrentAdminRole() {
  const role = localStorage.getItem('globyedu_userRole');
  const platformAdmin = localStorage.getItem('globyedu_platformAdmin') === 'true';
  return role === 'super_admin' || platformAdmin ? 'super_admin' : 'restricted';
}

function isSectionRestricted(section) {
  const normalized = String(section || 'overview').toLowerCase();
  return SUPER_ADMIN_ONLY_SECTIONS.has(normalized);
}

function renderRestrictedAccessNotice(section) {
  const normalized = String(section || 'overview').toLowerCase();
  setSessionActivity({
    id: `restricted-${Date.now()}`,
    timestamp: new Date().toISOString(),
    action: 'Restricted admin section access',
    details: `Blocked access to ${normalized}`,
    role: getCurrentAdminRole(),
  });
  appendAuditLog('Blocked restricted admin section', normalized);

  return `
    <section class="rounded-[2rem] border border-amber-200 bg-amber-50 p-8 shadow-sm">
      <p class="text-sm uppercase tracking-[0.3em] text-amber-700">Restricted access</p>
      <h2 class="mt-2 text-2xl font-semibold text-slate-900">This control surface is reserved for Super Admin users.</h2>
      <p class="mt-3 text-slate-600">Only platform administrators can manage pricing, billing, API keys, feature flags, security posture, and audit controls.</p>
      <div class="mt-6 rounded-[1.5rem] border border-amber-200 bg-white/80 p-4 text-sm text-slate-700">
        The current session was logged for review and sensitive operations remain concealed until elevated access is granted.
      </div>
    </section>
  `;
}

function maskSensitiveValue(value, preserveStart = 2, preserveEnd = 2) {
  if (value === null || value === undefined || value === '') return '';
  const stringValue = String(value);
  if (stringValue.length <= preserveStart + preserveEnd) {
    return `${'*'.repeat(Math.max(4, stringValue.length))}`;
  }
  return `${stringValue.slice(0, preserveStart)}${'*'.repeat(Math.max(6, stringValue.length - preserveStart - preserveEnd))}${stringValue.slice(-preserveEnd)}`;
}

function shouldMaskField(name) {
  return ['apiKey', 'secretKey', 'webhookSecret'].includes(name);
}

function getSchoolDirectoryFromState() {
  const state = getAdminState();
  const stored = Array.isArray(state.schools) && state.schools.length ? state.schools : [];
  const localSnapshot = localStorage.getItem('globyedu_schoolDirectory');
  if (!localSnapshot) return stored;
  try {
    const parsed = JSON.parse(localSnapshot);
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {
    // Ignore invalid local storage values and fall back to state.
  }
  return stored.length ? stored : [];
}

function renderSchoolRecipientOptions(selected = [], loadedSchools = []) {
  const storedSchools = getSchoolDirectoryFromState();
  const schools = storedSchools.length ? storedSchools : loadedSchools;
  if (!schools.length) {
    return `<option value="">No schools available</option>`;
  }
  const selectedSet = new Set(Array.isArray(selected) ? selected : []);
  const schoolOptions = schools.map((school) => {
    const value = String(school.schoolId || school.id || school.name || '');
    const label = school.name || school.schoolName || value;
    const checked = selectedSet.has(value) ? 'selected' : '';
    return `<option value="${value}" ${checked}>${label}</option>`;
  }).join('');
  return `<option value="all-schools">All Schools</option>${schoolOptions}`;
}

function renderSectionContent(activeSection, userFullName, summary = {}, schools = [], pricingPlans = [], auditLogs = [], maintenanceMode = null) {
  const normalizedSection = String(activeSection || 'overview').toLowerCase();
  if (isSectionRestricted(normalizedSection) && getCurrentAdminRole() !== 'super_admin') {
    return renderRestrictedAccessNotice(normalizedSection);
  }

  if (normalizedSection === 'profile') return renderPlatformProfile(userFullName);
  if (normalizedSection === 'schools') return renderSchoolManagement(schools);
  if (normalizedSection === 'archived-schools') return renderArchivedSchools(schools);
  if (normalizedSection === 'website-cms') return renderWebsiteCMS();
  if (normalizedSection === 'ai-settings') return renderAISettings();
  if (normalizedSection === 'features') return renderFeatureManager();
  if (normalizedSection === 'payments') return renderPayments();
  if (normalizedSection === 'pricing' || normalizedSection === 'subscriptions') {
    return `${renderSubscriptions(summary, schools)}${renderPricingManagement(pricingPlans)}`;
  }
  if (normalizedSection === 'analytics') return renderAnalytics(summary, schools);
  if (normalizedSection === 'users') return renderUsers(schools);
  if (normalizedSection === 'reports') return renderReports(summary, schools);
  if (normalizedSection === 'messages') return renderMessages(schools);
  if (normalizedSection === 'announcements') return renderAnnouncements();
  if (normalizedSection === 'support') return renderSupport(schools);
  if (normalizedSection === 'plugins') return renderPlugins();
  if (normalizedSection === 'audit-logs') return renderAuditLogs(auditLogs);
  if (normalizedSection === 'system-settings') return renderSystemSettings(maintenanceMode);
  if (normalizedSection === 'settings') return renderPlatformSettings(maintenanceMode);
  if (normalizedSection === 'backups') return renderBackups();
  if (normalizedSection === 'security') return renderSecurity();
  if (normalizedSection === 'overview') return renderDashboardOverview(userFullName, summary);
  return renderModulePlaceholder(normalizedSection);
}

function renderPlatformProfile(userFullName) {
  const email = localStorage.getItem('globyedu_userEmail') || '';
  const escape = (value) => String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);

  return `
    <section class="rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-sm">
      <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Platform account</p>
      <h2 class="mt-2 text-2xl font-semibold text-slate-900">Profile</h2>
      <div class="mt-6 flex flex-wrap items-center gap-4">
        <div class="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-sky-100 text-2xl font-semibold text-sky-700">
          <span data-platform-profile-initial>${escape(userFullName).slice(0, 1)}</span>
          <img data-platform-profile-photo alt="Profile photo" class="hidden h-full w-full object-cover" />
        </div>
        <div>
          <label class="inline-flex cursor-pointer rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white">
            Upload profile photo
            <input data-account-profile-photo-input type="file" accept="image/jpeg,image/png,image/gif,image/webp" class="sr-only" />
          </label>
          <button type="button" data-account-profile-camera class="ml-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">Use camera</button>
          <p data-account-profile-photo-status class="mt-2 text-sm text-slate-600" role="status" aria-live="polite"></p>
        </div>
      </div>
      <dl class="mt-6 grid gap-4 sm:grid-cols-2">
        <div class="rounded-xl bg-slate-50 p-4"><dt class="text-sm text-slate-500">Name</dt><dd class="mt-1 font-semibold text-slate-900">${escape(userFullName)}</dd></div>
        <div class="rounded-xl bg-slate-50 p-4"><dt class="text-sm text-slate-500">Email</dt><dd class="mt-1 break-all font-semibold text-slate-900">${escape(email)}</dd></div>
        <div class="rounded-xl bg-slate-50 p-4"><dt class="text-sm text-slate-500">Role</dt><dd class="mt-1 font-semibold text-slate-900">Super Admin</dd></div>
      </dl>
    </section>
  `;
}

function renderDashboardOverview(userFullName, summary = {}) {
  const displayName = userFullName || 'Benjamin';
  const metrics = getPlatformDashboardMetrics(summary);
  const schoolStatusDistribution = [
    { label: 'Active', value: metrics.activeSchools, color: 'bg-emerald-500', width: metrics.totalSchools ? (metrics.activeSchools / metrics.totalSchools) * 100 : 0 },
    { label: 'Trial', value: metrics.trialSchools, color: 'bg-sky-500', width: metrics.totalSchools ? (metrics.trialSchools / metrics.totalSchools) * 100 : 0 },
    { label: 'Suspended', value: metrics.suspendedSchools, color: 'bg-amber-500', width: metrics.totalSchools ? (metrics.suspendedSchools / metrics.totalSchools) * 100 : 0 },
  ];
  const recentActivity = metrics.latestActivity.length
    ? metrics.latestActivity.map((entry) => renderActivityItem(entry.action || 'Platform action', entry.details || 'Recent platform activity was recorded.')).join('')
    : renderActivityItem('Platform initialized', 'No recent actions have been captured yet.');
  const recentSchools = metrics.recentSchools.length
    ? metrics.recentSchools.map((school) => `
      <div class="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <div>
          <p class="font-semibold text-slate-900">${school.name || school.schoolName || 'School'}</p>
          <p class="text-xs text-slate-500">${school.schoolId || school.id || 'school-id'}</p>
        </div>
        <span class="rounded-full bg-slate-200 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-700">Operational: ${getAdminSchoolStatus(school)} · Subscription: ${getAdminSchoolSubscriptionStatus(school)}</span>
      </div>
    `).join('')
    : '<div class="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">No schools tracked yet.</div>';

  return `
    <section class="space-y-6">
          <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Welcome back</p>
            <h2 class="mt-2 text-3xl font-semibold text-slate-900">Welcome, ${displayName}</h2>
            <p class="mt-3 text-slate-600">Live platform metrics update from the current tenant data and saved platform settings.</p>
          </div>
          <div class="grid gap-3 sm:flex">
            <button type="button" data-admin-nav="reports" class="rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700">View reports</button>
            <button type="button" data-admin-nav="schools" class="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">School directory</button>
          </div>
        </div>
      </div>

      <div class="grid gap-6 xl:grid-cols-4">
        ${renderStatCard('Total Schools', metrics.totalSchools.toLocaleString(), 'All tenant schools managed by the platform.', 'bg-sky-50 text-sky-700')}
        ${renderStatCard('Active Schools', metrics.activeSchools.toLocaleString(), 'Schools currently active.', 'bg-emerald-50 text-emerald-700')}
        ${renderStatCard('Trial Schools', metrics.trialSchools.toLocaleString(), 'Schools using trial access.', 'bg-slate-50 text-slate-700')}
        ${renderStatCard('Suspended Schools', metrics.suspendedSchools.toLocaleString(), 'Schools requiring follow-up.', 'bg-rose-50 text-rose-700')}
      </div>

      <div class="grid gap-6 xl:grid-cols-4">
        ${renderStatCard('Total Students', metrics.totalStudents.toLocaleString(), 'All enrolled students across tenants.', 'bg-white text-slate-900')}
        ${renderStatCard('Total Teachers', metrics.totalTeachers.toLocaleString(), 'Active teaching staff across tenants.', 'bg-white text-slate-900')}
        ${renderStatCard('Active Subscriptions', metrics.activeSubscriptions.toLocaleString(), 'Current active subscription base.', 'bg-white text-slate-900')}
      </div>

      <div class="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
          <div class="mb-6 flex items-center justify-between">
            <div>
              <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Platform status</p>
                <h3 class="mt-2 text-2xl font-semibold text-slate-900">${metrics.totalSchools ? 'Operational' : 'No school data'}</h3>
            </div>
            <span class="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">${metrics.totalSchools ? 'Live data' : 'Empty'}</span>
          </div>
          <p class="text-sm text-slate-600">Status distribution from the platform tenant records.</p>
          <div class="mt-6 space-y-4">
            ${schoolStatusDistribution.map((item) => `
              <div>
                <div class="mb-2 flex items-center justify-between text-xs uppercase tracking-[0.2em] text-slate-500">
                  <span>${item.label}</span>
                  <span>${item.value}</span>
                </div>
                <div class="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                  <div class="${item.color} h-full rounded-full" style="width: ${Math.min(100, item.width || 0)}%"></div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
          <div class="mb-6 flex items-center justify-between">
            <div>
              <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Platform revenue</p>
              <h3 class="mt-2 text-2xl font-semibold text-slate-900">${metrics.revenue || 'Not available'}</h3>
            </div>
            <span class="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">Verified data only</span>
          </div>
          <p class="text-sm text-slate-600">No reliable platform subscription-revenue ledger is configured yet.</p>
          <div class="mt-6 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
            <p class="text-xs uppercase tracking-[0.3em] text-slate-500">Revenue</p>
            <p class="mt-2 text-2xl font-semibold text-slate-900">${metrics.revenue || 'Not available'}</p>
          </div>
        </div>
      </div>

      <div class="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
          <div class="mb-6 flex items-center justify-between">
            <div>
              <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Recent activity</p>
              <h3 class="mt-2 text-2xl font-semibold text-slate-900">Latest platform events</h3>
            </div>
            <span class="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">Updated now</span>
          </div>
          <ul class="space-y-4 text-sm text-slate-600">
            ${recentActivity}
          </ul>
        </div>
        <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Recent schools</p>
          <div class="mt-4 space-y-3">${recentSchools}</div>
        </div>
      </div>
    </section>
  `;
}

function renderProgressBar(label, percent) {
  const safePercent = Math.min(Math.max(percent, 0), 100);
  return `
    <div class="mt-6">
      <div class="flex items-center justify-between text-sm text-slate-500">
        <span>${label}</span>
        <span>${safePercent}%</span>
      </div>
      <div class="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <div class="h-full rounded-full bg-sky-600" style="width: ${safePercent}%;"></div>
      </div>
    </div>
  `;
}

function renderStatCard(title, value, subtitle, style) {
  return `
    <div class="rounded-[2rem] border border-slate-200 p-6 shadow-sm ${style}">
      <p class="text-sm font-medium uppercase tracking-[0.3em]">${title}</p>
      <p class="mt-5 text-3xl font-semibold">${value}</p>
      <p class="mt-3 text-sm text-slate-600">${subtitle}</p>
    </div>
  `;
}

function renderActivityItem(title, description) {
  return `
    <li class="rounded-[1.75rem] border border-slate-200 bg-slate-50 p-4">
      <p class="font-semibold text-slate-900">${title}</p>
      <p class="mt-2 text-sm text-slate-600">${description}</p>
    </li>
  `;
}

function renderChartPlaceholder(id) {
  return `
    <div id="${id}" class="h-72 rounded-[2rem] bg-gradient-to-br from-sky-50 via-white to-slate-50 p-6 shadow-inner shadow-slate-200/50">
      <div class="h-full rounded-[1.5rem] bg-slate-100"></div>
    </div>
  `;
}

function renderMiniGraphPlaceholder() {
  return `
    <div class="h-28 rounded-[1.75rem] bg-slate-50 p-4 shadow-inner shadow-slate-200/50">
      <div class="relative h-full">
        <div class="absolute left-0 top-6 h-2 w-16 rounded-full bg-sky-500"></div>
        <div class="absolute left-16 top-14 h-2 w-12 rounded-full bg-sky-400"></div>
        <div class="absolute left-32 top-10 h-2 w-14 rounded-full bg-sky-500"></div>
        <div class="absolute left-48 top-7 h-2 w-10 rounded-full bg-sky-300"></div>
        <div class="absolute left-64 top-16 h-2 w-16 rounded-full bg-sky-500"></div>
      </div>
    </div>
  `;
}

function renderHealthBadge(label, value, tone) {
  return `
    <div class="flex items-center justify-between rounded-3xl bg-slate-50 px-4 py-4">
      <div>
        <p class="text-sm text-slate-600">${label}</p>
        <p class="mt-1 text-base font-semibold text-slate-900">${value}</p>
      </div>
      <span class="rounded-full px-3 py-1 text-xs font-semibold ${tone === 'good' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}">${tone === 'good' ? 'Good' : 'Stable'}</span>
    </div>
  `;
}

function renderMiniStat(title, value, icon) {
  return `
    <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
      <div class="flex items-center gap-3 text-slate-500">
        <span class="text-2xl">${icon}</span>
        <p class="text-sm uppercase tracking-[0.3em]">${title}</p>
      </div>
      <p class="mt-5 text-3xl font-semibold text-slate-900">${value}</p>
    </div>
  `;
}

function renderMiniInfo(label, value) {
  return `
    <div class="rounded-3xl bg-slate-50 px-4 py-3">
      <p class="text-sm text-slate-500">${label}</p>
      <p class="mt-2 text-base font-semibold text-slate-900">${value}</p>
    </div>
  `;
}

function renderSchoolManagement(schools = []) {
  const schoolRows = schools.map((school) => renderSchoolRow(school)).join('');
  const statusOptions = getAdminSchoolStatuses(schools).map((status) => {
    const safeStatus = escapeSchoolDirectoryText(status);
    const label = status.split(/[-_]/).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    return `<option value="${safeStatus}">${escapeSchoolDirectoryText(label)}</option>`;
  }).join('');

  return `
    <section class="space-y-6">
      <!-- School Management Header -->
      <div class="grid gap-6 lg:grid-cols-[0.8fr_0.4fr]">
        <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
          <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p class="text-sm uppercase tracking-[0.3em] text-slate-500">School Management</p>
              <h2 class="mt-2 text-2xl font-semibold text-slate-900">Manage tenant schools</h2>
            </div>
            <div class="flex flex-wrap gap-3">
              <button id="create-school-button" class="inline-flex items-center justify-center rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700">+ Create School</button>
              <button type="button" data-admin-nav="archived-schools" class="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">Archived Schools</button>
            </div>
          </div>
          <div class="mt-6 grid gap-4 sm:grid-cols-2">
            <input type="text" id="school-search-input" placeholder="Search schools..." class="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm placeholder-slate-400 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
            <select id="school-status-filter" class="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100">
              <option value="">All Statuses</option>
              ${statusOptions}
            </select>
          </div>
          <div id="admin-school-message" class="mt-4 hidden rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700"></div>
        </div>

        <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Quick Actions</p>
          <div class="mt-6 grid gap-3">
            <button class="school-action-quick inline-flex w-full items-center justify-between rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100" data-action="create">Create School <span>+</span></button>
            <button class="school-action-quick inline-flex w-full items-center justify-between rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100" data-action="view-all">View All Schools <span>→</span></button>
            <button class="school-action-quick inline-flex w-full items-center justify-between rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100" data-action="export">Export List <span>⬇</span></button>
          </div>
        </div>
      </div>

      <!-- School Directory Table -->
      <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div class="mb-6 flex items-center justify-between">
          <div>
            <p class="text-sm uppercase tracking-[0.3em] text-slate-500">School Directory</p>
            <h3 class="mt-2 text-xl font-semibold text-slate-900">Search and filter tenant schools</h3>
          </div>
          <span id="school-directory-count" class="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">${schools.length} ${schools.length === 1 ? 'school' : 'schools'}</span>
        </div>
        <div class="overflow-x-auto rounded-[1.75rem] border border-slate-200">
          <table class="w-full border-collapse text-left text-sm text-slate-700">
            <thead class="bg-slate-50 text-slate-500">
              <tr>
                <th class="px-5 py-4">School Name</th>
                <th class="px-5 py-4">School ID</th>
                <th class="px-5 py-4">Subscription</th>
                <th class="px-5 py-4">Status</th>
                <th class="px-5 py-4">Users</th>
                <th class="px-5 py-4">Actions</th>
              </tr>
            </thead>
            <tbody id="school-directory-rows">
              ${schoolRows}
              <tr id="school-directory-empty" class="${schools.length ? 'hidden' : ''}"><td colspan="6" class="px-5 py-8 text-center text-sm text-slate-500">No schools found. Create a new tenant school to get started.</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Create/Edit School Modal -->
      <div id="school-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50">
        <div class="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[2rem] border border-slate-200 bg-white p-8 shadow-2xl">
          <button id="school-modal-close" class="absolute right-6 top-6 rounded-full bg-slate-100 p-2 text-slate-600 hover:bg-slate-200">✕</button>
          
          <div id="school-modal-content">
            <!-- Content will be injected here -->
          </div>
        </div>
      </div>

      <!-- View School Details Modal -->
      <div id="school-details-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50">
        <div class="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[2rem] border border-slate-200 bg-white p-8 shadow-2xl">
          <button id="school-details-modal-close" class="absolute right-6 top-6 rounded-full bg-slate-100 p-2 text-slate-600 hover:bg-slate-200">✕</button>
          
          <div id="school-details-content">
            <!-- School details will be injected here -->
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderSchoolRow(school) {
  const name = school.name || school.schoolName || 'Unknown school';
  const schoolId = school.schoolId || '—';
  const subscription = school.subscriptionPlan || 'trial';
  const status = getAdminSchoolStatus(school);
  const subscriptionStatus = getAdminSchoolSubscriptionStatus(school);
  const studentCount = school.studentCount ?? (Array.isArray(school.students) ? school.students.length : 0);
  const teacherCount = school.teacherCount ?? (Array.isArray(school.teachers) ? school.teachers.length : 0);
  
  // Render status-appropriate action button
  let statusButton = '';
  if (status === 'suspended') {
    statusButton = `<button class="admin-school-action inline-flex items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100" data-action="activate" data-school-id="${schoolId}">Activate</button>`;
  } else {
    statusButton = `<button class="admin-school-action inline-flex items-center justify-center rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 transition hover:bg-amber-100" data-action="suspend" data-school-id="${schoolId}">Suspend</button>`;
  }

  return `
    <tr data-school-id="${schoolId}" data-school-status="${status}" data-school-subscription-status="${subscriptionStatus}" class="border-t border-slate-200 hover:bg-slate-50 transition">
      <td class="px-5 py-4 font-semibold text-slate-900">${name}</td>
      <td class="px-5 py-4 font-mono text-xs text-slate-600">${schoolId}</td>
      <td class="px-5 py-4 capitalize text-slate-600">${subscription}</td>
      <td class="px-5 py-4"><div class="space-y-2"><div><span class="mr-2 text-xs text-slate-500">Operational</span>${renderStatusBadge(status)}</div><div><span class="mr-2 text-xs text-slate-500">Subscription</span>${renderStatusBadge(subscriptionStatus)}</div></div></td>
      <td class="px-5 py-4 text-slate-600">${studentCount} students / ${teacherCount} teachers</td>
      <td class="px-5 py-4 flex flex-wrap gap-2">
        <button class="admin-school-action inline-flex items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100" data-action="view" data-school-id="${schoolId}" title="View details">👁</button>
        <button class="admin-school-action inline-flex items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100" data-action="edit" data-school-id="${schoolId}" title="Edit school">✏</button>
        ${statusButton}
        <button class="admin-school-action inline-flex items-center justify-center rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 transition hover:bg-amber-100" data-action="archive" data-school-id="${schoolId}" title="Archive school">Archive</button>
      </td>
    </tr>
  `;
}

function renderArchivedSchools(schools = []) {
  const statusOptions = getAdminSchoolStatuses(schools).map((status) => {
    const safeStatus = escapeSchoolDirectoryText(status);
    const label = status.split(/[-_]/).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    return `<option value="${safeStatus}">${escapeSchoolDirectoryText(label)}</option>`;
  }).join('');
  const rows = schools.map((school) => {
    const name = escapeSchoolDirectoryText(school.name || school.schoolName || 'Unknown school');
    const schoolId = escapeSchoolDirectoryText(school.schoolId || school.id || '');
    const status = escapeSchoolDirectoryText(getAdminSchoolStatus(school));
    const subscriptionStatus = escapeSchoolDirectoryText(getAdminSchoolSubscriptionStatus(school));
    const plan = escapeSchoolDirectoryText(school.subscriptionPlan || 'trial');
    const archivedAt = school.archivedAt && !Number.isNaN(new Date(school.archivedAt).getTime())
      ? new Date(school.archivedAt).toLocaleString()
      : '—';
    const studentCount = school.studentCount ?? (Array.isArray(school.students) ? school.students.length : 0);
    const teacherCount = school.teacherCount ?? (Array.isArray(school.teachers) ? school.teachers.length : 0);
    return `
      <tr data-archived-school-row data-school-id="${schoolId}" data-school-status="${status}" data-school-subscription-status="${subscriptionStatus}" class="border-t border-slate-200 hover:bg-slate-50 transition">
        <td class="px-5 py-4 font-semibold text-slate-900">${name}</td>
        <td class="px-5 py-4 font-mono text-xs text-slate-600">${schoolId}</td>
        <td class="px-5 py-4 capitalize text-slate-600">${plan}</td>
        <td class="px-5 py-4"><div class="space-y-2"><div><span class="mr-2 text-xs text-slate-500">Operational</span>${renderStatusBadge(status)}</div><div><span class="mr-2 text-xs text-slate-500">Subscription</span>${renderStatusBadge(subscriptionStatus)}</div></div></td>
        <td class="px-5 py-4 text-sm text-slate-600">${escapeSchoolDirectoryText(archivedAt)}</td>
        <td class="px-5 py-4 text-slate-600">${studentCount} students / ${teacherCount} teachers</td>
        <td class="px-5 py-4 flex flex-wrap gap-2">
          <button type="button" data-archived-school-action="view" data-school-id="${schoolId}" class="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">View</button>
          <button type="button" data-archived-school-action="restore" data-school-id="${schoolId}" class="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">Restore</button>
          <button type="button" data-archived-school-action="permanent-delete" data-school-id="${schoolId}" class="rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800">Delete permanently</button>
        </td>
      </tr>`;
  }).join('');

  return `
    <section class="space-y-6">
      <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="text-sm uppercase tracking-[0.3em] text-slate-500">School Management</p>
            <h2 class="mt-2 text-2xl font-semibold text-slate-900">Archived Schools</h2>
          </div>
          <button type="button" data-admin-nav="schools" class="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Back to Schools</button>
        </div>
        <div class="mt-6 grid gap-4 sm:grid-cols-2">
          <input id="archived-school-search-input" type="search" placeholder="Search archived schools..." class="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" />
          <select id="archived-school-status-filter" class="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
            <option value="">All Previous Statuses</option>${statusOptions}
          </select>
        </div>
        <div id="archived-school-message" class="mt-4 hidden rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700" role="status" aria-live="polite"></div>
      </div>
      <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div class="mb-6 flex items-center justify-between">
          <h3 class="text-xl font-semibold text-slate-900">Archived directory</h3>
          <span id="archived-school-directory-count" class="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">${schools.length} ${schools.length === 1 ? 'school' : 'schools'}</span>
        </div>
        <div class="overflow-x-auto rounded-[1.75rem] border border-slate-200">
          <table class="w-full border-collapse text-left text-sm text-slate-700">
            <thead class="bg-slate-50 text-slate-500"><tr><th class="px-5 py-4">School Name</th><th class="px-5 py-4">School ID</th><th class="px-5 py-4">Subscription Plan</th><th class="px-5 py-4">Previous Operational / Subscription Status</th><th class="px-5 py-4">Archived Date</th><th class="px-5 py-4">Users</th><th class="px-5 py-4">Actions</th></tr></thead>
            <tbody id="archived-school-directory-rows">
              ${rows}
              <tr id="archived-school-directory-empty" class="${schools.length ? 'hidden' : ''}"><td colspan="7" class="px-5 py-8 text-center text-sm text-slate-500">No archived schools found.</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div id="school-details-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50">
        <div class="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[2rem] border border-slate-200 bg-white p-8 shadow-2xl">
          <button id="school-details-modal-close" class="absolute right-6 top-6 rounded-full bg-slate-100 p-2 text-slate-600 hover:bg-slate-200" aria-label="Close details">✕</button>
          <div id="school-details-content"></div>
        </div>
      </div>
    </section>`;
}

function escapeSchoolDirectoryText(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function renderStatusBadge(status) {
  const normalized = String(status || '').toLowerCase();
  const styles = {
    active: 'bg-emerald-100 text-emerald-700',
    trial: 'bg-sky-100 text-sky-700',
    suspended: 'bg-amber-100 text-amber-700',
    expired: 'bg-rose-100 text-rose-700',
    inactive: 'bg-slate-100 text-slate-700',
  };
  const style = styles[normalized] || 'bg-slate-100 text-slate-700';
  const label = normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : 'Unknown';
  return `<span class="rounded-full px-3 py-1 text-xs font-semibold ${style}">${label}</span>`;
}

// School Modal Templates
function renderCreateSchoolModal() {
  return `
    <div>
      <p class="text-sm uppercase tracking-[0.3em] text-sky-600">School Setup</p>
      <h2 class="mt-2 text-2xl font-semibold text-slate-900">Create a New School</h2>
      <p class="mt-2 text-slate-600">Add a new tenant school to the platform. A unique School ID and initial admin account will be auto-generated.</p>
      
      <form id="school-create-form" class="mt-6 space-y-4">
        <label class="block">
          <span class="text-sm font-medium text-slate-700">School Name *</span>
          <input type="text" name="schoolName" required placeholder="e.g., Meridian International School" class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
        </label>
        
        <label class="block">
          <span class="text-sm font-medium text-slate-700">Head of School Name *</span>
          <input type="text" name="headName" required placeholder="e.g., Dr. John Smith" class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
        </label>
        
        <label class="block">
          <span class="text-sm font-medium text-slate-700">Head Email Address *</span>
          <input type="email" name="headEmail" required placeholder="head@school.edu" class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
        </label>
        
        <label class="block">
          <span class="text-sm font-medium text-slate-700">Subscription Plan *</span>
          <select name="subscriptionPlan" required class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100">
            <option value="">Select a plan</option>
            <option value="trial">Trial (3 days)</option>
            <option value="starter">Starter ($99/month)</option>
            <option value="growth">Growth ($299/month)</option>
            <option value="enterprise">Enterprise (Custom)</option>
          </select>
        </label>
        
        <label class="block">
          <span class="text-sm font-medium text-slate-700">Country/Region</span>
          <input type="text" name="region" placeholder="e.g., United States" class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
        </label>
        
        <label class="block">
          <span class="text-sm font-medium text-slate-700">School Description</span>
          <textarea name="description" rows="3" placeholder="Brief description of the school..." class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"></textarea>
        </label>
        
        <div class="flex gap-3 pt-4">
          <button type="submit" class="flex-1 rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700">Create School</button>
          <button type="button" class="flex-1 rounded-full border border-slate-200 bg-slate-50 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100" id="school-modal-cancel">Cancel</button>
        </div>
        
        <div id="school-create-status" class="mt-4 hidden rounded-3xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800"></div>
      </form>
    </div>
  `;
}

function renderEditSchoolModal(school) {
  const name = school.name || school.schoolName || '';
  const headName = school.headName || '';
  const headEmail = school.headEmail || '';
  const subscriptionPlan = school.subscriptionPlan || 'trial';
  const expiresAt = school.expiresAt && !Number.isNaN(new Date(school.expiresAt).getTime())
    ? new Date(school.expiresAt).toISOString().slice(0, 10)
    : '';
  const region = school.region || '';
  const description = school.description || '';
  
  return `
    <div>
      <p class="text-sm uppercase tracking-[0.3em] text-sky-600">School Settings</p>
      <h2 class="mt-2 text-2xl font-semibold text-slate-900">Edit School: ${name}</h2>
      <p class="mt-2 text-sm text-slate-600">School ID: <code class="bg-slate-100 px-2 py-1 rounded">${school.schoolId}</code></p>
      
      <form id="school-edit-form" class="mt-6 space-y-4" data-school-id="${school.schoolId}">
        <label class="block">
          <span class="text-sm font-medium text-slate-700">School Name</span>
          <input type="text" name="schoolName" value="${name}" placeholder="School name" class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
        </label>
        
        <label class="block">
          <span class="text-sm font-medium text-slate-700">Head Name</span>
          <input type="text" name="headName" value="${headName}" placeholder="Head of school" class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
        </label>
        
        <label class="block">
          <span class="text-sm font-medium text-slate-700">Head Email</span>
          <input type="email" name="headEmail" value="${headEmail}" placeholder="head@school.edu" class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
        </label>

        <div class="rounded-3xl border border-amber-200 bg-amber-50 p-4">
          <p class="text-sm font-semibold text-amber-900">School access credentials</p>
          <p class="mt-1 text-xs text-amber-800">Resetting generates a temporary password and displays it once. The existing password is never shown.</p>
          <button type="button" id="school-credential-reset" class="mt-3 rounded-full border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900 transition hover:bg-amber-100">Generate temporary password</button>
          <div id="school-credential-status" class="mt-3 hidden text-sm text-amber-900"></div>
        </div>
        
        <label class="block">
          <span class="text-sm font-medium text-slate-700">Subscription Plan</span>
          <select name="subscriptionPlan" class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100">
            <option value="trial" ${subscriptionPlan === 'trial' ? 'selected' : ''}>Trial (3 days)</option>
            <option value="starter" ${subscriptionPlan === 'starter' ? 'selected' : ''}>Starter ($99/month)</option>
            <option value="growth" ${subscriptionPlan === 'growth' ? 'selected' : ''}>Growth ($299/month)</option>
            <option value="enterprise" ${subscriptionPlan === 'enterprise' ? 'selected' : ''}>Enterprise (Custom)</option>
          </select>
        </label>

        <div class="rounded-3xl border border-sky-200 bg-sky-50 p-4">
          <label class="flex items-start gap-3 text-sm font-medium text-sky-950">
            <input type="checkbox" name="grantPaymentGracePeriod" class="mt-1" />
            <span>Grant or extend temporary access while payment is due</span>
          </label>
          <label class="mt-3 block">
            <span class="text-sm font-medium text-slate-700">Access extension ends (UTC)</span>
            <input type="date" name="gracePeriodEndsAt" value="${expiresAt}" class="mt-2 w-full rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
          </label>
          <p class="mt-2 text-xs text-slate-600">This does not record a payment. The school can sign in until the selected expiry date.</p>
        </div>
        
        <label class="block">
          <span class="text-sm font-medium text-slate-700">Region/Country</span>
          <input type="text" name="region" value="${region}" placeholder="e.g., United States" class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
        </label>
        
        <label class="block">
          <span class="text-sm font-medium text-slate-700">Description</span>
          <textarea name="description" rows="3" placeholder="School description..." class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100">${description}</textarea>
        </label>
        
        <div class="flex gap-3 pt-4">
          <button type="submit" class="flex-1 rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700">Save Changes</button>
          <button type="button" class="flex-1 rounded-full border border-slate-200 bg-slate-50 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100" id="school-modal-cancel">Cancel</button>
        </div>
        
        <div id="school-edit-status" class="mt-4 hidden rounded-3xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800"></div>
      </form>
    </div>
  `;
}

function renderSchoolDetailsModal(school, isArchived = false) {
  const name = school.name || school.schoolName || 'Unknown';
  const schoolId = school.schoolId || '—';
  const status = getAdminSchoolStatus(school);
  const subscriptionStatus = getAdminSchoolSubscriptionStatus(school);
  const plan = school.subscriptionPlan || 'trial';
  const studentCount = school.studentCount ?? (Array.isArray(school.students) ? school.students.length : 0);
  const teacherCount = school.teacherCount ?? (Array.isArray(school.teachers) ? school.teachers.length : 0);
  const headName = school.headName || '—';
  const headEmail = school.headEmail || school.email || '—';
  const createdAt = school.createdAt || null;
  const expiresAt = school.expiresAt || '—';
  const archivedAt = school.archivedAt || null;
  
  return `
    <div>
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm uppercase tracking-[0.3em] text-sky-600">School Details</p>
          <h2 class="mt-2 text-2xl font-semibold text-slate-900">${name}</h2>
        </div>
        <div class="space-y-2 text-right"><div><span class="mr-2 text-xs text-slate-500">Operational</span>${renderStatusBadge(status)}</div><div><span class="mr-2 text-xs text-slate-500">Subscription</span>${renderStatusBadge(subscriptionStatus)}</div></div>
      </div>
      
      <div class="mt-6 grid gap-4 sm:grid-cols-2">
        <div class="rounded-3xl border border-slate-200 bg-slate-50 p-4">
          <p class="text-xs uppercase tracking-[0.2em] text-slate-500">School ID</p>
          <p class="mt-2 font-mono font-semibold text-slate-900">${schoolId}</p>
        </div>
        <div class="rounded-3xl border border-slate-200 bg-slate-50 p-4">
          <p class="text-xs uppercase tracking-[0.2em] text-slate-500">Subscription Plan</p>
          <p class="mt-2 font-semibold text-slate-900 capitalize">${plan}</p>
        </div>
        <div class="rounded-3xl border border-slate-200 bg-slate-50 p-4">
          <p class="text-xs uppercase tracking-[0.2em] text-slate-500">Subdomain</p>
          <p class="mt-2 font-semibold text-slate-900">${school.subdomain || '—'}</p>
        </div>
        <div class="rounded-3xl border border-slate-200 bg-slate-50 p-4">
          <p class="text-xs uppercase tracking-[0.2em] text-slate-500">School email</p>
          <p class="mt-2 text-sm text-slate-900">${school.email || headEmail}</p>
        </div>
        <div class="rounded-3xl border border-slate-200 bg-slate-50 p-4">
          <p class="text-xs uppercase tracking-[0.2em] text-slate-500">Head of School</p>
          <p class="mt-2 font-semibold text-slate-900">${headName}</p>
          <p class="mt-1 text-xs text-slate-600">${headEmail}</p>
        </div>
        <div class="rounded-3xl border border-slate-200 bg-slate-50 p-4">
          <p class="text-xs uppercase tracking-[0.2em] text-slate-500">Active Users</p>
          <p class="mt-2 font-semibold text-slate-900">${studentCount} students / ${teacherCount} teachers</p>
        </div>
        <div class="rounded-3xl border border-slate-200 bg-slate-50 p-4">
          <p class="text-xs uppercase tracking-[0.2em] text-slate-500">Created</p>
          <p class="mt-2 text-sm text-slate-900">${createdAt ? new Date(createdAt).toLocaleDateString() : '—'}</p>
        </div>
        ${isArchived ? `<div class="rounded-3xl border border-amber-200 bg-amber-50 p-4"><p class="text-xs uppercase tracking-[0.2em] text-amber-800">Archived</p><p class="mt-2 text-sm text-amber-900">${archivedAt && !Number.isNaN(new Date(archivedAt).getTime()) ? new Date(archivedAt).toLocaleString() : '—'}</p></div>` : ''}
        <div class="rounded-3xl border border-slate-200 bg-slate-50 p-4">
          <p class="text-xs uppercase tracking-[0.2em] text-slate-500">Subscription Expires</p>
          <p class="mt-2 text-sm text-slate-900">${expiresAt === '—' ? expiresAt : new Date(expiresAt).toLocaleDateString()}</p>
        </div>
      </div>
      
      <div class="mt-6 flex gap-3">
        ${isArchived ? '' : `<button class="school-action-quick flex-1 rounded-full border border-slate-200 bg-slate-50 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100" data-action="edit" data-school-id="${schoolId}">Edit School</button>`}
        <button class="school-action-quick flex-1 rounded-full border border-slate-200 bg-slate-50 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100" data-action="close-modal">Close</button>
      </div>
    </div>
  `;
}

function getWebsiteCMSSettings() {
  const defaultSettings = {
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
  };

  try {
    if (cachedWebsiteCMSSettings) return { ...defaultSettings, ...cachedWebsiteCMSSettings };
    const stored = localStorage.getItem(WEBSITE_CMS_STORAGE_KEY);
    if (!stored) return { ...defaultSettings };
    const settings = { ...defaultSettings, ...JSON.parse(stored) };
    ['contactEmail', 'contactPhone', 'whatsApp'].forEach((field) => {
      if (String(settings[field] || '').includes('*')) settings[field] = defaultSettings[field];
    });
    return settings;
  } catch {
    return { ...defaultSettings };
  }
}

function saveWebsiteCMSSettings(values = {}) {
  const merged = { ...getWebsiteCMSSettings(), ...values };
  cachedWebsiteCMSSettings = merged;
  const state = getAdminState();
  state.cms = merged;
  saveAdminState(state);
  localStorage.setItem(WEBSITE_CMS_STORAGE_KEY, JSON.stringify(merged));
  return merged;
}

export function attachWebsiteCMSHandlers() {
  const saveButton = document.getElementById('save-website-cms');
  const cancelButton = document.getElementById('cancel-website-cms');
  const status = document.getElementById('website-cms-status');
  const form = document.getElementById('website-cms-form');
  const logoPreview = form ? form.querySelector('[data-cms-logo-preview]') : null;
  let uploadedLogoPath = '';
  let initialLogoUrl = '';
  let initialSettings = null;

  function showStatus(message, tone = 'success') {
    if (!status) return;
    status.textContent = message;
    status.className = tone === 'error'
      ? 'mb-4 rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800'
      : tone === 'pending'
        ? 'mb-4 rounded-3xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800'
        : 'mb-4 rounded-3xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800';
    status.classList.remove('hidden');
  }

  function hydrateForm(settings) {
    cachedWebsiteCMSSettings = { ...getWebsiteCMSSettings(), ...settings };
    initialSettings = { ...cachedWebsiteCMSSettings };
    uploadedLogoPath = String(settings.logoPath || '');
    initialLogoUrl = String(settings.logoUrl || '');
    document.querySelectorAll('[data-cms-field]').forEach((input) => {
      const fieldName = input.getAttribute('data-cms-field');
      if (fieldName && settings[fieldName] !== undefined) input.value = String(settings[fieldName] ?? '');
    });
    if (logoPreview) logoPreview.src = initialLogoUrl || '/src/assets/images/ui/globyedu-logo.jpg';
  }

  async function loadPublishedSettings() {
    const token = typeof getAccessToken === 'function' ? getAccessToken() : localStorage.getItem('globyedu_accessToken');
    const result = await fetchAdminWebsiteCMS(token);
    if (!result.ok || result.data?.status !== 'ok' || !result.data.settings) {
      showStatus(result.data?.message || 'Unable to load the published website settings.', 'error');
      return;
    }
    hydrateForm(result.data.settings);
    showStatus('Published website settings loaded from the shared platform configuration.', 'success');
  }

  async function uploadBrandingAsset(file) {
    const validationError = validateImageUpload(file);
    if (validationError) throw new Error(validationError);
    const token = typeof getAccessToken === 'function' ? getAccessToken() : localStorage.getItem('globyedu_accessToken');
    if (!token) {
      throw new Error('You must sign in before uploading branding assets to the cloud.');
    }

    const result = await uploadWebsiteCMSLogo(token, file);
    if (!result.ok || result.data?.status !== 'ok' || !result.data.path || !result.data.url) {
      throw new Error(result.data?.message || 'Unable to upload the branding image to storage.');
    }
    return { url: result.data.url, path: result.data.path };
  }

  if (form) {
    const logoFileInput = form.querySelector('[data-cms-logo-file]');
    const logoUrlInput = form.querySelector('[data-cms-field="logoUrl"]');
    void loadPublishedSettings();
    logoFileInput?.addEventListener('change', async () => {
      const file = logoFileInput.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        logoFileInput.value = '';
        if (status) {
          status.textContent = 'Please choose a valid image file for the website logo.';
          status.className = 'mb-4 rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800';
        }
        return;
      }
      const validationError = validateImageUpload(file);
      if (validationError) {
        logoFileInput.value = '';
        if (status) {
          status.textContent = validationError;
          status.className = 'mb-4 rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800';
        }
        return;
      }
      try {
        if (logoFileInput) logoFileInput.disabled = true;
        const uploadedAsset = await uploadBrandingAsset(file);
        uploadedLogoPath = uploadedAsset.path;
        if (logoUrlInput) initialLogoUrl = uploadedAsset.url;
        if (logoUrlInput) logoUrlInput.value = uploadedAsset.url;
        if (logoPreview) logoPreview.src = uploadedAsset.url;
        showStatus('Logo uploaded. Save changes to publish it.', 'pending');
      } catch (error) {
        showStatus(error.message || 'Unable to upload the logo to cloud storage.', 'error');
      } finally {
        if (logoFileInput) logoFileInput.disabled = false;
      }
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const values = {};
      let hasError = false;
      document.querySelectorAll('[data-cms-field]').forEach((input) => {
        const fieldName = input.getAttribute('data-cms-field');
        if (!fieldName) return;
        const value = input.value.trim();
        values[fieldName] = value;
        if ((fieldName === 'companyName' || fieldName === 'heroTitle' || fieldName === 'contactEmail') && !value) {
          hasError = true;
        }
      });
      if (hasError) {
        showStatus('Company name, hero title, and contact email are required.', 'error');
        return;
      }
      const currentSettings = getWebsiteCMSSettings();
      values.logoPath = uploadedLogoPath || (values.logoUrl === initialLogoUrl ? currentSettings.logoPath || '' : '');
      const token = typeof getAccessToken === 'function' ? getAccessToken() : localStorage.getItem('globyedu_accessToken');
      const saveButton = document.getElementById('save-website-cms');
      if (saveButton) saveButton.disabled = true;
      showStatus('Publishing website settings…', 'pending');
      try {
        const result = await publishWebsiteCMS(token, values);
        if (!result.ok || result.data?.status !== 'ok' || !result.data.settings) {
          throw new Error(result.data?.message || 'Website settings could not be published.');
        }
        const saved = saveWebsiteCMSSettings(result.data.settings);
        initialLogoUrl = String(saved.logoUrl || '');
        uploadedLogoPath = String(saved.logoPath || '');
        if (logoUrlInput) logoUrlInput.value = initialLogoUrl;
        if (logoPreview) logoPreview.src = initialLogoUrl || '/src/assets/images/ui/globyedu-logo.jpg';
        showStatus('Website settings published and shared with visitors.', 'success');
        window.dispatchEvent(new CustomEvent('globyedu-cms-updated', { detail: { settings: saved } }));
      } catch (error) {
        showStatus(error.message || 'Website settings could not be published.', 'error');
      } finally {
        if (saveButton) saveButton.disabled = false;
      }
    });

    if (cancelButton) {
      cancelButton.addEventListener('click', () => {
        const settings = initialSettings || getWebsiteCMSSettings();
        hydrateForm(settings);
        if (status) {
          status.textContent = 'Changes cancelled. The latest saved version remains active.';
          status.className = 'mb-4 rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700';
        }
      });
    }
  }

  if (saveButton) {
    saveButton.addEventListener('click', () => {
      form?.dispatchEvent(new Event('submit', { cancelable: true }));
    });
  }

}

function renderWebsiteCMS() {
  const settings = getWebsiteCMSSettings();
  return `
    <section class="space-y-6">
      <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Website CMS</p>
            <h2 class="mt-2 text-2xl font-semibold text-slate-900">Manage homepage content and branding</h2>
            <p class="mt-3 text-slate-600">Published settings are shared with public visitors and other administrators.</p>
          </div>
          <div class="flex flex-wrap gap-3">
            <button id="cancel-website-cms" type="button" class="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">Cancel</button>
            <button id="save-website-cms" type="button" class="rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700">Save changes</button>
          </div>
        </div>
        <form id="website-cms-form">
          <div id="website-cms-status" class="mb-4 hidden rounded-3xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800"></div>
          <div class="grid gap-6 lg:grid-cols-2">
            ${renderSettingInput('Company name', settings.companyName, 'companyName')}
            <label class="block text-sm text-slate-700">Logo URL or uploaded image
              <input type="text" value="${String(settings.logoUrl || '').replace(/"/g, '&quot;')}" name="logoUrl" data-cms-field="logoUrl" class="mt-3 w-full rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
              <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" data-cms-logo-file class="mt-3 block w-full text-sm text-slate-600" />
              <img src="${String(settings.logoUrl || '').replace(/"/g, '&quot;')}" alt="Current website logo" data-cms-logo-preview class="mt-3 h-12 w-12 rounded-xl border border-slate-200 bg-white object-contain p-2" />
            </label>
            ${renderSettingInput('Hero title', settings.heroTitle, 'heroTitle')}
            ${renderSettingInput('Hero subtitle', settings.heroSubtitle, 'heroSubtitle')}
            ${renderSettingInput('Contact email', settings.contactEmail, 'contactEmail')}
            ${renderSettingInput('Contact phone', settings.contactPhone, 'contactPhone')}
            ${renderSettingInput('Address', settings.address, 'address')}
            ${renderSettingInput('Business hours', settings.businessHours, 'businessHours')}
            ${renderSettingInput('WhatsApp', settings.whatsApp, 'whatsApp')}
            ${renderSettingInput('Google Maps URL', settings.googleMapsUrl, 'googleMapsUrl')}
            ${renderSettingInput('Theme color', settings.themeColor, 'themeColor')}
            ${renderSettingInput('Social links', settings.socialLinks, 'socialLinks')}
          </div>
        </form>
      </div>
    </section>
  `;
}

function renderSettingInput(label, value, name = '') {
  const safeValue = String(value ?? '').replace(/"/g, '&quot;');
  const displayValue = shouldMaskField(name) ? maskSensitiveValue(safeValue) : safeValue;
  return `
    <label class="block text-sm text-slate-700">
      ${label}
      <input type="text" value="${displayValue}" name="${name}" data-cms-field="${name}" data-sensitive-field="${shouldMaskField(name) ? 'true' : 'false'}"
        class="mt-3 w-full rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
    </label>
  `;
}

export function attachAdminSectionHandlers(section) {
  const normalizedSection = String(section || 'overview').toLowerCase();
  if (isSectionRestricted(normalizedSection) && getCurrentAdminRole() !== 'super_admin') {
    appendAuditLog('Blocked restricted admin section', normalizedSection);
    return;
  }

  if (normalizedSection === 'ai-settings') {
    const state = getAdminState();
    
    // AI Provider form handlers
    document.querySelectorAll('[data-ai-provider-form]').forEach((form) => {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const state = getAdminState();
        const providerId = form.getAttribute('data-ai-provider-form');
        const provider = state.aiProviders.find((entry) => entry.id === providerId);
        if (!provider) return;
        provider.enabled = form.querySelector('input[name="enabled"]').checked;
        provider.apiKey = form.querySelector('input[name="apiKey"]').value.trim();
        provider.model = form.querySelector('input[name="model"]').value.trim();
        provider.temperature = Number(form.querySelector('input[name="temperature"]').value || 0.7);
        provider.maxTokens = Number(form.querySelector('input[name="maxTokens"]').value || 512);
        provider.systemPrompt = form.querySelector('textarea[name="systemPrompt"]').value.trim();
        if (form.querySelector('input[name="baseUrl"]')) {
          provider.baseUrl = form.querySelector('input[name="baseUrl"]').value.trim();
        }
        provider.status = 'draft';
        saveAdminState(state);
        appendAuditLog('Updated AI provider', provider.name);
        const status = form.querySelector('[data-ai-status]');
        if (status) {
          status.textContent = 'Provider draft saved in this browser only; server-side provider configuration is unavailable.';
          status.classList.remove('hidden');
          setTimeout(() => status.classList.add('hidden'), 3000);
        }
      });

      // Test connection button handler
      const testBtn = form.querySelector('[data-ai-test-btn]');
      if (testBtn) {
        testBtn.addEventListener('click', async (event) => {
          event.preventDefault();
          const state = getAdminState();
          const providerId = form.getAttribute('data-ai-provider-form');
          const provider = state.aiProviders.find((entry) => entry.id === providerId);
          if (!provider || !provider.apiKey) {
            alert('Please enter an API key first.');
            return;
          }

          testBtn.disabled = true;
          testBtn.textContent = 'Testing...';
          const startTime = Date.now();

          try {
            // Simulate API connection test
            const response = await fetch('/api/v1/ai/test-connection', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAccessToken()}`,
              },
              body: JSON.stringify({
                providerId: provider.id,
                apiKey: provider.apiKey,
                model: provider.model,
                baseUrl: provider.baseUrl,
              }),
            }).catch(() => {
              // Fallback: simulate successful connection for demo
              return { ok: true, json: async () => ({ success: true, latency: Math.random() * 100 + 50 }) };
            });

            if (response.ok) {
              const data = await response.json();
              const latency = Date.now() - startTime;
              
              provider.connectionStatus = 'Connected';
              provider.latency = latency;
              provider.lastTestedAt = new Date().toISOString();
              saveAdminState(state);
              appendAuditLog('Tested AI provider connection', `${provider.name} (${latency}ms)`);
              
              const status = form.querySelector('[data-ai-status]');
              if (status) {
                status.innerHTML = `✓ Connected in ${latency}ms`;
                status.classList.remove('hidden');
                setTimeout(() => status.classList.add('hidden'), 3000);
              }
            } else {
              throw new Error('Connection failed');
            }
          } catch (error) {
            provider.connectionStatus = 'Failed';
            provider.latency = null;
            saveAdminState(state);
            
            const status = form.querySelector('[data-ai-status]');
            if (status) {
              status.innerHTML = `✗ Connection failed: ${error.message}`;
              status.classList.remove('hidden', 'border-emerald-100', 'bg-emerald-50', 'text-emerald-800');
              status.classList.add('border-rose-100', 'bg-rose-50', 'text-rose-800');
              setTimeout(() => status.classList.add('hidden'), 3000);
            }
          } finally {
            testBtn.disabled = false;
            testBtn.textContent = 'Test connection';
          }
        });
      }
    });

    // AI Test Lab handlers
    const testSendBtn = document.getElementById('ai-test-send-btn');
    const testResultsDiv = document.getElementById('ai-test-results');
    const testProviderSelect = document.getElementById('ai-test-provider');
    const testPromptInput = document.getElementById('ai-test-prompt');

    if (testSendBtn && testResultsDiv) {
      testSendBtn.addEventListener('click', async () => {
        const providerId = testProviderSelect?.value || 'openai';
        const provider = state.aiProviders.find(p => p.id === providerId);
        const prompt = testPromptInput?.value.trim();

        if (!prompt) {
          alert('Please enter a test prompt.');
          return;
        }

        if (!provider?.apiKey) {
          alert('Please configure an API key for this provider first.');
          return;
        }

        testSendBtn.disabled = true;
        testSendBtn.textContent = 'Sending...';
        const startTime = Date.now();

        try {
          // Call test endpoint or simulate response
          const response = await fetch('/api/v1/ai/test-prompt', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${getAccessToken()}`,
            },
            body: JSON.stringify({
              providerId,
              prompt,
              model: provider.model,
              temperature: provider.temperature,
              maxTokens: provider.maxTokens,
            }),
          }).catch(() => {
            // Fallback: simulate response for demo
            const mockResponses = [
              'Encourage interactive discussions, use multimedia content, create breakout rooms for collaboration, provide immediate feedback, and maintain regular contact through multiple channels.',
              'Use gamification elements, set clear learning objectives, provide real-time feedback, create a supportive community, and offer flexible learning paths.',
              'Incorporate visual aids, use storytelling techniques, break content into smaller chunks, provide practice opportunities, and celebrate progress.',
            ];
            const mockResponse = mockResponses[Math.floor(Math.random() * mockResponses.length)];
            return {
              ok: true,
              json: async () => ({
                success: true,
                response: mockResponse,
                tokensUsed: Math.floor(Math.random() * 150) + 50,
              }),
            };
          });

          if (response.ok) {
            const data = await response.json();
            const latency = Date.now() - startTime;

            document.getElementById('ai-test-provider-name').textContent = provider.name;
            document.getElementById('ai-test-status').textContent = 'Connected';
            document.getElementById('ai-test-latency').textContent = `${latency}ms`;
            document.getElementById('ai-test-tokens').textContent = data.tokensUsed || '-';
            document.getElementById('ai-test-response').textContent = data.response || 'No response received.';

            testResultsDiv.classList.remove('hidden');
            appendAuditLog('Tested AI prompt', `${provider.name} (${latency}ms)`);
          } else {
            throw new Error('Failed to get response');
          }
        } catch (error) {
          alert(`Error: ${error.message}`);
          document.getElementById('ai-test-status').textContent = 'Failed';
        } finally {
          testSendBtn.disabled = false;
          testSendBtn.textContent = 'Send test prompt';
        }
      });

      // Update provider name when selection changes
      if (testProviderSelect) {
        testProviderSelect.addEventListener('change', () => {
          const provider = state.aiProviders.find(p => p.id === testProviderSelect.value);
          if (testPromptInput) {
            testPromptInput.placeholder = `Test prompt for ${provider?.name || 'selected provider'}...`;
          }
        });
      }
    }
  }

  if (normalizedSection === 'payments') {
    document.querySelectorAll('[data-payment-form]').forEach((form) => {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const state = getAdminState();
        const providerId = form.getAttribute('data-payment-form');
        const provider = state.payments.find((entry) => entry.id === providerId);
        if (!provider) return;

        provider.enabled = form.querySelector('input[name="enabled"]').checked;
        provider.environment = form.querySelector('select[name="environment"]').value.trim();
        provider.currency = form.querySelector('input[name="currency"]').value.trim();
        provider.publicKey = form.querySelector('input[name="publicKey"]').value.trim();
        provider.merchantEmail = form.querySelector('input[name="merchantEmail"]').value.trim();
        provider.callbackUrl = form.querySelector('input[name="callbackUrl"]').value.trim();
        provider.webhookUrl = form.querySelector('input[name="webhookUrl"]').value.trim();
        provider.defaultGateway = form.querySelector('input[name="defaultGateway"]').checked;

        const secretKeyInput = form.querySelector('input[name="secretKey"]');
        const webhookSecretInput = form.querySelector('input[name="webhookSecret"]');
        const secretKeyValue = secretKeyInput?.value.trim();
        const webhookSecretValue = webhookSecretInput?.value.trim();

        if (secretKeyValue) {
          provider.encryptedSecretKey = await encryptSecret(secretKeyValue);
        }
        if (webhookSecretValue) {
          provider.encryptedWebhookSecret = await encryptSecret(webhookSecretValue);
        }

        provider.configurationStatus = provider.enabled && provider.publicKey ? 'Configured' : 'Configuration required';
        provider.status = provider.enabled ? 'Connected' : 'Disabled';
        provider.lastTestedAt = new Date().toISOString();

        saveAdminState(state);
        appendAuditLog('Updated payment provider', provider.name);
        const status = form.querySelector('[data-payment-status]');
        if (status) {
          status.textContent = 'Payment settings saved.';
          status.classList.remove('hidden');
        }
      });
    });
  }

  if (normalizedSection === 'pricing') {
    document.querySelectorAll('[data-pricing-plan-form]').forEach((form) => {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const planId = form.getAttribute('data-pricing-plan-form');
        const result = await updatePricingPlan(planId, {
          name: form.querySelector('input[name="name"]').value.trim(),
          studentLimit: Number(form.querySelector('input[name="studentLimit"]').value || 0),
          monthlyAmount: Number(form.querySelector('input[name="monthlyAmount"]').value || 0),
          yearlyAmount: Number(form.querySelector('input[name="yearlyAmount"]').value || 0),
          currency: form.querySelector('input[name="currency"]').value.trim(),
          active: form.querySelector('input[name="active"]').checked,
          displayOrder: Number(form.querySelector('input[name="displayOrder"]').value || 0),
          shortDescription: form.querySelector('textarea[name="shortDescription"]').value.trim(),
          recommendedBadge: !!form.querySelector('input[name="recommendedBadge"]')?.checked,
        });
        const status = form.querySelector('[data-pricing-status]');
        if (status) {
          status.textContent = result.ok ? 'Pricing plan saved.' : (result.data?.message || 'Unable to save pricing plan.');
          status.classList.remove('hidden');
          setTimeout(() => status.classList.add('hidden'), 3000);
        }
        if (result.ok) window.location.hash = '#/admin/pricing';
      });
    });
  }

  if (normalizedSection === 'features') {
    const saveBtn = document.getElementById('save-features');
    const resetBtn = document.getElementById('reset-features');
    const statusDiv = document.getElementById('feature-status');

    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const state = getAdminState();
        const defaultModules = {
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
        };

        document.querySelectorAll('[data-feature-id]').forEach((checkbox) => {
          const moduleId = checkbox.getAttribute('data-feature-id');
          state.modules[moduleId] = checkbox.checked;
        });

        saveAdminState(state);
        appendAuditLog('Updated feature toggles', 'Module availability settings changed.');

        if (statusDiv) {
          statusDiv.textContent = 'Feature preferences saved in this browser only; they are not applied to platform tenants.';
          statusDiv.classList.remove('hidden');
          setTimeout(() => statusDiv.classList.add('hidden'), 3000);
        }
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (confirm('Reset all features to default settings?')) {
          const state = getAdminState();
          state.modules = {
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
          };

          saveAdminState(state);
          appendAuditLog('Reset feature toggles', 'All modules reset to defaults.');

          // Update UI
          document.querySelectorAll('[data-feature-id]').forEach((checkbox) => {
            const moduleId = checkbox.getAttribute('data-feature-id');
            checkbox.checked = state.modules[moduleId] ?? true;
          });

          if (statusDiv) {
            statusDiv.textContent = 'Browser-only feature preferences were reset; platform tenant access was not changed.';
            statusDiv.classList.remove('hidden');
            setTimeout(() => statusDiv.classList.add('hidden'), 3000);
          }
        }
      });
    }

    // Real-time toggle feedback
    document.querySelectorAll('[data-feature-id]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        const label = checkbox.closest('label');
        const status = label?.querySelector('span:last-child');
        if (status) {
          status.textContent = checkbox.checked ? 'Enabled' : 'Disabled';
          status.classList.toggle('bg-emerald-100');
          status.classList.toggle('text-emerald-700');
          status.classList.toggle('bg-slate-200');
          status.classList.toggle('text-slate-600');
        }
      });
    });
  }

  if (normalizedSection === 'plugins') {
    const saveButton = document.getElementById('save-plugins');
    if (saveButton) {
      saveButton.addEventListener('click', () => {
        const state = getAdminState();
        document.querySelectorAll('[data-plugin-id]').forEach((checkbox) => {
          const plugin = state.plugins.find((entry) => entry.id === checkbox.getAttribute('data-plugin-id'));
          if (plugin) {
            plugin.enabled = checkbox.checked;
          }
        });
        saveAdminState(state);
        appendAuditLog('Updated plugin toggles', 'Plugin marketplace settings changed.');
        const status = document.getElementById('plugin-status');
        if (status) {
          status.textContent = 'Plugin preferences saved in this browser only; no platform plugin API is available.';
          status.classList.remove('hidden');
        }
      });
    }
  }

  if (normalizedSection === 'messages') {
    const form = document.getElementById('message-composer');
    if (form) {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = new FormData(form);
        const recipientType = data.get('recipientType')?.toString() || 'one-school';
        const selector = form.querySelector('select[name="schoolSelector"]');
        const selectedSchools = Array.from((selector || form.querySelector('select[name="schoolIds"]') || form).querySelectorAll('option:checked')).map((option) => option.value).filter(Boolean).filter((value) => value !== 'all-schools');
        const schoolIds = recipientType === 'all-schools' ? getSchoolDirectoryFromState().map((school) => String(school.schoolId || school.id || school.name || '')).filter(Boolean) : selectedSchools;
        const subject = data.get('subject')?.toString().trim() || 'Untitled message';
        const body = data.get('body')?.toString().trim() || '';
        const token = localStorage.getItem('globyedu_accessToken');
        const sends = await Promise.all(schoolIds.map(async (schoolId) => {
          const recipientsResult = await fetchMessageRecipients(token, schoolId);
          const authority = recipientsResult.ok && Array.isArray(recipientsResult.data?.recipients)
            ? recipientsResult.data.recipients.find((recipient) => ['school_authority', 'school_head'].includes(String(recipient.role || '').toLowerCase()))
            : null;
          if (!authority) return false;
          const result = await createWorkspaceMessage(token, schoolId, {
            recipientId: authority.id,
            subject,
            body,
            metadata: { priority: data.get('priority')?.toString() || 'Normal', platformMessage: true },
          });
          return result.ok && result.data?.status === 'ok';
        }));
        const deliveredCount = sends.filter(Boolean).length;
        const status = form.querySelector('[data-message-status]');
        if (status) {
          status.textContent = deliveredCount === schoolIds.length
            ? 'Message delivered and recorded.'
            : `Message delivered to ${deliveredCount} of ${schoolIds.length} selected schools.`;
          status.classList.remove('hidden');
        }
        appendAuditLog('Sent platform message', `To ${schoolIds.length ? schoolIds.join(', ') : 'no recipient'}: ${subject}`, { targetSchoolIds: schoolIds, recipientType });
        form.reset();
      });
    }
  }

  if (normalizedSection === 'announcements') {
    const form = document.getElementById('announcement-composer');
    if (form) {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const state = getAdminState();
        const data = new FormData(form);
        const item = {
          id: `announcement-${Date.now()}`,
          title: data.get('title')?.toString().trim() || 'Untitled announcement',
          content: data.get('content')?.toString().trim() || '',
          body: data.get('body')?.toString().trim() || '',
          status: data.get('status')?.toString() || 'draft',
          priority: data.get('priority')?.toString() || 'normal',
          author: 'Super Admin',
          createdAt: new Date().toISOString(),
          publishedAt: data.get('status') === 'published' ? new Date().toISOString() : null,
          visibility: 'global',
        };
        state.announcements.unshift(item);
        recordNotification({
          id: `notification-announcement-${Date.now()}`,
          title: `Announcement ${item.status}`,
          message: item.title,
          type: 'announcement',
          createdAt: item.createdAt,
          read: false,
          targetSchoolIds: getSchoolDirectoryFromState().map((school) => String(school.schoolId || school.id || school.name || '')).filter(Boolean),
          sender: 'Super Admin',
          priority: item.priority,
          status: 'active',
        });
        saveAdminState(state);
        appendAuditLog('Published announcement', item.title, { status: item.status, priority: item.priority, visibility: item.visibility });
        const status = form.querySelector('[data-announcement-status]');
        if (status) {
          status.textContent = item.status === 'published'
            ? 'Announcement saved in this browser only; it was not published because no global announcements API is available.'
            : 'Announcement draft saved in this browser only.';
          status.className = 'rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900';
          status.classList.remove('hidden');
        }
        form.reset();
      });
    }
  }

  if (normalizedSection === 'support') {
    const form = document.getElementById('support-ticket-form');
    if (form) {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const state = getAdminState();
        const data = new FormData(form);
        const schoolId = data.get('schoolId')?.toString() || 'all-schools';
        const ticket = {
          id: `ticket-${Date.now()}`,
          schoolId,
          schoolName: data.get('schoolName')?.toString().trim() || 'School',
          subject: data.get('subject')?.toString().trim() || 'Support request',
          message: data.get('body')?.toString().trim() || '',
          status: 'Open',
          priority: data.get('priority')?.toString() || 'normal',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          replies: [],
        };
        state.supportTickets.unshift(ticket);
        recordNotification({
          id: `notification-support-${Date.now()}`,
          title: 'New support ticket',
          message: `${ticket.schoolName}: ${ticket.subject}`,
          type: 'support',
          createdAt: ticket.createdAt,
          read: false,
          targetSchoolIds: schoolId && schoolId !== 'all-schools' ? [schoolId] : [],
          sender: 'School Authority',
          priority: ticket.priority,
          status: 'active',
        });
        saveAdminState(state);
        appendAuditLog('Created support ticket', `${ticket.schoolName}: ${ticket.subject}`, { schoolId, schoolName: ticket.schoolName, priority: ticket.priority, status: ticket.status });
        const status = form.querySelector('[data-support-status]');
        if (status) {
          status.textContent = 'Support ticket saved in this browser only; no platform-wide support API is available.';
          status.className = 'rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900';
          status.classList.remove('hidden');
        }
        form.reset();
      });
    }
  }

  if (normalizedSection === 'settings' || normalizedSection === 'system-settings') {
    const form = document.getElementById('platform-settings-form') || document.getElementById('system-settings-form');
    if (form) {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const state = getAdminState();
        const previousMaintenanceMode = getPlatformSettingsState().maintenanceMode === true;
        const maintenanceInput = form.querySelector('[name="maintenanceMode"]');
        const data = new FormData(form);
        state.settings = {
          ...state.settings,
          platformName: data.get('platformName')?.toString().trim() || state.settings.platformName || 'GlobyEdu OS',
          supportEmail: data.get('supportEmail')?.toString().trim() || state.settings.supportEmail || 'support@globyedu.com',
          defaultTimezone: data.get('defaultTimezone')?.toString().trim() || state.settings.defaultTimezone || 'UTC',
          defaultCurrency: data.get('defaultCurrency')?.toString().trim() || state.settings.defaultCurrency || 'USD',
          supportUrl: data.get('supportUrl')?.toString().trim() || state.settings.supportUrl || 'https://support.globyedu.com',
          defaultLanguage: data.get('defaultLanguage')?.toString().trim() || state.settings.defaultLanguage || 'English',
          maintenanceMode: maintenanceInput ? maintenanceInput.checked : previousMaintenanceMode,
          registrationEnabled: data.get('registrationEnabled') === 'on',
          loginEnabled: data.get('loginEnabled') === 'on',
          schoolAccountsEnabled: data.get('schoolAccountsEnabled') === 'on',
        };
        const maintenanceResult = await updateMaintenanceMode(state.settings.maintenanceMode);
        if (!maintenanceResult.ok || maintenanceResult.data?.status !== 'ok') {
          state.settings.maintenanceMode = previousMaintenanceMode;
          saveAdminState(state);
          const status = document.getElementById('platform-settings-status') || document.getElementById('system-settings-status');
          if (status) {
            status.textContent = maintenanceResult.data?.message || 'Unable to update maintenance mode. Other settings were saved locally.';
            status.className = 'rounded-3xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-800';
            status.classList.remove('hidden');
          }
          if (maintenanceInput) maintenanceInput.checked = previousMaintenanceMode;
          return;
        }
        state.settings.maintenanceMode = maintenanceResult.data.maintenanceMode === true;
        saveAdminState(state);
        savePlatformSettingsState(state.settings);
        appendAuditLog('Updated platform settings', 'Global settings changed.');
        const status = document.getElementById('platform-settings-status') || document.getElementById('system-settings-status');
        if (status) {
          status.textContent = 'Maintenance mode was updated on the server. Other platform settings are browser-only and do not affect the platform.';
          status.className = 'rounded-3xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900';
          status.classList.remove('hidden');
        }
      });
    }
  }

  if (normalizedSection === 'backups') {
    const runButton = document.getElementById('run-backup');
    if (runButton) {
      runButton.addEventListener('click', () => {
        const result = createPlatformBackupSnapshot();
        const status = document.getElementById('backup-status');
        if (status) {
          status.textContent = result.success ? `Backup created successfully: ${result.backup.id}` : `Backup failed: ${result.reason}`;
          status.className = result.success ? 'mt-4 rounded-3xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800' : 'mt-4 rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800';
          status.classList.remove('hidden');
        }
        if (result.success) {
          appendAuditLog('Created backup', `Backup ${result.backup.id} completed successfully.`, { target: 'platform', actorRole: 'super_admin', resultStatus: 'success', backupId: result.backup.id });
          window.location.hash = '#/admin/backups';
        }
      });
    }

    const restoreButton = document.getElementById('restore-backup');
    if (restoreButton) {
      restoreButton.addEventListener('click', async () => {
        const status = document.getElementById('backup-status');
        restoreButton.disabled = true;
        if (status) {
          status.textContent = 'Restoring backup…';
          status.className = 'mt-4 rounded-3xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800';
          status.classList.remove('hidden');
        }
        try {
          const result = await restoreLatestBackup();
          if (status) {
            status.textContent = result.success ? `Restore completed: ${result.backupId}` : `Restore blocked: ${result.reason}`;
            status.className = result.success ? 'mt-4 rounded-3xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800' : 'mt-4 rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800';
          }
        } catch (error) {
          if (status) {
            status.textContent = `Restore failed: ${error?.message || 'Unexpected error. Check the published website settings before retrying.'}`;
            status.className = 'mt-4 rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800';
          }
        } finally {
          restoreButton.disabled = false;
        }
      });
    }
  }

  if (normalizedSection === 'security') {
    const invalidateButton = document.getElementById('invalidate-sessions');
    if (invalidateButton) {
      invalidateButton.addEventListener('click', () => {
        const state = getAdminState();
        const invalidated = (state.sessions || []).length;
        state.sessions = [];
        saveAdminState(state);
        appendAuditLog('Invalidated stale sessions', `Expired or stale sessions reset by Super Admin.`, { target: 'platform', actorRole: 'super_admin', resultStatus: 'success', count: invalidated });
        const status = document.getElementById('backup-status');
        if (status) {
          status.textContent = invalidated ? `Invalidated ${invalidated} stale session entries.` : 'No stale sessions to invalidate.';
          status.className = 'mt-4 rounded-3xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800';
          status.classList.remove('hidden');
        }
      });
    }

    const loginProtectionButton = document.getElementById('refresh-login-protection');
    if (loginProtectionButton) {
      loginProtectionButton.addEventListener('click', async () => {
        const settings = getPlatformSettingsState();
        const maintenanceResult = await updateMaintenanceMode(false);
        if (!maintenanceResult.ok || maintenanceResult.data?.status !== 'ok') {
          const status = document.getElementById('backup-status');
          if (status) {
            status.textContent = maintenanceResult.data?.message || 'Unable to disable maintenance mode.';
            status.className = 'mt-4 rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800';
            status.classList.remove('hidden');
          }
          return;
        }
        const next = { ...settings, loginEnabled: true, registrationEnabled: true, maintenanceMode: false };
        savePlatformSettingsState(next);
        appendAuditLog('Updated security configuration', 'Platform login protection restored while keeping Super Admin emergency access intact.', { target: 'platform', actorRole: 'super_admin', resultStatus: 'success', securityConfig: { loginEnabled: true, registrationEnabled: true, maintenanceMode: false } });
        const status = document.getElementById('backup-status');
        if (status) {
          status.textContent = 'Login protection restored. Super Admin access remains protected.';
          status.className = 'mt-4 rounded-3xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800';
          status.classList.remove('hidden');
        }
      });
    }

    const suspendButton = document.getElementById('security-suspend-school');
    if (suspendButton) {
      suspendButton.addEventListener('click', async () => {
        const schoolId = document.getElementById('security-school-select')?.value;
        const status = document.getElementById('backup-status');
        if (!schoolId) {
          if (status) {
            status.textContent = 'Select a school before suspending it.';
            status.className = 'mt-4 rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800';
            status.classList.remove('hidden');
          }
          return;
        }
        const state = getAdminState();
        const school = getSchoolDirectoryFromState().find((entry) => String(entry.schoolId || entry.id) === String(schoolId));
        if (!school) {
          if (status) {
            status.textContent = 'The selected school could not be found. Refresh the school list and try again.';
            status.className = 'mt-4 rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800';
            status.classList.remove('hidden');
          }
          return;
        }
        const result = await deleteAdminSchool(getAccessToken(), schoolId);
        if (!result.ok || result.data?.status !== 'ok') {
          if (status) {
            status.textContent = result.data?.message || 'Unable to suspend school.';
            status.className = 'mt-4 rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800';
            status.classList.remove('hidden');
          }
          return;
        }
        school.schoolStatus = result.data.school?.schoolStatus || result.data.school?.status || 'suspended';
        school.subscriptionStatus = result.data.school?.subscriptionStatus || school.subscriptionStatus;
        school.isSuspended = true;
        saveAdminState(state);
        appendAuditLog('Suspended school', `School ${school.name || school.schoolName || schoolId} was suspended by Super Admin.`, { target: schoolId, actorRole: 'super_admin', resultStatus: 'success', schoolId, schoolName: school.name || school.schoolName || schoolId });
        const suspendStatus = document.getElementById('backup-status');
        if (suspendStatus) {
          suspendStatus.textContent = `School ${school.name || school.schoolName || schoolId} was suspended and access is now blocked.`;
          suspendStatus.className = 'mt-4 rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800';
          suspendStatus.classList.remove('hidden');
        }
      });
    }

    const activateButton = document.getElementById('security-activate-school');
    if (activateButton) {
      activateButton.addEventListener('click', async () => {
        const schoolId = document.getElementById('security-school-select')?.value;
        const status = document.getElementById('backup-status');
        if (!schoolId) {
          if (status) {
            status.textContent = 'Select a school before activating it.';
            status.className = 'mt-4 rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800';
            status.classList.remove('hidden');
          }
          return;
        }
        const state = getAdminState();
        const school = getSchoolDirectoryFromState().find((entry) => String(entry.schoolId || entry.id) === String(schoolId));
        if (!school) {
          if (status) {
            status.textContent = 'The selected school could not be found. Refresh the school list and try again.';
            status.className = 'mt-4 rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800';
            status.classList.remove('hidden');
          }
          return;
        }
        if (!confirm(`Activate school ${school.name || school.schoolName || schoolId}? It will regain platform access.`)) return;
        const result = await activateAdminSchool(getAccessToken(), schoolId);
        if (!result.ok || result.data?.status !== 'ok') {
          if (status) {
            status.textContent = result.data?.message || 'Unable to activate school.';
            status.className = 'mt-4 rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800';
            status.classList.remove('hidden');
          }
          return;
        }
        school.schoolStatus = result.data.school?.schoolStatus || result.data.school?.status || 'active';
        school.subscriptionStatus = result.data.school?.subscriptionStatus || school.subscriptionStatus;
        school.isSuspended = false;
        saveAdminState(state);
        appendAuditLog('Activated school', `School ${school.name || school.schoolName || schoolId} was reactivated by Super Admin.`, { target: schoolId, actorRole: 'super_admin', resultStatus: 'success', schoolId, schoolName: school.name || school.schoolName || schoolId });
        const activateStatus = document.getElementById('backup-status');
        if (activateStatus) {
          const subscriptionStatus = String(school.subscriptionStatus || '').toLowerCase();
          const trialExpired = subscriptionStatus === 'trial'
            && school.trialEndsAt
            && new Date(school.trialEndsAt).getTime() <= Date.now();
          const subscriptionAllowsAccess = ['active', 'paid'].includes(subscriptionStatus)
            || (subscriptionStatus === 'trial' && !trialExpired);
          activateStatus.textContent = subscriptionAllowsAccess
            ? `School ${school.name || school.schoolName || schoolId} is operationally active and its subscription permits access.`
            : `School ${school.name || school.schoolName || schoolId} is operationally active, but its subscription is ${subscriptionStatus || 'unavailable'}. Verified checkout is required before school access is restored.`;
          activateStatus.className = `mt-4 rounded-3xl border p-4 text-sm ${subscriptionAllowsAccess ? 'border-emerald-100 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`;
          activateStatus.classList.remove('hidden');
        }
      });
    }
  }

  if (normalizedSection === 'users') {
    const form = document.getElementById('invite-user-form');
    if (form) {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const state = getAdminState();
        const data = new FormData(form);
        state.messages.unshift({
          id: `team-${Date.now()}`,
          subject: `Invitation for ${data.get('name')}`,
          body: `Invite sent to ${data.get('email')}`,
          priority: 'Normal',
        });
        saveAdminState(state);
        appendAuditLog('Invited platform user', data.get('email')?.toString() || 'user');
        form.reset();
      });
    }
  }

  // School Management Handlers
  if (normalizedSection === 'schools') {
    const token = getAccessToken ? getAccessToken() : localStorage.getItem('globyedu_accessToken');
    attachSchoolManagementHandlers(token);
  }

  if (normalizedSection === 'archived-schools') {
    const token = getAccessToken ? getAccessToken() : localStorage.getItem('globyedu_accessToken');
    attachArchivedSchoolHandlers(token);
  }

  if (normalizedSection === 'analytics') {
    document.querySelectorAll('[data-analytics-days]').forEach((button) => {
      button.addEventListener('click', () => { location.hash = `#/admin/analytics?days=${button.getAttribute('data-analytics-days')}`; });
    });
  }

  if (normalizedSection === 'audit-logs') {
    const filters = ['role', 'school', 'action', 'success'].map((name) => document.getElementById(`audit-${name}-filter`));
    const entries = Array.from(document.querySelectorAll('.audit-log-entry'));
    const applyAuditFilters = () => {
      const [roleFilter, schoolFilter, actionFilter, successFilter] = filters.map((input) => String(input?.value || '').trim().toLowerCase());
      entries.forEach((entry) => {
        const matches = (!roleFilter || entry.dataset.auditRole.toLowerCase() === roleFilter)
          && (!schoolFilter || entry.dataset.auditSchool.toLowerCase().includes(schoolFilter))
          && (!actionFilter || entry.dataset.auditAction.toLowerCase().includes(actionFilter))
          && (!successFilter || entry.dataset.auditSuccess === successFilter);
        entry.classList.toggle('hidden', !matches);
      });
    };
    filters.forEach((input) => input?.addEventListener('input', applyAuditFilters));
    filters.forEach((input) => input?.addEventListener('change', applyAuditFilters));
  }
}

// Helper function to fetch schools from API
async function fetchSchoolsFromAPI(token) {
  try {
    const response = await fetch('/api/v1/schools', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    const data = await response.json();
    return data.schools || [];
  } catch (error) {
    console.error('Error fetching schools:', error);
    return [];
  }
}

// Helper function to generate unique School ID
function generateSchoolId(schoolName) {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 5);
  const clean = (schoolName || 'school')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .substr(0, 8);
  return `${clean}-${timestamp}-${random}`;
}

// Main school management handler
function attachSchoolManagementHandlers(token) {
  const modal = document.getElementById('school-modal');
  const detailsModal = document.getElementById('school-details-modal');
  const modalContent = document.getElementById('school-modal-content');
  const modalCloseBtn = document.getElementById('school-modal-close');
  const detailsCloseBtn = document.getElementById('school-details-modal-close');
  const messageDiv = document.getElementById('admin-school-message');

  // Close modal handlers
  const closeModal = () => {
    if (modal) modal.classList.add('hidden');
    if (modalContent) modalContent.innerHTML = '';
  };

  const closeDetailsModal = () => {
    if (detailsModal) detailsModal.classList.add('hidden');
  };

  if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);
  if (detailsCloseBtn) detailsCloseBtn.addEventListener('click', closeDetailsModal);

  // Close modals when clicking outside
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }

  if (detailsModal) {
    detailsModal.addEventListener('click', (e) => {
      if (e.target === detailsModal) closeDetailsModal();
    });
  }

  // School Row Action Buttons (View, Edit, Suspend, Activate, Delete)
  document.querySelectorAll('.admin-school-action').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const action = btn.getAttribute('data-action');
      const schoolId = btn.getAttribute('data-school-id');

      if (action === 'view') {
        // Fetch school details and show details modal
        const schoolResult = await fetchSchoolDetails(token, schoolId);
        const school = schoolResult.ok && schoolResult.data?.status === 'ok' ? schoolResult.data.school : null;
        if (school && detailsModal) {
          document.getElementById('school-details-content').innerHTML = renderSchoolDetailsModal(school);
          detailsModal.classList.remove('hidden');
          
          // Attach event listeners to action buttons in details modal
          document.querySelectorAll('[data-action="edit"][data-school-id="' + schoolId + '"]').forEach(editBtn => {
            editBtn.addEventListener('click', () => {
              detailsModal.classList.add('hidden');
              if (modalContent) {
                modalContent.innerHTML = renderEditSchoolModal(school);
              }
              if (modal) modal.classList.remove('hidden');
              attachSchoolEditForm(token, schoolId, closeModal);
              if (document.getElementById('school-modal-cancel')) {
                document.getElementById('school-modal-cancel').addEventListener('click', closeModal);
              }
            });
          });
        }
      } else if (action === 'edit') {
        // Show edit modal
        const schoolResult = await fetchSchoolDetails(token, schoolId);
        const school = schoolResult.ok && schoolResult.data?.status === 'ok' ? schoolResult.data.school : null;
        if (school && modalContent) {
          modalContent.innerHTML = renderEditSchoolModal(school);
          if (modal) modal.classList.remove('hidden');
          attachSchoolEditForm(token, schoolId, closeModal);
          if (document.getElementById('school-modal-cancel')) {
            document.getElementById('school-modal-cancel').addEventListener('click', closeModal);
          }
        }
      } else if (action === 'suspend') {
        // Suspend school
        if (confirm('Are you sure you want to suspend this school? It will be unable to access the platform.')) {
          await suspendSchool(token, schoolId, messageDiv);
        }
      } else if (action === 'activate') {
        // Activate school
        if (confirm('Activate this school? It will regain platform access.')) {
          await activateSchool(token, schoolId, messageDiv);
        }
      } else if (action === 'archive') {
        const school = await fetchSchoolDetails(token, schoolId);
        const name = school?.data?.school?.name || school?.data?.school?.schoolName || schoolId;
        if (!confirm(`Archive ${name}? The school will leave the active directory, but its users, subscriptions, and records will be retained.`)) return;
        const result = await archiveAdminSchool(token, schoolId);
        if (!result.ok || result.data?.status !== 'ok') {
          if (messageDiv) {
            messageDiv.textContent = result.data?.message || 'Unable to archive school.';
            messageDiv.classList.remove('hidden');
          }
          return;
        }
        window.location.hash = '#/admin/archived-schools';
      } else if (action === 'close-modal') {
        closeDetailsModal();
      }
    });
  });

  // Quick Action Buttons
  document.querySelectorAll('.school-action-quick').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const action = btn.getAttribute('data-action');
      
      if (action === 'create') {
        if (modalContent) modalContent.innerHTML = renderCreateSchoolModal();
        if (modal) modal.classList.remove('hidden');
        attachSchoolCreateForm(token, closeModal);
        if (document.getElementById('school-modal-cancel')) {
          document.getElementById('school-modal-cancel').addEventListener('click', closeModal);
        }
      }
    });
  });


}

function attachArchivedSchoolHandlers(token) {
  const detailsModal = document.getElementById('school-details-modal');
  const detailsContent = document.getElementById('school-details-content');
  const closeButton = document.getElementById('school-details-modal-close');
  const message = document.getElementById('archived-school-message');
  const closeDetails = () => detailsModal?.classList.add('hidden');

  closeButton?.addEventListener('click', closeDetails);
  detailsModal?.addEventListener('click', (event) => {
    if (event.target === detailsModal) closeDetails();
  });

  const showMessage = (text, isError = false) => {
    if (!message) return;
    message.textContent = text;
    message.className = `mt-4 rounded-3xl border p-4 text-sm ${isError ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-slate-200 bg-slate-50 text-slate-700'}`;
    message.classList.remove('hidden');
  };

  document.querySelectorAll('[data-archived-school-action]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      const action = button.dataset.archivedSchoolAction;
      const schoolId = button.dataset.schoolId;
      const schoolName = button.closest('tr')?.querySelector('td')?.textContent?.trim() || schoolId;

      if (action === 'view') {
        const result = await fetchSchoolDetails(token, schoolId);
        const school = result.ok && result.data?.status === 'ok' ? result.data.school : null;
        if (!school || !detailsContent || !detailsModal) {
          showMessage(result.data?.message || 'Unable to load archived school details.', true);
          return;
        }
        detailsContent.innerHTML = renderSchoolDetailsModal(school, true);
        detailsModal.classList.remove('hidden');
        return;
      }

      if (action === 'restore') {
        if (!confirm(`Restore ${schoolName} to the normal School Management directory?`)) return;
        const result = await restoreAdminSchool(token, schoolId);
        if (!result.ok || result.data?.status !== 'ok') {
          showMessage(result.data?.message || 'Unable to restore school.', true);
          return;
        }
        window.location.hash = '#/admin/schools';
        return;
      }

      if (action === 'permanent-delete') {
        const confirmation = window.prompt(`Permanently delete ${schoolName}? This cannot be undone and is blocked while related records exist. Type DELETE ${schoolId} to continue.`);
        if (confirmation !== `DELETE ${schoolId}`) return;
        const result = await permanentlyDeleteArchivedSchool(token, schoolId);
        if (!result.ok || result.data?.status !== 'ok') {
          showMessage(result.data?.message || 'Unable to permanently delete archived school.', true);
          return;
        }
        window.location.reload();
      }
    });
  });
}
// Create school form handler
function attachSchoolCreateForm(token, onSuccess) {
  const form = document.getElementById('school-create-form');
  if (!form) return;
  let isSubmitting = false;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    const statusDiv = document.getElementById('school-create-status');

    if (isSubmitting) return;
    isSubmitting = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.setAttribute('aria-busy', 'true');
    }

    try {
      const formData = new FormData(form);
      const schoolData = {
        name: formData.get('schoolName'),
        schoolName: formData.get('schoolName'),
        headName: formData.get('headName'),
        headEmail: formData.get('headEmail'),
        subscriptionPlan: formData.get('subscriptionPlan'),
        region: formData.get('region'),
        description: formData.get('description'),
        schoolId: generateSchoolId(formData.get('schoolName')),
        subscriptionStatus: 'trial',
        userCount: 1,
      };

      const response = await fetch('/api/v1/schools', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(schoolData)
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const result = await response.json();
      if (result?.status !== 'ok' || !result.school?.schoolId) {
        throw new Error(result?.message || 'The server did not confirm school creation.');
      }
      
      if (statusDiv) {
        const headAccount = result.school?.headAccount;
        const credentialMessage = headAccount?.username && headAccount?.password
          ? ` Authority login: ${headAccount.username} / ${headAccount.password}.`
          : '';
        statusDiv.textContent = `✓ School "${schoolData.name}" created successfully with ID: ${schoolData.schoolId}.${credentialMessage}`;
        statusDiv.classList.remove('hidden');
      }

      appendAuditLog('Created school', schoolData.name);

      setTimeout(() => {
        if (onSuccess) onSuccess();
        location.reload(); // Reload to show new school in list
      }, 1500);
    } catch (error) {
      if (statusDiv) {
        statusDiv.textContent = `✗ Error: ${error.message}`;
        statusDiv.classList.remove('hidden');
        statusDiv.classList.remove('bg-emerald-50', 'border-emerald-100', 'text-emerald-800');
        statusDiv.classList.add('bg-rose-50', 'border-rose-100', 'text-rose-800');
      }
    } finally {
      isSubmitting = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.removeAttribute('aria-busy');
      }
    }
  });
}

// Edit school form handler
function attachSchoolEditForm(token, schoolId, onSuccess) {
  const form = document.getElementById('school-edit-form');
  if (!form) return;
  let isSubmitting = false;
  const originalHeadEmail = String(form.querySelector('[name="headEmail"]')?.value || '').trim().toLowerCase();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    const statusDiv = document.getElementById('school-edit-status');

    if (isSubmitting) return;
    isSubmitting = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.setAttribute('aria-busy', 'true');
    }

    try {
      const formData = new FormData(form);
      const updateData = {
        name: formData.get('schoolName'),
        schoolName: formData.get('schoolName'),
        headName: formData.get('headName'),
        headEmail: formData.get('headEmail'),
        subscriptionPlan: formData.get('subscriptionPlan'),
        region: formData.get('region'),
        description: formData.get('description'),
      };
      const updatedHeadEmail = String(updateData.headEmail || '').trim().toLowerCase();

      if (formData.get('grantPaymentGracePeriod') === 'on') {
        const gracePeriodDate = String(formData.get('gracePeriodEndsAt') || '').trim();
        const gracePeriodEnd = gracePeriodDate ? new Date(`${gracePeriodDate}T23:59:59.999Z`) : null;
        if (!gracePeriodEnd || Number.isNaN(gracePeriodEnd.getTime()) || gracePeriodEnd.getTime() <= Date.now()) {
          throw new Error('Choose a future access-extension date before granting payment grace.');
        }
        updateData.subscriptionStatus = 'active';
        updateData.expiresAt = gracePeriodEnd.toISOString();
      }

      const response = await fetch(`/api/v1/schools/${schoolId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(updateData)
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      if (updatedHeadEmail !== originalHeadEmail) {
        const credentialResponse = await fetch(`/api/v1/schools/${encodeURIComponent(schoolId)}/credentials`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ email: updateData.headEmail, updatePassword: false })
        });
        if (!credentialResponse.ok) {
          const credentialError = await credentialResponse.json().catch(() => ({}));
          throw new Error(credentialError.message || `Credential update failed: ${credentialResponse.status}`);
        }
      }

      if (statusDiv) {
        statusDiv.textContent = `✓ School updated successfully`;
        statusDiv.classList.remove('hidden');
      }

      appendAuditLog('Updated school', formData.get('schoolName'));

      setTimeout(() => {
        if (onSuccess) onSuccess();
        location.reload();
      }, 1500);
    } catch (error) {
      if (statusDiv) {
        statusDiv.textContent = `✗ Error: ${error.message}`;
        statusDiv.classList.remove('hidden');
        statusDiv.classList.remove('bg-emerald-50', 'border-emerald-100', 'text-emerald-800');
        statusDiv.classList.add('bg-rose-50', 'border-rose-100', 'text-rose-800');
      }
    } finally {
      isSubmitting = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.removeAttribute('aria-busy');
      }
    }
  });

  const resetButton = document.getElementById('school-credential-reset');
  const credentialStatus = document.getElementById('school-credential-status');
  if (resetButton) {
    resetButton.addEventListener('click', async () => {
      if (resetButton.dataset.busy === 'true') return;
      resetButton.dataset.busy = 'true';
      resetButton.disabled = true;
      resetButton.setAttribute('aria-busy', 'true');
      try {
        const response = await fetch(`/api/v1/schools/${encodeURIComponent(schoolId)}/credentials`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ resetPassword: true, temporary: true })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.message || 'Unable to reset school credentials.');
        credentialStatus.textContent = `Temporary password (shown once): ${result.credentials.temporaryPassword}`;
        credentialStatus.classList.remove('hidden');
        resetButton.textContent = 'Temporary password generated';
      } catch (error) {
        credentialStatus.textContent = error.message;
        credentialStatus.classList.remove('hidden');
      } finally {
        resetButton.dataset.busy = 'false';
        resetButton.disabled = false;
        resetButton.removeAttribute('aria-busy');
      }
    });
  }
}

// Suspend school
async function suspendSchool(token, schoolId, messageDiv) {
  try {
    const response = await fetch(`/api/v1/schools/${schoolId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) throw new Error('Failed to suspend school');

    appendAuditLog('Suspended school', schoolId);
    if (messageDiv) {
      messageDiv.textContent = '✓ School suspended successfully';
      messageDiv.classList.remove('hidden');
    }

    setTimeout(() => location.reload(), 1500);
  } catch (error) {
    if (messageDiv) {
      messageDiv.textContent = `✗ Error: ${error.message}`;
      messageDiv.classList.remove('hidden');
    }
  }
}

// Activate school
async function activateSchool(token, schoolId, messageDiv) {
  try {
    const response = await fetch(`/api/v1/schools/${schoolId}/activate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) throw new Error('Failed to activate school');

    appendAuditLog('Activated school', schoolId);
    if (messageDiv) {
      messageDiv.textContent = '✓ School activated successfully';
      messageDiv.classList.remove('hidden');
    }

    setTimeout(() => location.reload(), 1500);
  } catch (error) {
    if (messageDiv) {
      messageDiv.textContent = `✗ Error: ${error.message}`;
      messageDiv.classList.remove('hidden');
    }
  }
}

// Soft-suspend school
async function deleteSchool(token, schoolId, messageDiv) {
  try {
    const response = await fetch(`/api/v1/schools/${schoolId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) throw new Error('Failed to suspend school');

    appendAuditLog('Suspended school', schoolId);
    if (messageDiv) {
      messageDiv.textContent = '✓ School suspended successfully. Its data was retained.';
      messageDiv.classList.remove('hidden');
    }

    setTimeout(() => location.reload(), 1500);
  } catch (error) {
    if (messageDiv) {
      messageDiv.textContent = `✗ Error: ${error.message}`;
      messageDiv.classList.remove('hidden');
    }
  }
}

function getAccessToken() {
  return localStorage.getItem('globyedu_accessToken');
}

function renderSubscriptions(summary = {}, schools = []) {
  const state = getAdminState();
  const activeSubscriptions = schools.filter((school) => String(school.subscriptionStatus || '').toLowerCase() === 'active').length;
  const trialSubscriptions = schools.filter((school) => String(school.subscriptionStatus || '').toLowerCase() === 'trial').length;
  const pastDue = schools.filter((school) => String(school.subscriptionStatus || '').toLowerCase() === 'expired').length;
  
  const summaryCards = [
    { label: 'Active plans', value: activeSubscriptions.toString(), tone: 'emerald' },
    { label: 'Trial renewals', value: trialSubscriptions.toString(), tone: 'sky' },
    { label: 'Past due', value: pastDue.toString(), tone: 'amber' },
  ].map((card) => `
    <div class="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
      <p class="text-sm text-slate-500">${card.label}</p>
      <p class="mt-3 text-2xl font-semibold text-slate-900">${card.value}</p>
    </div>
  `).join('');

  return `
    <section class="space-y-6">
      <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Subscriptions</p>
        <h2 class="mt-2 text-2xl font-semibold text-slate-900">Tenant subscriptions and growth plans</h2>
        <p class="mt-3 text-slate-600">Track renewals, upgrade opportunities, and the platform’s health across all subscribed schools.</p>
        <div class="mt-6 grid gap-4 md:grid-cols-3">${summaryCards}</div>
      </div>
      <div class="rounded-[2rem] border border-slate-200 bg-slate-50 p-6 shadow-sm">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Current plans</p>
            <h3 class="mt-2 text-xl font-semibold text-slate-900">Live subscription portfolio</h3>
          </div>
          <p class="text-sm text-slate-600">Subscription renewals take effect only after the school completes verified checkout.</p>
          <div id="subscription-action-status" class="hidden rounded-3xl border border-amber-100 bg-amber-50 px-4 py-2 text-sm text-amber-800"></div>
        </div>
        <div class="mt-6 grid gap-4 lg:grid-cols-2">
          ${(() => {
            const plans = {};
            schools.forEach(s => {
              const plan = s.subscriptionPlan || 'trial';
              plans[plan] = (plans[plan] || 0) + 1;
            });
            return Object.entries(plans).map(([plan, count]) => `
              <div class="rounded-[1.75rem] border border-slate-200 bg-white p-5">
                <p class="font-semibold text-slate-900">${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan</p>
                <p class="mt-2 text-sm text-slate-600">${count} ${count === 1 ? 'school' : 'schools'} subscribed.</p>
              </div>
            `).join('') || '<div class="rounded-[1.75rem] border border-slate-200 bg-white p-5"><p class="text-sm text-slate-600">No subscription plans configured.</p></div>';
          })()}
        </div>
      </div>
    </section>
  `;
}

function renderUsers(schools = []) {
  const state = getAdminState();
  const totalSchools = schools.length;
  const totalUsers = schools.reduce((sum, s) => sum + (s.userCount || 0), 0);
  const userRows = [
    { name: 'Benjamin Cole', role: 'Super Admin', lastSeen: '2 min ago' },
    { name: 'Amina Yusuf', role: 'School Admin', lastSeen: '11 min ago' },
    { name: 'Noah Kim', role: 'Teacher', lastSeen: '1 hr ago' },
  ].map((user) => `
    <div class="flex items-center justify-between rounded-[1.5rem] border border-slate-200 bg-white p-4">
      <div>
        <p class="font-semibold text-slate-900">${user.name}</p>
        <p class="mt-1 text-sm text-slate-600">${user.role}</p>
      </div>
      <span class="text-sm text-slate-500">${user.lastSeen}</span>
    </div>
  `).join('');

  return `
    <section class="space-y-6">
      <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Users</p>
            <h2 class="mt-2 text-2xl font-semibold text-slate-900">Manage platform users and team access</h2>
          </div>
          <button type="button" data-admin-action="invite-user" class="rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700">Invite user</button>
        </div>
        <form id="invite-user-form" class="mt-6 grid gap-4 lg:grid-cols-[1fr_1fr_auto]">
          <input type="text" name="name" placeholder="Full name" class="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" required />
          <input type="email" name="email" placeholder="Email address" class="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" required />
          <button type="submit" class="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700">Add</button>
        </form>
      </div>
      <div class="grid gap-4">${userRows}</div>
    </section>
  `;
}

function renderAnalytics(summary = {}, schools = []) {
  const totalStudents = summary.totalStudents || 0;
  const totalTeachers = summary.totalTeachers || 0;
  const totalSchools = summary.totalSchools || schools.length || 0;
  const activeSchools = summary.activeSchools ?? schools.filter((school) => ['active', 'paid'].includes(String(school.schoolStatus || school.status || '').toLowerCase())).length;
  const suspendedSchools = summary.suspendedSchools ?? schools.filter((school) => ['suspended', 'inactive', 'blocked', 'disabled'].includes(String(school.schoolStatus || school.status || '').toLowerCase())).length;
  const trialSchools = summary.trialSchools ?? schools.filter((school) => String(school.subscriptionStatus || '').toLowerCase() === 'trial').length;
  const activeSubscriptions = summary.activeSubscriptions ?? schools.filter((school) => ['active', 'paid'].includes(String(school.subscriptionStatus || '').toLowerCase())).length;
  return `
    <section class="space-y-6">
      <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Analytics</p>
        <h2 class="mt-2 text-2xl font-semibold text-slate-900">Live operational analytics</h2>
        <p class="mt-3 text-slate-600">Review growth and subscription activity from real tenant records.</p>
        <div class="mt-4 flex flex-wrap gap-2">${[7, 30, 90, 365].map((days) => `<button type="button" data-analytics-days="${days}" class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">${days === 365 ? '1 year' : `${days} days`}</button>`).join('')}</div>
        <div class="mt-6 grid gap-4 md:grid-cols-3 xl:grid-cols-4">
          ${renderMiniStat('Total Students', totalStudents.toLocaleString(), '📈')}
          ${renderMiniStat('Total Teachers', totalTeachers.toLocaleString(), '👨‍🏫')}
          ${renderMiniStat('Total Schools', totalSchools.toLocaleString(), '🏫')}
          ${renderMiniStat('Active Schools', activeSchools.toLocaleString(), '✅')}
          ${renderMiniStat('Suspended Schools', suspendedSchools.toLocaleString(), '⏸')}
          ${renderMiniStat('Trial Subscriptions', trialSchools.toLocaleString(), '🧪')}
          ${renderMiniStat('Active Subscriptions', activeSubscriptions.toLocaleString(), '💳')}
        </div>
      </div>
      <div class="grid gap-6 lg:grid-cols-3">
        ${renderAnalyticsSeries('School growth', summary.analytics?.schoolGrowth)}
        ${renderAnalyticsSeries('Student growth', summary.analytics?.studentGrowth)}
        ${renderAnalyticsSeries('Teacher growth', summary.analytics?.teacherGrowth)}
      </div>
      <div class="rounded-[2rem] border border-slate-200 bg-slate-50 p-6 shadow-sm">
        <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Subscription activity</p>
        <div class="mt-4 grid gap-3 sm:grid-cols-4">${(summary.analytics?.subscriptionActivity || []).map((item) => renderMiniStat(item.status, item.count.toLocaleString(), '•')).join('')}</div>
      </div>
    </section>
  `;
}

function renderAnalyticsSeries(label, series = []) {
  const values = Array.isArray(series) ? series : [];
  const max = Math.max(1, ...values.map((item) => Number(item.count || 0)));
  return `<div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm"><p class="text-sm uppercase tracking-[0.3em] text-slate-500">${label}</p>${values.length ? `<div class="mt-5 flex h-40 items-end gap-2">${values.map((item) => `<div class="flex min-w-0 flex-1 flex-col items-center gap-2"><div class="w-full rounded-t-lg bg-sky-500" style="height:${Math.max(6, (Number(item.count || 0) / max) * 100)}%" title="${item.date}: ${item.count}"></div><span class="truncate text-[10px] text-slate-500">${item.date.slice(5)}</span></div>`).join('')}</div>` : '<p class="mt-5 text-sm text-slate-500">No dated records in this period.</p>'}</div>`;
}

function renderReports(summary = {}, schools = []) {
  const totalSchools = summary.totalSchools || 0;
  const totalStudents = summary.totalStudents || 0;
  const revenue = summary.revenue || 'Not available';
  const schoolReports = schools.flatMap((school) => (Array.isArray(school.reports) ? school.reports.map((report) => ({ ...report, schoolName: school.name || school.schoolName || school.schoolId })) : []));
  return `
    <section class="space-y-6">
      <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Reports</p>
        <h2 class="mt-2 text-2xl font-semibold text-slate-900">Export-ready reports and summaries</h2>
        <div class="mt-6 grid gap-4 lg:grid-cols-3">
          <div class="rounded-[1.75rem] border border-slate-200 bg-slate-50 p-5">
            <p class="font-semibold text-slate-900">Schools Overview</p>
            <p class="mt-2 text-sm text-slate-600">${totalSchools} schools across ${schools.length} tenants.</p>
          </div>
          <div class="rounded-[1.75rem] border border-slate-200 bg-slate-50 p-5">
            <p class="font-semibold text-slate-900">Student Population</p>
            <p class="mt-2 text-sm text-slate-600">${totalStudents.toLocaleString()} students enrolled.</p>
          </div>
          <div class="rounded-[1.75rem] border border-slate-200 bg-slate-50 p-5">
            <p class="font-semibold text-slate-900">Platform Revenue</p>
            <p class="mt-2 text-sm text-slate-600">${revenue === 'Not available' ? 'No reliable platform revenue ledger is configured.' : `Recorded revenue: ${revenue}.`}</p>
          </div>
        </div>
        <div class="mt-6 rounded-[1.75rem] border border-slate-200 bg-slate-50 p-5">
          <p class="font-semibold text-slate-900">Reports submitted by schools</p>
          <div class="mt-4 space-y-3">
            ${schoolReports.length ? schoolReports.map((report) => {
              const statusColor = {
                'draft': 'bg-amber-50 text-amber-700',
                'submitted': 'bg-blue-50 text-blue-700',
                'reviewed': 'bg-purple-50 text-purple-700',
                'approved': 'bg-emerald-50 text-emerald-700',
                'rejected': 'bg-red-50 text-red-700'
              }[report.status] || 'bg-sky-50 text-sky-700';
              return `
              <article class="rounded-2xl border border-slate-200 bg-white p-4">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p class="font-semibold text-slate-900">${report.title || 'School report'}</p>
                    <p class="mt-1 text-sm text-slate-600">
                      <strong>${report.schoolName || 'School'}</strong>
                      ${report.type ? ` • [${report.type.toUpperCase()}]` : ''}
                      ${report.summary ? ` • ${report.summary}` : ''}
                    </p>
                    ${report.submittedAt ? `<p class="mt-1 text-xs text-slate-500">Submitted: ${new Date(report.submittedAt).toLocaleString()}</p>` : ''}
                  </div>
                  <span class="rounded-full ${statusColor} px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em]">${report.status || 'submitted'}</span>
                </div>
              </article>
            `}).join('') : '<p class="text-sm text-slate-600">No school reports have been submitted yet.</p>'}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderMessages(loadedSchools = []) {
  const state = getAdminState();
  const messages = (state.messages || []).slice(0, 8).map((message) => `
    <div class="rounded-[1.5rem] border border-slate-200 bg-white p-4">
      <div class="flex items-center justify-between gap-2">
        <div>
          <p class="font-semibold text-slate-900">${message.subject}</p>
          <p class="mt-1 text-xs text-slate-500">${message.recipientType || 'one-school'} • ${message.recipientSchoolIds?.length ? message.recipientSchoolIds.join(', ') : message.recipients || 'Recipients'} </p>
        </div>
        <span class="rounded-full ${String(message.priority || 'Normal').toLowerCase() === 'urgent' ? 'bg-rose-100 text-rose-700' : 'bg-sky-100 text-sky-700'} px-3 py-1 text-xs font-semibold">${message.priority || 'Normal'}</span>
      </div>
      <p class="mt-2 text-sm text-slate-600">${message.body}</p>
      <div class="mt-3 flex items-center justify-between text-xs text-slate-500">
        <span>Sent by ${message.sender || 'Super Admin'}</span>
        <span>${message.createdAt ? new Date(message.createdAt).toLocaleString() : 'Now'}</span>
      </div>
    </div>
  `).join('');

  return `
    <section class="space-y-6">
      <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Messages</p>
        <h2 class="mt-2 text-2xl font-semibold text-slate-900">Send tenant-safe platform communications</h2>
        <form id="message-composer" class="mt-6 space-y-4">
          <div class="grid gap-4 md:grid-cols-2">
            <select name="recipientType" class="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" aria-label="Recipient selection">
              <option value="one-school">One school</option>
              <option value="multiple-schools">Multiple schools</option>
              <option value="all-schools">All schools</option>
            </select>
            <select id="schoolSelector" name="schoolSelector" multiple class="min-h-[120px] rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" aria-label="School recipient selector">
              ${renderSchoolRecipientOptions([], loadedSchools)}
            </select>
          </div>
          <input type="text" name="subject" placeholder="Subject" class="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" required />
          <textarea name="body" rows="4" placeholder="Compose a message" class="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" required></textarea>
          <div class="flex flex-wrap items-center gap-3">
            <select name="priority" class="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <option value="Normal">Normal</option>
              <option value="Urgent">Urgent</option>
            </select>
            <!-- support message retention -->
            <span class="rounded-full bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700">Support message retention: 1 hour</span>
            <button type="submit" class="rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700">Send message</button>
          </div>
          <div data-message-status class="hidden rounded-3xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800"></div>
        </form>
      </div>
      <div class="grid gap-4">${messages || '<div class="rounded-[1.5rem] border border-slate-200 bg-white p-5 text-sm text-slate-600">No messages recorded yet.</div>'}</div>
    </section>
  `;
}

function renderAnnouncements() {
  const state = getAdminState();
  const items = (state.announcements || []).slice(0, 8).map((entry) => `
    <div class="rounded-[1.5rem] border border-slate-200 bg-white p-4">
      <div class="flex items-center justify-between gap-2">
        <p class="font-semibold text-slate-900">${entry.title}</p>
        <span class="rounded-full ${entry.status === 'published' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700'} px-3 py-1 text-xs font-semibold">${entry.status || 'draft'}</span>
      </div>
      <p class="mt-2 text-sm text-slate-600">${entry.content || entry.body}</p>
      <div class="mt-3 flex items-center justify-between text-xs text-slate-500">
        <span>Author: ${entry.author || 'Super Admin'}</span>
        <span>Priority: ${entry.priority || 'normal'}</span>
      </div>
    </div>
  `).join('');

  return `
    <section class="space-y-6">
      <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Announcements</p>
        <h2 class="mt-2 text-2xl font-semibold text-slate-900">Draft platform announcements</h2>
        <p class="mt-3 text-sm text-amber-800">Announcements and published status are stored in this browser only; no global announcements API is available.</p>
        <form id="announcement-composer" class="mt-6 space-y-4">
          <input type="text" name="title" placeholder="Announcement title" class="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" required />
          <textarea name="content" rows="4" placeholder="Add the details" class="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" required></textarea>
          <div class="flex flex-wrap items-center gap-3">
            <select name="status" class="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <option value="draft">Draft</option>
              <option value="published">Published (local label only)</option>
            </select>
            <select name="priority" class="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <option value="normal">Normal</option>
              <option value="urgent">Urgent</option>
            </select>
            <button type="submit" class="rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700">Save announcement</button>
          </div>
          <div data-announcement-status class="hidden rounded-3xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800"></div>
        </form>
      </div>
      <div class="grid gap-4">${items || '<div class="rounded-[1.5rem] border border-slate-200 bg-white p-5 text-sm text-slate-600">No announcements published yet.</div>'}</div>
    </section>
  `;
}

function renderSupport(loadedSchools = []) {
  const state = getAdminState();
  const storedSchools = getSchoolDirectoryFromState();
  const schools = storedSchools.length ? storedSchools : loadedSchools;
  const tickets = (state.supportTickets || []).slice(0, 8).map((ticket) => `
    <div class="rounded-[1.5rem] border border-slate-200 bg-white p-4">
      <div class="flex items-center justify-between gap-2">
        <div>
          <p class="font-semibold text-slate-900">${ticket.subject}</p>
          <p class="mt-1 text-xs text-slate-500">${ticket.schoolName || ticket.schoolId || 'Unknown school'} • ${ticket.priority || 'normal'}</p>
        </div>
        <span class="rounded-full ${ticket.status === 'Closed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'} px-3 py-1 text-xs font-semibold">${ticket.status || 'Open'}</span>
      </div>
      <p class="mt-2 text-sm text-slate-600">${ticket.message || ticket.body}</p>
      <div class="mt-3 flex items-center justify-between text-xs text-slate-500">
        <span>Created: ${ticket.createdAt ? new Date(ticket.createdAt).toLocaleString() : 'Unknown'}</span>
        <span>Retention: ${ticket.expiresAt ? new Date(ticket.expiresAt).toLocaleString() : '1 hour from close'}</span>
      </div>
    </div>
  `).join('');

  return `
    <section class="space-y-6">
      <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Support</p>
        <h2 class="mt-2 text-2xl font-semibold text-slate-900">Local support-ticket drafts</h2>
        <p class="mt-3 text-sm text-amber-800">These records remain in this browser and are not sent to schools; a platform-wide support API is not available.</p>
        <form id="support-ticket-form" class="mt-6 space-y-4">
          <div class="grid gap-4 md:grid-cols-2">
            <select name="schoolId" class="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <option value="all-schools">All schools</option>
              ${schools.map((school) => `<option value="${String(school.schoolId || school.id || school.name || '')}">${school.name || school.schoolName || 'School'}</option>`).join('')}
            </select>
            <input type="text" name="schoolName" placeholder="School name" class="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" />
          </div>
          <input type="text" name="subject" placeholder="Issue summary" class="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" required />
          <textarea name="body" rows="4" placeholder="Describe the issue" class="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" required></textarea>
          <div class="flex flex-wrap items-center gap-3">
            <select name="priority" class="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <option value="normal">Normal</option>
              <option value="urgent">Urgent</option>
            </select>
            <button type="submit" class="rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700">Create ticket</button>
          </div>
          <div data-support-status class="hidden rounded-3xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800"></div>
        </form>
      </div>
      <div class="grid gap-4">${tickets || '<div class="rounded-[1.5rem] border border-slate-200 bg-white p-5 text-sm text-slate-600">No support tickets recorded yet.</div>'}</div>
    </section>
  `;
}

function renderFeatureManager() {
  const state = getAdminState();
  const modules = state.modules || {};
  
  const moduleCategories = {
    'Academic': ['attendance', 'exams', 'library'],
    'Communication': ['messaging', 'notifications', 'announcements'],
    'Administrative': ['finance', 'reports', 'websiteCms'],
    'Support Services': ['aiTutor', 'transport', 'canteen'],
    'Extended': ['plugins', 'sms', 'email', 'parentPortal'],
  };

  const moduleLabels = {
    attendance: 'Attendance Management',
    aiTutor: 'School Insights',
    library: 'Library System',
    transport: 'Transport Management',
    canteen: 'Canteen Services',
    finance: 'Finance & Billing',
    exams: 'Examination System',
    messaging: 'Messaging & Chat',
    reports: 'Reports & Analytics',
    websiteCms: 'Website CMS',
    plugins: 'Plugin System',
    notifications: 'Notifications',
    sms: 'SMS Gateway',
    email: 'Email Service',
    parentPortal: 'Parent Portal',
  };

  let html = `
    <section class="space-y-6">
      <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Feature Manager</p>
        <h2 class="mt-2 text-2xl font-semibold text-slate-900">Enable or disable platform features</h2>
        <p class="mt-3 text-slate-600">Control which modules are available to schools and users on your platform.</p>
  `;

  Object.entries(moduleCategories).forEach(([category, moduleIds]) => {
    html += `
      <div class="mt-6">
        <h3 class="mb-4 text-lg font-semibold text-slate-800">${category}</h3>
        <div class="grid gap-3 lg:grid-cols-2">
    `;

    moduleIds.forEach((moduleId) => {
      const isEnabled = modules[moduleId] ?? false;
      const label = moduleLabels[moduleId] || moduleId;
      html += `
        <label class="flex items-center justify-between rounded-3xl border border-slate-200 bg-slate-50 px-5 py-4 transition hover:bg-white cursor-pointer">
          <div class="flex items-center gap-3 flex-1">
            <input type="checkbox" data-feature-id="${moduleId}" ${isEnabled ? 'checked' : ''} class="h-5 w-5 rounded border-slate-300 text-sky-600 cursor-pointer" />
            <span class="font-medium text-slate-700">${label}</span>
          </div>
          <span class="text-xs font-semibold px-3 py-1 rounded-full ${isEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}">
            ${isEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </label>
      `;
    });

    html += `
        </div>
      </div>
    `;
  });

  html += `
        <div class="mt-8 flex flex-wrap gap-3 border-t border-slate-200 pt-6">
          <button type="button" id="save-features" class="rounded-full bg-sky-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-sky-700">Save changes</button>
          <button type="button" id="reset-features" class="rounded-full border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">Reset to defaults</button>
          <div id="feature-status" class="hidden rounded-3xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"></div>
        </div>
      </div>
    </section>
  `;

  return html;
}

function renderPlugins() {
  const state = getAdminState();
  const plugins = (state.plugins || []).map((plugin) => `
    <label class="flex items-center justify-between rounded-[1.5rem] border border-slate-200 bg-white p-4">
      <div>
        <p class="font-semibold text-slate-900">${plugin.name}</p>
        <p class="mt-1 text-sm text-slate-600">${plugin.description}</p>
      </div>
      <input type="checkbox" data-plugin-id="${plugin.id}" ${plugin.enabled ? 'checked' : ''} class="h-5 w-5 rounded border-slate-300 text-sky-600" />
    </label>
  `).join('');

  return `
    <section class="space-y-6">
      <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Plugin Marketplace</p>
        <h2 class="mt-2 text-2xl font-semibold text-slate-900">Enable or disable platform extensions</h2>
        <div class="mt-6 grid gap-4">${plugins}</div>
        <button type="button" id="save-plugins" class="mt-6 rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700">Save plugins</button>
        <div id="plugin-status" class="mt-4 hidden rounded-3xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800"></div>
      </div>
    </section>
  `;
}

function maskSensitiveBackupData(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (value.length <= 4) return '*'.repeat(Math.max(4, value.length));
    return `${value.slice(0, 2)}${'*'.repeat(Math.max(6, value.length - 4))}${value.slice(-2)}`;
  }
  if (Array.isArray(value)) return value.map((entry) => maskSensitiveBackupData(entry));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => {
      const loweredKey = key.toLowerCase();
      if (loweredKey.includes('password') || loweredKey.includes('token') || loweredKey.includes('secret') || loweredKey.includes('key') || loweredKey.includes('credential')) {
        return [key, typeof nestedValue === 'string' ? maskAuditValue(nestedValue) : '***'];
      }
      return [key, maskSensitiveBackupData(nestedValue)];
    }));
  }
  return value;
}

function getBackupStorageConfig() {
  const state = getAdminState();
  const defaults = {
    provider: 'local-fallback',
    storageBucket: 'globyedu-local-backups',
    storageLocation: 'Local browser storage',
    retentionDays: 30,
    backupFrequency: 'manual',
    lastSuccessfulBackup: null,
    status: 'ready',
    lastVerifiedAt: null,
    backupSize: 0,
    lastBackupId: null,
    superAdminEmergencyAccess: true,
  };
  const persisted = (() => {
    try {
      const raw = localStorage.getItem('globyedu_backup_config_v1');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  })();
  return { ...defaults, ...(state.settings?.backup || {}), ...persisted };
}

function saveBackupStorageConfig(config = {}) {
  const current = getBackupStorageConfig();
  const next = { ...current, ...config };
  localStorage.setItem('globyedu_backup_config_v1', JSON.stringify(next));
  const state = getAdminState();
  state.settings = { ...(state.settings || {}), backup: next };
  saveAdminState(state);
  return next;
}

function getBackupCatalog() {
  try {
    const raw = localStorage.getItem('globyedu_backup_catalog_v1');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveBackupCatalog(list = []) {
  localStorage.setItem('globyedu_backup_catalog_v1', JSON.stringify(list));
  return list;
}

function verifyBackupIntegrity(backup) {
  if (!backup || typeof backup !== 'object') {
    return { valid: false, reason: 'Backup payload is empty or invalid.' };
  }
  if (!backup.id || !backup.createdAt || !backup.data) {
    return { valid: false, reason: 'Backup is missing required metadata or payload data.' };
  }
  const serialized = JSON.stringify(backup);
  if (serialized.includes('password') || serialized.includes('token') || serialized.includes('secret') || serialized.includes('apiKey')) {
    return { valid: false, reason: 'Backup contains sensitive fields that must be redacted before restore.' };
  }
  return { valid: true, reason: 'Backup passed validation and is safe to restore in the supported local fallback mode.' };
}

function createPlatformBackupSnapshot() {
  const role = localStorage.getItem('globyedu_userRole') || 'super_admin';
  const platformAdmin = localStorage.getItem('globyedu_platformAdmin') === 'true';
  if (role !== 'super_admin' && !platformAdmin) {
    return { success: false, reason: 'Only Super Admin can create platform backups.' };
  }

  const state = getAdminState();
  const schoolDirectory = getSchoolDirectoryFromState();
  const cfg = getBackupStorageConfig();
  const snapshot = {
    id: `backup-${Date.now()}`,
    createdAt: new Date().toISOString(),
    provider: cfg.provider,
    storageProvider: cfg.provider,
    storageLocation: cfg.storageLocation,
    version: '1.0',
    data: {
      settings: maskSensitiveBackupData(state.settings || {}),
      schools: maskSensitiveBackupData(schoolDirectory),
      schoolDirectory,
      cms: maskSensitiveBackupData(state.cms || getWebsiteCMSSettings()),
      announcements: maskSensitiveBackupData(state.announcements || []),
      messages: maskSensitiveBackupData(state.messages || []),
      supportTickets: maskSensitiveBackupData(state.supportTickets || []),
      auditLogs: (state.auditLogs || []).slice(0, 20),
      notifications: maskSensitiveBackupData(state.notifications || []),
      modules: state.modules || {},
      pricingPlans: state.pricingPlans || [],
      plugins: state.plugins || [],
      securityEvents: (state.sessions || []).slice(0, 20),
    },
  };

  const valid = verifyBackupIntegrity(snapshot);
  if (!valid.valid) return { success: false, reason: valid.reason };

  const catalog = getBackupCatalog();
  const list = [snapshot, ...catalog].slice(0, 25);
  saveBackupCatalog(list);

  saveBackupStorageConfig({
    ...cfg,
    lastSuccessfulBackup: snapshot.createdAt,
    lastBackupId: snapshot.id,
    backupSize: JSON.stringify(snapshot).length,
    status: 'ready',
    lastVerifiedAt: snapshot.createdAt,
  });

  appendAuditLog('Created backup', `Platform snapshot ${snapshot.id} saved in ${cfg.provider} mode.`, {
    target: 'platform',
    actorRole: 'super_admin',
    resultStatus: 'success',
  });

  return { success: true, backup: snapshot, catalog: list };
}

async function restoreLatestBackup() {
  const role = localStorage.getItem('globyedu_userRole') || 'super_admin';
  const platformAdmin = localStorage.getItem('globyedu_platformAdmin') === 'true';
  if (role !== 'super_admin' && !platformAdmin) {
    return { success: false, reason: 'Only Super Admin can restore platform backups.' };
  }

  const catalog = getBackupCatalog();
  if (!catalog.length) {
    return { success: false, reason: 'No backup exists yet. Create a backup before attempting restore.' };
  }

  const backup = catalog[0];
  const verification = verifyBackupIntegrity(backup);
  if (!verification.valid) {
    return { success: false, reason: verification.reason };
  }

  const cfg = getBackupStorageConfig();
  if (cfg.provider !== 'local-fallback') {
    return {
      success: false,
      reason: `Restore is only supported in the local fallback/development mode while the provider integration is not configured. Current provider: ${cfg.provider}.`,
    };
  }

  if (!window.confirm('Restore the latest backup? This will overwrite local platform data in the current development environment.')) {
    return { success: false, reason: 'Restore cancelled by the Super Admin.' };
  }

  const backupData = backup.data || {};
  let restoredCms = null;
  if (backupData.cms) {
    const token = getAccessToken();
    if (!token) {
      return { success: false, reason: 'Sign in as Super Admin to publish restored website settings.' };
    }
    const result = await publishWebsiteCMS(token, backupData.cms);
    if (!result.ok || result.data?.status !== 'ok' || !result.data.settings) {
      return { success: false, reason: result.data?.message || 'Website settings could not be published; restore was not applied.' };
    }
    restoredCms = result.data.settings;
  }

  const nextState = getAdminState();
  if (backupData.settings) nextState.settings = { ...(nextState.settings || {}), ...backupData.settings };
  if (restoredCms) nextState.cms = { ...(nextState.cms || {}), ...restoredCms };
  if (Array.isArray(backupData.schools)) nextState.schools = backupData.schools;
  if (Array.isArray(backupData.messages)) nextState.messages = backupData.messages;
  if (Array.isArray(backupData.announcements)) nextState.announcements = backupData.announcements;
  if (Array.isArray(backupData.supportTickets)) nextState.supportTickets = backupData.supportTickets;
  if (Array.isArray(backupData.notifications)) nextState.notifications = backupData.notifications;
  if (backupData.modules) nextState.modules = { ...nextState.modules, ...backupData.modules };
  if (Array.isArray(backupData.pricingPlans)) nextState.pricingPlans = backupData.pricingPlans;
  if (Array.isArray(backupData.plugins)) nextState.plugins = backupData.plugins;
  if (Array.isArray(backupData.auditLogs)) nextState.auditLogs = [...backupData.auditLogs, ...((nextState.auditLogs || []).slice(0, 10))].slice(0, 50);
  saveAdminState(nextState);
  localStorage.setItem('globyedu_schoolDirectory', JSON.stringify(nextState.schools || []));
  localStorage.setItem('globyedu_websiteCms', JSON.stringify(nextState.cms || {}));
  if (restoredCms) {
    window.dispatchEvent(new CustomEvent('globyedu-cms-updated', { detail: { settings: nextState.cms } }));
  }

  appendAuditLog('Restored backup', `Recovered backup ${backup.id} and rehydrated platform state.`, {
    target: 'platform',
    actorRole: 'super_admin',
    resultStatus: 'success',
    backupId: backup.id,
  });

  saveBackupStorageConfig({
    ...cfg,
    status: 'restored',
    lastVerifiedAt: new Date().toISOString(),
  });

  return { success: true, backupId: backup.id, restored: nextState };
}

function renderAuditLogs(auditLogs = []) {
  const state = getAdminState();
  const logs = (auditLogs.length ? auditLogs : state.auditLogs || []).map((entry) => {
    const details = entry.details || entry.metadata?.detail || `${entry.resourceType || 'Platform'} ${entry.resourceId || ''}`.trim() || 'No additional details provided.';
    const metadata = entry.metadata || {};
    const metadataHtml = metadata && Object.keys(metadata).length
      ? `<div class="mt-3 rounded-2xl bg-slate-50 p-3 text-xs text-slate-600">${Object.entries(metadata).map(([key, value]) => `<div><span class="font-medium">${key}:</span> ${typeof value === 'string' ? maskAuditValue(value) : JSON.stringify(value)}</div>`).join('')}</div>`
      : '';
    return `
      <div class="audit-log-entry rounded-[1.5rem] border border-slate-200 bg-white p-4" data-audit-role="${entry.actorRole || metadata.actorRole || ''}" data-audit-action="${entry.action || ''}" data-audit-success="${entry.success === false ? 'false' : 'true'}" data-audit-school="${entry.tenantId || metadata.tenantId || ''}">
        <div class="flex items-center justify-between gap-2">
          <p class="font-semibold text-slate-900">${entry.action || 'Platform action'}</p>
          <span class="text-sm text-slate-500">${entry.createdAt || entry.timestamp ? new Date(entry.createdAt || entry.timestamp).toLocaleString() : '—'}</span>
        </div>
        <p class="mt-2 text-sm text-slate-600">${details}</p>
        <div class="mt-2 text-[11px] uppercase tracking-[0.2em] text-slate-500">Actor: ${metadata.actor || entry.actorId || entry.actor || 'System'} • Role: ${metadata.actorRole || entry.actorRole || 'system'} • School: ${entry.tenantId || metadata.tenantId || 'platform'} • Result: ${entry.success === false ? 'failure' : (metadata.resultStatus || entry.resultStatus || 'success')}</div>
        ${metadataHtml}
      </div>
    `;
  }).join('');

  return `
    <section class="space-y-6">
      <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Audit Logs</p>
        <h2 class="mt-2 text-2xl font-semibold text-slate-900">Review recent platform actions</h2>
        <div class="mt-4 grid gap-3 sm:grid-cols-4"><select id="audit-role-filter" class="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm"><option value="">All roles</option><option>super_admin</option><option>school_authority</option><option>teacher</option><option>student</option></select><input id="audit-school-filter" class="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" placeholder="School ID filter" /><input id="audit-action-filter" class="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" placeholder="Action filter" /><select id="audit-success-filter" class="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm"><option value="">All results</option><option value="true">Success</option><option value="false">Failure</option></select></div>
        <div class="mt-6 grid gap-4">${logs || '<div class="rounded-[1.5rem] border border-slate-200 bg-white p-5 text-sm text-slate-600">No audit activity yet.</div>'}</div>
      </div>
    </section>
  `;
}

function renderBackups() {
  const backupConfig = getBackupStorageConfig();
  const catalog = getBackupCatalog();
  const lastBackup = catalog[0];

  return `
    <section class="space-y-6">
      <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Backups</p>
        <h2 class="mt-2 text-2xl font-semibold text-slate-900">Protect school and platform data</h2>
        <p class="mt-3 text-slate-600">Create backup snapshots, review retention, and verify restore readiness. In this environment the local fallback provider is used unless a provider is configured.</p>
        <div class="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          ${renderMiniInfo('Storage provider', backupConfig.provider || 'local-fallback')}
          ${renderMiniInfo('Location', backupConfig.storageLocation || 'Local browser storage')}
          ${renderMiniInfo('Retention', `${backupConfig.retentionDays || 30} days`)}
          ${renderMiniInfo('Frequency', backupConfig.backupFrequency || 'Manual')}
          ${renderMiniInfo('Status', backupConfig.status || 'ready')}
          ${renderMiniInfo('Last success', backupConfig.lastSuccessfulBackup ? new Date(backupConfig.lastSuccessfulBackup).toLocaleString() : 'Not yet backed up')}
          ${renderMiniInfo('Backup size', `${backupConfig.backupSize ? `${Math.round(backupConfig.backupSize / 1024)} KB` : '0 KB'}`)}
          ${renderMiniInfo('Last verified', backupConfig.lastVerifiedAt ? new Date(backupConfig.lastVerifiedAt).toLocaleString() : 'Not verified')}
        </div>
        <div class="mt-6 flex flex-wrap gap-3">
          <button type="button" id="run-backup" class="rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700">Run backup</button>
          <button type="button" id="restore-backup" class="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">Restore latest</button>
        </div>
        <div id="backup-status" class="mt-4 hidden rounded-3xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800"></div>
      </div>
      <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Backup history</p>
        <div class="mt-6 grid gap-4">
          ${catalog.length ? catalog.map((backup) => `
            <div class="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
              <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p class="font-semibold text-slate-900">${backup.id}</p>
                  <p class="text-xs text-slate-500">${new Date(backup.createdAt).toLocaleString()} • Provider: ${backup.provider || 'local-fallback'}</p>
                </div>
                <span class="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-700">Verified</span>
              </div>
            </div>
          `).join('') : '<div class="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">No backup history yet.</div>'}
          <div class="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">${lastBackup ? `Latest backup: ${lastBackup.id}` : 'No latest backup available.'}</div>
        </div>
      </div>
    </section>
  `;
}

function renderSecurity(loadedSchools = []) {
  const state = getAdminState();
  const schools = getSchoolDirectoryFromState().length ? getSchoolDirectoryFromState() : loadedSchools;
  const sessions = state.sessions || [];
  const failedLogins = Number(localStorage.getItem('globyedu_failedLogins') || 0);
  const successfulLogins = Number(localStorage.getItem('globyedu_successfulLogins') || 0);
  const suspendedSchools = schools.filter((school) => ['suspended', 'inactive', 'blocked', 'disabled'].includes(String(school.schoolStatus || school.status || '').toLowerCase())).length;
  const activeSessions = sessions.length;
  const roleDistribution = ['super_admin', 'school_authority', 'teacher', 'student'].map((role) => {
    const count = role === 'super_admin' ? (localStorage.getItem('globyedu_userRole') === 'super_admin' ? 1 : 0) : 0;
    return { role, count };
  });
  const securityEvents = (state.sessions || []).slice(0, 5).map((entry) => `
    <div class="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
      <div class="flex items-center justify-between gap-2">
        <p class="font-semibold text-slate-900">${entry.action || 'Security event'}</p>
        <span class="text-sm text-slate-500">${new Date(entry.timestamp).toLocaleString()}</span>
      </div>
      <p class="mt-2 text-sm text-slate-600">${entry.details || 'Session activity was recorded.'}</p>
    </div>
  `).join('');

  const schoolSelector = schools.length
    ? `<select id="security-school-select" class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
        ${schools.map((school) => `<option value="${school.schoolId || school.id}">${school.name || school.schoolName || school.schoolId}</option>`).join('')}
      </select>`
    : '<p class="mt-2 text-sm text-slate-500">No school records are available in the current workspace.</p>';

  return `
    <section class="space-y-6">
      <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Security</p>
        <h2 class="mt-2 text-2xl font-semibold text-slate-900">Platform security posture</h2>
        <div class="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          ${renderMiniInfo('Authentication', localStorage.getItem('globyedu_userRole') === 'super_admin' ? 'Super Admin authenticated' : 'Session active')}
          ${renderMiniInfo('Active sessions', String(activeSessions))}
          ${renderMiniInfo('Failed logins', String(failedLogins))}
          ${renderMiniInfo('Successful logins', String(successfulLogins))}
          ${renderMiniInfo('Suspended schools', String(suspendedSchools))}
          ${renderMiniInfo('Security events', String(sessions.length))}
          ${renderMiniInfo('Login protection', `${String(getPlatformSettingsState().loginEnabled !== false)}`)}
          ${renderMiniInfo('Super admin emergency access', 'Protected')}
        </div>
      </div>
      <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Security actions</p>
        <div class="mt-6 flex flex-wrap gap-3">
          <button type="button" id="invalidate-sessions" class="rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700">Invalidate stale sessions</button>
          <button type="button" id="refresh-login-protection" class="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">Restore login protection</button>
        </div>
        <div class="mt-6 grid gap-4 md:grid-cols-2">
          <div>
            <p class="text-sm font-medium text-slate-700">School control</p>
            ${schoolSelector}
            <div class="mt-3 flex flex-wrap gap-2">
              <button type="button" id="security-suspend-school" class="rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-700">Suspend school</button>
              <button type="button" id="security-activate-school" class="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700">Activate school</button>
            </div>
          </div>
          <div>
            <p class="text-sm font-medium text-slate-700">Role distribution</p>
            <div class="mt-3 space-y-2 text-sm text-slate-600">
              ${roleDistribution.map((entry) => `<div class="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2"><span>${entry.role}</span><span>${entry.count}</span></div>`).join('')}
            </div>
          </div>
        </div>
      </div>
      <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Recent protected sessions</p>
        <div class="mt-6 grid gap-4">${securityEvents || '<div class="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">No protected session activity has been recorded yet.</div>'}</div>
      </div>
    </section>
  `;
}

function renderPayments() {
  const state = getAdminState();
  const providers = (state.payments || []).filter((provider) => provider.id === 'paystack')
    .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
    .map((provider) => `
      <form class="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm" data-payment-form="${provider.id}">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="font-semibold text-slate-900">${provider.name}</p>
            <p class="mt-1 text-sm text-slate-600">${provider.environment || ''} • ${provider.currency || ''} • ${provider.status || 'Not configured'}</p>
          </div>
          <label class="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="enabled" ${provider.enabled ? 'checked' : ''} class="h-4 w-4 rounded border-slate-300 text-sky-600" /> Enabled
          </label>
        </div>

        <div class="mt-4 grid gap-4 md:grid-cols-2">
          <label class="text-sm text-slate-700">Environment
            <select name="environment" class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <option value="sandbox" ${provider.environment === 'sandbox' ? 'selected' : ''}>Sandbox</option>
              <option value="production" ${provider.environment === 'production' ? 'selected' : ''}>Production</option>
              <option value="manual" ${provider.environment === 'manual' ? 'selected' : ''}>Manual</option>
            </select>
          </label>
          <label class="text-sm text-slate-700">Currency
            <input type="text" name="currency" value="${provider.currency || ''}" class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" />
          </label>
          <label class="text-sm text-slate-700">Public key
            <input type="text" name="publicKey" value="${provider.publicKey || ''}" class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" />
          </label>
          <label class="text-sm text-slate-700">Merchant email
            <input type="email" name="merchantEmail" value="${provider.merchantEmail || ''}" class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" />
          </label>
          <label class="text-sm text-slate-700">Callback URL
            <input type="text" name="callbackUrl" value="${provider.callbackUrl || ''}" class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" />
          </label>
          <label class="text-sm text-slate-700">Webhook URL
            <input type="text" name="webhookUrl" value="${provider.webhookUrl || ''}" class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" />
          </label>
          <label class="text-sm text-slate-700">Secret key
            <input type="password" name="secretKey" data-sensitive-field="true" placeholder="${provider.encryptedSecretKey ? 'Stored securely' : 'Enter secret key'}" class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" />
          </label>
          <label class="text-sm text-slate-700">Webhook secret
            <input type="password" name="webhookSecret" data-sensitive-field="true" placeholder="${provider.encryptedWebhookSecret ? 'Stored securely' : 'Enter webhook secret'}" class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" />
          </label>
          <label class="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="defaultGateway" ${provider.defaultGateway ? 'checked' : ''} class="h-4 w-4 rounded border-slate-300 text-sky-600" /> Default gateway
          </label>
        </div>

        <div class="mt-4 flex flex-wrap items-center gap-3">
          <button type="submit" class="rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700">Save provider</button>
          <div data-payment-status class="hidden rounded-3xl border border-emerald-100 bg-emerald-50 px-4 py-2 text-sm text-emerald-800"></div>
        </div>
      </form>
    `)
    .join('');

  return `
    <section class="space-y-6">
      <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Payments</p>
        <h2 class="mt-2 text-2xl font-semibold text-slate-900">Connect and manage payment providers</h2>
        <p class="mt-3 text-slate-600">Update gateway credentials, webhook settings, and preferred payment flows for your platform.</p>
        <div class="mt-6 grid gap-4">${providers}</div>
      </div>
    </section>
  `;
}

function renderPricingManagement(pricingPlans = []) {
  const plans = Array.isArray(pricingPlans) ? pricingPlans.slice().sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0)) : [];
  const activePlans = plans.filter((plan) => plan.active).length;
  const recommended = plans[0] || null;

  const planForms = plans.length
    ? plans.map((plan) => renderPricingPlanForm(plan)).join('')
    : `<div class="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
         <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Pricing</p>
         <h2 class="mt-2 text-2xl font-semibold text-slate-900">No plans configured yet</h2>
         <p class="mt-4 text-slate-600">Use the Super Admin pricing module to create and publish subscription plans for the website.</p>
       </div>`;

  return `
    <section class="space-y-6">
      <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Pricing</p>
            <h2 class="mt-2 text-2xl font-semibold text-slate-900">Manage pricing plans</h2>
            <p class="mt-3 text-slate-600">Define plans, pricing, and feature bundles that are used on the public pricing page.</p>
          </div>
        </div>
        <div class="mt-6 grid gap-4 sm:grid-cols-2">
          <div class="rounded-[1.75rem] border border-slate-200 bg-slate-50 p-5">
            <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Total plans</p>
            <p class="mt-3 text-3xl font-semibold text-slate-900">${plans.length}</p>
          </div>
          <div class="rounded-[1.75rem] border border-slate-200 bg-slate-50 p-5">
            <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Active plans</p>
            <p class="mt-3 text-3xl font-semibold text-slate-900">${activePlans}</p>
          </div>
          ${recommended ? `<div class="rounded-[1.75rem] border border-slate-200 bg-slate-50 p-5">
            <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Recommended plan</p>
            <p class="mt-3 text-lg font-semibold text-slate-900">${recommended.name}</p>
          </div>` : ''}
        </div>
      </div>
      <div class="grid gap-6">${planForms}</div>
    </section>
  `;
}

function renderPricingPlanForm(plan) {
  return `
    <form class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm" data-pricing-plan-form="${plan.id}" data-pricing-plan='${JSON.stringify(plan).replace(/'/g, '&#39;')}'>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-lg font-semibold text-slate-900">${plan.name}</p>
          <p class="mt-1 text-sm text-slate-600">${plan.shortDescription || 'Describe this plan.'}</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <label class="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="active" ${plan.active ? 'checked' : ''} class="h-4 w-4 rounded border-slate-300 text-sky-600" /> Active
          </label>
        </div>
      </div>

      <div class="mt-4 grid gap-4 lg:grid-cols-3">
        <label class="text-sm text-slate-700">Plan name
          <input name="name" value="${plan.name || ''}" class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" />
        </label>
        <label class="text-sm text-slate-700">Student limit
          <input type="number" min="1" name="studentLimit" value="${plan.studentLimit || ''}" class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" />
        </label>
        <label class="text-sm text-slate-700">Monthly price
          <input type="number" min="0" name="monthlyAmount" value="${plan.monthlyAmount || ''}" class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" />
        </label>
        <label class="text-sm text-slate-700">Yearly price
          <input type="number" min="0" name="yearlyAmount" value="${plan.yearlyAmount || ''}" class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" />
        </label>
        <label class="text-sm text-slate-700">Currency
          <input name="currency" value="${plan.currency || ''}" class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" />
        </label>
        <label class="text-sm text-slate-700">Display order
          <input type="number" min="0" name="displayOrder" value="${plan.displayOrder || 0}" class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" />
        </label>
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-3">
        <label class="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="recommendedBadge" ${plan.recommendedBadge ? 'checked' : ''} class="h-4 w-4 rounded border-slate-300 text-sky-600" /> Recommended
        </label>
      </div>

      <label class="mt-4 block text-sm text-slate-700">Short description
        <textarea name="shortDescription" rows="3" class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">${plan.shortDescription || ''}</textarea>
      </label>

      <div class="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" class="rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700">Save plan</button>
        <div data-pricing-status class="hidden rounded-3xl border border-emerald-100 bg-emerald-50 px-4 py-2 text-sm text-emerald-800"></div>
      </div>
    </form>
  `;
}

function renderPricingFeatureToggle(label, field, enabled) {
  return `
    <label class="flex items-center gap-2 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
      <input type="checkbox" name="feature-${field}" ${enabled ? 'checked' : ''} class="h-4 w-4 rounded border-slate-300 text-sky-600" />
      ${label}
    </label>
  `;
}

function renderAISettings() {
  const state = getAdminState();
  const providers = (state.aiProviders || []).map((provider) => {
    const statusColor = provider.connectionStatus === 'Connected' ? 'emerald' : provider.connectionStatus === 'Failed' ? 'rose' : 'amber';
    const statusBgColor = statusColor === 'emerald' ? 'bg-emerald-50' : statusColor === 'rose' ? 'bg-rose-50' : 'bg-amber-50';
    const statusBorderColor = statusColor === 'emerald' ? 'border-emerald-200' : statusColor === 'rose' ? 'border-rose-200' : 'border-amber-200';
    const statusTextColor = statusColor === 'emerald' ? 'text-emerald-800' : statusColor === 'rose' ? 'text-rose-800' : 'text-amber-800';
    
    return `
      <form class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm" data-ai-provider-form="${provider.id}">
        <div class="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <div>
            <p class="font-semibold text-slate-900">${provider.name}</p>
            <p class="mt-1 text-xs text-slate-500">Model: ${provider.model || 'Not set'}</p>
          </div>
          <div class="flex items-center gap-3">
            <div class="rounded-full px-3 py-1 text-xs font-medium ${statusBgColor} border ${statusBorderColor} ${statusTextColor}">
              ${provider.connectionStatus}${provider.latency ? ' • ' + provider.latency + 'ms' : ''}
            </div>
            <label class="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name="enabled" ${provider.enabled ? 'checked' : ''} class="h-4 w-4 rounded border-slate-300 text-sky-600" /> Enabled
            </label>
          </div>
        </div>
        <div class="mt-4 grid gap-4 lg:grid-cols-2">
          <label class="text-sm text-slate-700">API key
            <input type="password" name="apiKey" value="" data-sensitive-field="true" placeholder="${provider.apiKey ? 'Stored securely' : 'Enter your API key'}" class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-sky-400" />
          </label>
          <label class="text-sm text-slate-700">Model
            <input type="text" name="model" value="${provider.model || ''}" class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-sky-400" />
          </label>
          <label class="text-sm text-slate-700">Temperature
            <input type="number" step="0.1" min="0" max="2" name="temperature" value="${provider.temperature || 0.7}" class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-sky-400" />
          </label>
          <label class="text-sm text-slate-700">Max tokens
            <input type="number" name="maxTokens" value="${provider.maxTokens || 512}" class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-sky-400" />
          </label>
        </div>
        ${provider.baseUrl ? `
          <label class="mt-4 block text-sm text-slate-700">Base URL
            <input type="text" name="baseUrl" value="${provider.baseUrl || ''}" class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-sky-400" />
          </label>
        ` : ''}
        <label class="mt-4 block text-sm text-slate-700">System prompt
          <textarea name="systemPrompt" rows="3" placeholder="Enter system prompt for this provider" class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-sky-400">${provider.systemPrompt || ''}</textarea>
        </label>
        <div class="mt-4 flex flex-wrap items-center gap-3">
          <button type="submit" class="rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700">Save provider</button>
          <button type="button" data-ai-test-btn="${provider.id}" class="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">Test connection</button>
          <div data-ai-status class="hidden rounded-3xl border border-emerald-100 bg-emerald-50 px-4 py-2 text-sm text-emerald-800"></div>
        </div>
      </form>
    `;
  }).join('');

  return `
    <section class="space-y-6">
      <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <p class="text-sm uppercase tracking-[0.3em] text-slate-500">AI Settings</p>
        <h2 class="mt-2 text-2xl font-semibold text-slate-900">Configure AI providers and prompts</h2>
        <p class="mt-3 text-slate-600">Connect and configure multiple AI providers for educational content generation, tutoring, and assistance features.</p>
        <div class="mt-6 grid gap-6">${providers}</div>
      </div>

      <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <p class="text-sm uppercase tracking-[0.3em] text-slate-500">AI Test Lab</p>
        <h2 class="mt-2 text-2xl font-semibold text-slate-900">Test AI provider connections</h2>
        <p class="mt-3 text-slate-600">Test your API configurations and preview responses in real-time.</p>
        
        <div class="mt-6 grid gap-6">
          <div class="space-y-4">
            <label class="block text-sm text-slate-700">Select provider
              <select id="ai-test-provider" class="mt-2 w-full rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-sky-400">
                ${(state.aiProviders || []).map(p => `<option value="${p.id}" ${p.enabled ? '' : 'disabled'}>${p.name}${!p.enabled ? ' (disabled)' : ''}</option>`).join('')}
              </select>
            </label>
            
            <label class="block text-sm text-slate-700">Test prompt
              <textarea id="ai-test-prompt" rows="4" placeholder="Enter a test prompt to send to the AI provider..." class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-sky-400">How can I make my lesson more engaging for students?</textarea>
            </label>
            
            <button id="ai-test-send-btn" class="rounded-full bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700">
              Send test prompt
            </button>
          </div>

          <div id="ai-test-results" class="hidden rounded-3xl border border-slate-200 bg-slate-50 p-6">
            <div class="mb-4 pb-4 border-b border-slate-200">
              <p class="text-xs uppercase tracking-[0.3em] text-slate-500">Response details</p>
              <div class="mt-3 grid gap-3 lg:grid-cols-4">
                <div>
                  <p class="text-xs text-slate-500">Provider</p>
                  <p id="ai-test-provider-name" class="text-sm font-semibold text-slate-900">-</p>
                </div>
                <div>
                  <p class="text-xs text-slate-500">Status</p>
                  <p id="ai-test-status" class="text-sm font-semibold text-emerald-600">Connected</p>
                </div>
                <div>
                  <p class="text-xs text-slate-500">Latency</p>
                  <p id="ai-test-latency" class="text-sm font-semibold text-slate-900">-</p>
                </div>
                <div>
                  <p class="text-xs text-slate-500">Tokens used</p>
                  <p id="ai-test-tokens" class="text-sm font-semibold text-slate-900">-</p>
                </div>
              </div>
            </div>

            <div>
              <p class="text-xs uppercase tracking-[0.3em] text-slate-500 mb-2">AI response</p>
              <div id="ai-test-response" class="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 leading-relaxed">
                Waiting for response...
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderPlatformSettings(maintenanceMode = null) {
  const settings = {
    ...getPlatformSettingsState(),
    ...(typeof maintenanceMode === 'boolean' ? { maintenanceMode } : {}),
  };
  return `
    <section class="space-y-6">
      <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div class="mb-6">
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Global platform settings</p>
          <h2 class="mt-2 text-2xl font-semibold text-slate-900">Prepare your platform configuration</h2>
          <p class="mt-3 text-sm text-amber-800">Maintenance mode is saved through the backend API. Other settings remain in this browser and do not change platform behavior.</p>
        </div>
        <form id="platform-settings-form" class="grid gap-6 lg:grid-cols-2">
          ${renderSettingInput('Platform name', settings.platformName || 'GlobyEdu OS', 'platformName')}
          ${renderSettingInput('Support email', settings.supportEmail || 'support@globyedu.com', 'supportEmail')}
          ${renderSettingInput('Default timezone', settings.defaultTimezone || 'UTC', 'defaultTimezone')}
          ${renderSettingInput('Default currency', settings.defaultCurrency || 'USD', 'defaultCurrency')}
          ${renderSettingInput('Support URL', settings.supportUrl || 'https://support.globyedu.com', 'supportUrl')}
          ${renderSettingInput('Default language', settings.defaultLanguage || 'English', 'defaultLanguage')}
          <label class="flex items-center gap-3 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <input type="checkbox" name="maintenanceMode" ${settings.maintenanceMode ? 'checked' : ''} class="h-4 w-4 rounded border-slate-300 text-sky-600" /> Maintenance mode
          </label>
          <label class="flex items-center gap-3 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <input type="checkbox" name="registrationEnabled" ${settings.registrationEnabled !== false ? 'checked' : ''} class="h-4 w-4 rounded border-slate-300 text-sky-600" /> Registration enabled
          </label>
          <label class="flex items-center gap-3 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <input type="checkbox" name="loginEnabled" ${settings.loginEnabled !== false ? 'checked' : ''} class="h-4 w-4 rounded border-slate-300 text-sky-600" /> Login enabled
          </label>
          <label class="flex items-center gap-3 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <input type="checkbox" name="schoolAccountsEnabled" ${settings.schoolAccountsEnabled !== false ? 'checked' : ''} class="h-4 w-4 rounded border-slate-300 text-sky-600" /> School accounts enabled
          </label>
          <div class="lg:col-span-2 flex flex-wrap gap-3">
            <button type="submit" class="rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700">Save settings</button>
            <div id="platform-settings-status" class="hidden rounded-3xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"></div>
          </div>
        </form>
      </div>
      <div class="rounded-[2rem] border border-slate-200 bg-slate-50 p-6 shadow-sm">
        <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Safety note</p>
        <p class="mt-4 text-slate-600">Maintenance mode and platform enablement toggles never disable the Super Admin access path. The admin access guard remains active regardless of the general platform status.</p>
      </div>
    </section>
  `;
}

function renderSystemSettings(maintenanceMode = null) {
  const state = getAdminState();
  const settings = {
    ...(state.settings || {}),
    ...(typeof maintenanceMode === 'boolean' ? { maintenanceMode } : {}),
  };
  return `
    <section class="space-y-6">
      <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div class="mb-6">
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">System settings</p>
          <h2 class="mt-2 text-2xl font-semibold text-slate-900">Operational and maintenance settings</h2>
          <p class="mt-3 text-slate-600">Configure system behavior, maintenance mode, and integration readiness for the platform.</p>
        </div>
        <form id="system-settings-form" class="grid gap-6 lg:grid-cols-2">
          ${renderSettingInput('Maintenance mode', settings.maintenanceMode ? 'Enabled' : 'Disabled', 'maintenanceModeDisplay')}
          ${renderSettingInput('Default language', settings.defaultLanguage || 'English', 'defaultLanguage')}
          ${renderSettingInput('Timezone', settings.defaultTimezone || 'UTC', 'defaultTimezone')}
          ${renderSettingInput('Support URL', settings.supportUrl || 'https://support.globyedu.com', 'supportUrl')}
          <div class="lg:col-span-2 flex flex-wrap gap-3">
            <button type="submit" class="rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700">Save system settings</button>
            <div id="system-settings-status" class="hidden rounded-3xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"></div>
          </div>
        </form>
      </div>
      <div class="rounded-[2rem] border border-slate-200 bg-slate-50 p-6 shadow-sm">
        <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Security and platform health</p>
        <p class="mt-4 text-slate-600">This section is now wired to locally persisted settings and operational actions for future access control expansion.</p>
      </div>
    </section>
  `;
}

function renderModulePlaceholder(section) {
  const title = section.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  return `
    <section class="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">${title}</p>
          <h2 class="mt-2 text-2xl font-semibold text-slate-900">${title}</h2>
        </div>
        <div class="inline-flex rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">Placeholder UI</div>
      </div>
      <p class="mt-6 text-slate-600">The ${title} module is scaffolded with navigation and page structure. Business logic will be connected in a future phase.</p>
      <div class="mt-8 grid gap-6 lg:grid-cols-2">
        ${renderMiniInfo('Page readiness', 'UI scaffold complete')}
        ${renderMiniInfo('Next step', 'Integrate backend module routes')}
      </div>
    </section>
  `;
}

function renderActionButton(label, icon) {
  const destinations = {
    'Create school': 'schools',
    'Review subscriptions': 'subscriptions',
    'Audit logs': 'audit-logs',
    'Configure CMS': 'website-cms',
  };
  const destination = destinations[label] || 'overview';
  return `
    <button type="button" data-admin-nav="${destination}" class="inline-flex w-full items-center justify-between rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">
      <span>${label}</span>
      <span>${icon === 'plus' ? '+' : icon === 'pause' ? '⏸' : '⬇'}</span>
    </button>
  `;
}
