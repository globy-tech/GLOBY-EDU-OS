// register-wizard.js
// Enterprise-grade multi-step registration wizard for creating a school tenant.

import { register as apiRegister } from '../api/auth.js';
import { validateImageUpload } from '../utils/file-upload-validation.js';

const COUNTRY_OPTIONS = [
  'Ghana', 'Nigeria', 'Kenya', 'Uganda', 'South Africa', 'United Kingdom', 'United States', 'Canada', 'India', 'Australia', 'Rwanda', 'Tanzania', 'Zambia', 'Egypt', 'Morocco',
];

function getPasswordStrength(password) {
  if (!password) return { score: 0, label: 'Enter a password', tone: 'slate' };
  const checks = [/.{8,}/, /[A-Z]/, /[a-z]/, /\d/, /[^A-Za-z0-9]/];
  const score = checks.filter((regex) => regex.test(password)).length;
  if (score <= 2) return { score, label: 'Weak', tone: 'rose' };
  if (score === 3 || score === 4) return { score, label: 'Good', tone: 'amber' };
  return { score, label: 'Strong', tone: 'emerald' };
}

function setFieldError(id, message = '') {
  const field = document.getElementById(id);
  if (!field) return;
  const wrapper = field.closest('label') || field.parentElement;
  const existing = wrapper.querySelector('.field-error');
  if (existing) existing.remove();
  if (message) {
    const node = document.createElement('p');
    node.className = 'field-error mt-2 text-sm text-rose-600';
    node.textContent = message;
    wrapper.appendChild(node);
  }
}

function clearFieldErrors() {
  document.querySelectorAll('.field-error').forEach((node) => node.remove());
}

function readFormValues() {
  return {
    schoolName: document.getElementById('school-name').value.trim(),
    schoolType: document.getElementById('school-type').value,
    country: document.getElementById('school-country').value.trim(),
    currency: document.getElementById('school-currency').value,
    state: document.getElementById('school-state').value.trim(),
    city: document.getElementById('school-city').value.trim(),
    address: document.getElementById('school-address') ? document.getElementById('school-address').value.trim() : '',
    phone: document.getElementById('school-phone').value.trim(),
    email: document.getElementById('school-email').value.trim().toLowerCase(),
    website: document.getElementById('school-website').value.trim() || null,
    head: {
      fullName: document.getElementById('head-fullname').value.trim(),
      title: document.getElementById('head-title').value.trim() || null,
      email: document.getElementById('head-email').value.trim().toLowerCase(),
      phone: document.getElementById('head-phone').value.trim(),
      password: document.getElementById('head-password').value,
      confirmPassword: document.getElementById('head-password-confirm').value,
    },
    academicCalendar: document.getElementById('academic-calendar').value.trim() || null,
    schoolNotes: document.getElementById('school-notes').value.trim() || null,
    agreements: {
      terms: document.getElementById('agree-terms').checked,
      privacy: document.getElementById('agree-privacy').checked,
      emailVerification: document.getElementById('agree-email-verification').checked,
      acceptableUse: document.getElementById('agree-acceptable-use').checked,
      updates: document.getElementById('agree-updates').checked,
    },
  };
}

function createPlaceholderLogo(schoolName = 'GlobyEdu') {
  const displayName = String(schoolName || 'GlobyEdu').trim().slice(0, 2).toUpperCase();
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">
      <rect width="320" height="320" rx="48" fill="#0f172a" />
      <rect x="34" y="34" width="252" height="252" rx="36" fill="#0ea5e9" opacity="0.16" />
      <path d="M110 220V130l50-30 50 30v90" fill="none" stroke="#f8fafc" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M110 220h100" stroke="#f8fafc" stroke-width="16" stroke-linecap="round" />
      <circle cx="160" cy="128" r="22" fill="#f8fafc" />
      <text x="160" y="278" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="28" font-weight="700" fill="#f8fafc">${displayName}</text>
    </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export function RegisterWizardPage() {
  return `
    <main class="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div class="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-2xl shadow-slate-200/50">
        <div class="bg-gradient-to-r from-sky-600 via-sky-500 to-cyan-500 px-6 py-8 text-white sm:px-10">
          <p class="text-sm uppercase tracking-[0.35em] text-sky-100">Create Your School Account</p>
          <h1 class="mt-3 text-3xl font-semibold sm:text-4xl">Launch a secure tenant in four professional steps</h1>
          <p class="mt-3 max-w-2xl text-sm text-sky-50 sm:text-base">The onboarding experience is designed for enterprise SaaS use, with tenant isolation, trial activation, and a guided school authority setup.</p>
        </div>
        <div class="px-6 py-8 sm:px-10">
          <div class="mb-8">
            <div class="h-2 overflow-hidden rounded-full bg-slate-100">
              <div id="wizard-progress-bar" class="h-2 w-0 rounded-full bg-sky-600 transition-all duration-300"></div>
            </div>
            <div class="mt-4 flex flex-col gap-2 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
              <span id="wizard-progress-label">Step 1 of 4</span>
              <span id="wizard-step-title">School information</span>
            </div>
          </div>

          <form id="register-wizard" class="space-y-6">
            <section data-step="0" class="wizard-step">
              <div class="mb-4 flex items-center justify-between">
                <h2 class="text-xl font-semibold text-slate-900">1. School information</h2>
                <span class="rounded-full bg-sky-50 px-3 py-1 text-sm font-medium text-sky-700">Required</span>
              </div>
              <div class="grid gap-4 lg:grid-cols-2">
                <label class="block text-sm text-slate-700">School Name<input id="school-name" data-required class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100" placeholder="e.g. Bright Future Academy" /></label>
                <label class="block text-sm text-slate-700">School Type<select id="school-type" data-required class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"><option value="Primary">Primary</option><option value="JHS">JHS</option><option value="SHS">SHS</option><option value="College">College</option><option value="University">University</option><option value="International">International</option><option value="Other">Other</option></select></label>
                <label class="block text-sm text-slate-700">Country<input list="country-list" id="school-country" data-required class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100" placeholder="Search or choose a country" /></label>
                <label class="block text-sm text-slate-700">Preferred currency<select id="school-currency" data-required class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"><option value="GHS">GHS - Ghana cedi</option><option value="NGN">NGN - Nigerian naira</option><option value="KES">KES - Kenyan shilling</option><option value="UGX">UGX - Ugandan shilling</option><option value="ZAR">ZAR - South African rand</option><option value="USD">USD - US dollar</option><option value="GBP">GBP - Pound sterling</option><option value="EUR">EUR - Euro</option></select></label>
                <label class="block text-sm text-slate-700">Region / State<input id="school-state" data-required class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100" placeholder="e.g. Greater Accra" /></label>
                <label class="block text-sm text-slate-700">City / Town<input id="school-city" data-required class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100" placeholder="e.g. Accra" /></label>
                <label class="block text-sm text-slate-700">School Email<input id="school-email" type="email" data-required class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100" placeholder="admin@school.edu" /></label>
                <label class="block text-sm text-slate-700">School Phone<input id="school-phone" data-required class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100" placeholder="+233 200 000 000" /></label>
                <label class="block text-sm text-slate-700">Website (optional)<input id="school-website" class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100" placeholder="https://" /></label>
              </div>
              <datalist id="country-list">${COUNTRY_OPTIONS.map((country) => `<option value="${country}" />`).join('')}</datalist>
            </section>

            <section data-step="1" class="wizard-step hidden">
              <div class="mb-4 flex items-center justify-between">
                <h2 class="text-xl font-semibold text-slate-900">2. School authority information</h2>
                <span class="rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">Secure access</span>
              </div>
              <div class="grid gap-4 lg:grid-cols-2">
                <label class="block text-sm text-slate-700">Full Name<input id="head-fullname" data-required class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100" placeholder="Jane Doe" /></label>
                <label class="block text-sm text-slate-700">Position / Title<input id="head-title" class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100" placeholder="Principal, Headteacher, Director" /></label>
                <label class="block text-sm text-slate-700">Email<input id="head-email" type="email" data-required class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100" placeholder="head@school.edu" /></label>
                <label class="block text-sm text-slate-700">Phone Number<input id="head-phone" data-required class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100" placeholder="+233 200 000 001" /></label>
                <label class="block text-sm text-slate-700">Password<div class="mt-2 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 transition focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-100"><input id="head-password" type="password" data-required class="w-full bg-transparent text-slate-900 outline-none" placeholder="Create a strong password" /><button type="button" id="toggle-password" class="text-sm font-semibold text-sky-600">Show</button></div></label>
                <label class="block text-sm text-slate-700">Confirm Password<div class="mt-2 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 transition focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-100"><input id="head-password-confirm" type="password" data-required class="w-full bg-transparent text-slate-900 outline-none" placeholder="Repeat password" /><button type="button" id="toggle-password-confirm" class="text-sm font-semibold text-sky-600">Show</button></div></label>
              </div>
              <div id="password-meter" class="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600"></div>
            </section>

            <section data-step="2" class="wizard-step hidden">
              <div class="mb-4 flex items-center justify-between">
                <h2 class="text-xl font-semibold text-slate-900">3. School branding</h2>
                <span class="rounded-full bg-violet-50 px-3 py-1 text-sm font-medium text-violet-700">Optional</span>
              </div>
              <div id="branding-dropzone" class="rounded-[2rem] border border-dashed border-slate-300 bg-slate-50 p-6 text-center transition hover:border-sky-400 hover:bg-sky-50">
                <input id="school-logo-input" type="file" accept="image/*" class="hidden" />
                <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-sm">
                  <span class="text-2xl">🖼️</span>
                </div>
                <p class="mt-4 text-lg font-semibold text-slate-900">Upload your school logo</p>
                <p class="mt-2 text-sm text-slate-600">Drag and drop an image, or choose one from your device. Camera capture is supported on mobile devices.</p>
                <div class="mt-5 flex flex-wrap justify-center gap-3">
                  <button type="button" id="logo-choose" class="rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700">Choose image</button>
                  <button type="button" id="logo-skip" class="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">Skip</button>
                </div>
                <div id="logo-preview" class="mt-5 flex justify-center"></div>
                <p id="logo-message" class="mt-4 text-sm text-slate-500">Recommended: PNG or JPG.</p>
              </div>
              <div class="mt-4 grid gap-4 lg:grid-cols-2">
                <label class="block text-sm text-slate-700">Academic Calendar<input id="academic-calendar" class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100" placeholder="e.g. Term dates, semester system" /></label>
                <label class="block text-sm text-slate-700">Notes (optional)<textarea id="school-notes" class="mt-2 min-h-24 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100" placeholder="Any onboarding notes for your tenant"></textarea></label>
              </div>
            </section>

            <section data-step="3" class="wizard-step hidden">
              <div class="mb-4 flex items-center justify-between">
                <h2 class="text-xl font-semibold text-slate-900">4. Review & submit</h2>
                <span class="rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-700">Confirm details</span>
              </div>
              <div id="review-summary" class="rounded-[2rem] border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700"></div>
              <div class="mt-4 space-y-3">
                <label class="inline-flex w-full items-start gap-3 rounded-3xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
                  <input type="checkbox" id="agree-terms" data-required class="mt-1 h-5 w-5 rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
                  <span>I accept the ${'<a href="#/legal/terms" class="font-semibold text-sky-700">Terms of Service</a>'}.</span>
                </label>
                <label class="inline-flex w-full items-start gap-3 rounded-3xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
                  <input type="checkbox" id="agree-privacy" data-required class="mt-1 h-5 w-5 rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
                  <span>I accept the ${'<a href="#/legal/privacy" class="font-semibold text-sky-700">Privacy Policy</a>'}.</span>
                </label>
                <label class="inline-flex w-full items-start gap-3 rounded-3xl border border-sky-200 bg-sky-50 p-4 text-sm text-slate-700">
                  <input type="checkbox" id="agree-email-verification" data-required class="mt-1 h-5 w-5 rounded border-sky-300 text-sky-600 focus:ring-sky-500" />
                  <span>I understand that my school authority account must be verified by email before I can sign in. A verification link will be sent to the email address above.</span>
                </label>
                <label class="inline-flex w-full items-start gap-3 rounded-3xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
                  <input type="checkbox" id="agree-acceptable-use" data-required class="mt-1 h-5 w-5 rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
                  <span>I accept the Acceptable Use Policy.</span>
                </label>
                <label class="inline-flex w-full items-start gap-3 rounded-3xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
                  <input type="checkbox" id="agree-updates" class="mt-1 h-5 w-5 rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
                  <span>Send me product updates and newsletters.</span>
                </label>
              </div>
            </section>

            <div class="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div class="flex gap-3">
                <button type="button" id="wizard-prev" class="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">Back</button>
                <button type="button" id="wizard-next" class="rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700">Next</button>
              </div>
              <button type="submit" id="wizard-submit" class="hidden rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700">Create School Account</button>
            </div>
            <div id="wizard-message" class="mt-4 text-sm"></div>
            <div id="wizard-loading-overlay" class="fixed inset-0 z-50 hidden items-center justify-center bg-slate-950/70 px-4">
              <div class="w-full max-w-md rounded-[2rem] border border-white/10 bg-white p-8 text-center shadow-2xl">
                <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-sky-100">
                  <div class="h-8 w-8 animate-spin rounded-full border-4 border-sky-600 border-t-transparent"></div>
                </div>
                <h3 class="mt-6 text-xl font-semibold text-slate-900">Creating your school tenant</h3>
                <p class="mt-2 text-sm text-slate-600">We are provisioning the school workspace, trial access, and authority account. This usually completes in a few moments.</p>
              </div>
            </div>
          </form>
        </div>
      </div>
    </main>
  `;
}

export function attachRegisterWizardHandlers() {
  const form = document.getElementById('register-wizard');
  if (!form) return;
  const steps = Array.from(document.querySelectorAll('.wizard-step'));
  const progressBar = document.getElementById('wizard-progress-bar');
  const progressLabel = document.getElementById('wizard-progress-label');
  const stepTitle = document.getElementById('wizard-step-title');
  const messageSlot = document.getElementById('wizard-message');
  const stepNames = ['School information', 'School authority information', 'School branding', 'Review & submit'];
  const passwordMeter = document.getElementById('password-meter');
  const logoInput = document.getElementById('school-logo-input');
  const logoPreview = document.getElementById('logo-preview');
  const logoMessage = document.getElementById('logo-message');
  const reviewSummary = document.getElementById('review-summary');
  const loadingOverlay = document.getElementById('wizard-loading-overlay');
  let current = 0;
  let logoDataUrl = '';

  async function uploadSchoolBrandAsset(file, schoolId) {
    const validationError = validateImageUpload(file);
    if (validationError) throw new Error(validationError);
    const token = localStorage.getItem('globyedu_accessToken');
    if (!token) throw new Error('Your session has expired. Please sign in again.');

    const safeName = String(file.name || 'school-logo.png').replace(/\\/g, '/').split('/').pop().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'school-logo.png';
    const storagePath = `school-branding/${Date.now()}-${safeName}`;

    const uploadQuery = new URLSearchParams({
      filename: storagePath,
      ownerType: 'school',
      ownerId: schoolId || '',
      ownerField: 'logoPath',
    });
    const uploadResponse = await fetch(`/api/v1/files/upload?${uploadQuery.toString()}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': file.type || 'application/octet-stream',
      },
      body: file,
    });

    const uploadData = await uploadResponse.json().catch(() => null);
    if (!uploadResponse.ok || uploadData?.status !== 'ok') {
      throw new Error(uploadData?.message || 'Unable to upload the school logo to cloud storage.');
    }
    if (!uploadData.path) throw new Error('The uploaded school logo path could not be saved.');

    const signedUrlResponse = await fetch(`/api/v1/files/${encodeURIComponent(storagePath)}?expiresIn=86400`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    const signedUrlData = await signedUrlResponse.json().catch(() => null);
    if (!signedUrlResponse.ok || signedUrlData?.status !== 'ok' || !signedUrlData.url) {
      throw new Error(signedUrlData?.message || 'The uploaded school logo could not be published.');
    }

    return { url: signedUrlData.url, path: uploadData.path };
  }

  function renderProgress(index = 0) {
    const percent = ((index + 1) / steps.length) * 100;
    progressBar.style.width = `${percent}%`;
    progressLabel.textContent = `Step ${index + 1} of ${steps.length}`;
    stepTitle.textContent = stepNames[index];
  }

  function showStep(index) {
    steps.forEach((el, i) => el.classList.toggle('hidden', i !== index));
    document.getElementById('wizard-prev').disabled = index === 0;
    document.getElementById('wizard-next').classList.toggle('hidden', index === steps.length - 1);
    document.getElementById('wizard-submit').classList.toggle('hidden', index !== steps.length - 1);
    current = index;
    renderProgress(index);
    if (index === 3) {
      const values = readFormValues();
      reviewSummary.innerHTML = `
        <div class="grid gap-4 md:grid-cols-2">
          <div><p class="text-xs uppercase tracking-[0.3em] text-slate-500">School</p><p class="mt-2 font-semibold text-slate-900">${values.schoolName || '—'}</p><p class="mt-1 text-slate-600">${values.schoolType || '—'} • ${values.country || '—'}</p></div>
          <div><p class="text-xs uppercase tracking-[0.3em] text-slate-500">Authority</p><p class="mt-2 font-semibold text-slate-900">${values.head.fullName || '—'}</p><p class="mt-1 text-slate-600">${values.head.email || '—'}</p></div>
          <div><p class="text-xs uppercase tracking-[0.3em] text-slate-500">Location</p><p class="mt-2 font-semibold text-slate-900">${values.city || '—'}, ${values.state || '—'}</p><p class="mt-1 text-slate-600">${values.address || '—'}</p></div>
          <div><p class="text-xs uppercase tracking-[0.3em] text-slate-500">Trial</p><p class="mt-2 font-semibold text-slate-900">14-Day Trial</p><p class="mt-1 text-slate-600">Your tenant will be activated immediately.</p></div>
        </div>`;
    }
  }

  function validateCurrentStep() {
    clearFieldErrors();
    const active = steps[current];
    const elements = Array.from(active.querySelectorAll('[data-required]'));
    const values = readFormValues();
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phonePattern = /^\+?[0-9\s().-]{7,15}$/;

    for (const element of elements) {
      if (element.type === 'checkbox' && !element.checked) {
        setFieldError(element.id, 'Please accept this requirement to continue.');
        return false;
      }
      if (element.type !== 'checkbox' && !element.value.trim()) {
        const label = element.id.replace(/-/g, ' ');
        setFieldError(element.id, `${label.charAt(0).toUpperCase() + label.slice(1)} is required.`);
        return false;
      }
    }

    if (current === 1) {
      if (!emailPattern.test(values.head.email)) {
        setFieldError('head-email', 'Please enter a valid authority email.');
        return false;
      }
      if (!phonePattern.test(values.head.phone)) {
        setFieldError('head-phone', 'Please provide a valid phone number.');
        return false;
      }
      if (values.head.password !== values.head.confirmPassword) {
        setFieldError('head-password-confirm', 'Passwords do not match.');
        return false;
      }
      if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(values.head.password)) {
        setFieldError('head-password', 'Password must include uppercase, lowercase, number and symbol.');
        return false;
      }
    }

    if (current === 3) {
      if (!values.agreements.terms || !values.agreements.privacy) {
        messageSlot.innerHTML = '<div class="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-rose-800">Please accept the required agreements before submitting.</div>';
        return false;
      }
    }

    return true;
  }

  function updatePasswordMeter() {
    const password = document.getElementById('head-password').value;
    const strength = getPasswordStrength(password);
    passwordMeter.innerHTML = `<div class="flex items-center justify-between"><span class="font-medium text-slate-800">Password strength</span><span class="font-semibold text-${strength.tone}-600">${strength.label}</span></div><div class="mt-3 h-2 overflow-hidden rounded-full bg-slate-200"><div class="h-2 rounded-full bg-${strength.tone}-500 transition-all" style="width:${Math.max(20, strength.score * 20)}%"></div></div><p class="mt-2 text-xs text-slate-500">Use at least 8 characters with uppercase, lowercase, number and symbol.</p>`;
  }

  function setImagePreview(file) {
    if (!file) {
      logoDataUrl = createPlaceholderLogo(readFormValues().schoolName || 'GlobyEdu');
      logoPreview.innerHTML = `<img src="${logoDataUrl}" alt="Professional placeholder logo" class="h-24 w-24 rounded-2xl object-cover shadow-sm" />`;
      logoMessage.textContent = 'A polished placeholder logo will be used if you skip uploads.';
      return;
    }
    const validationError = validateImageUpload(file);
    if (validationError) {
      logoMessage.innerHTML = `<span class="text-rose-600">${validationError}</span>`;
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    logoDataUrl = '';
    logoPreview.innerHTML = `<img src="${previewUrl}" alt="School logo preview" class="h-24 w-24 rounded-2xl object-cover shadow-sm" />`;
    logoMessage.textContent = 'Preview ready. You can continue or choose a different image.';
  }

  document.getElementById('wizard-next').addEventListener('click', () => {
    if (!validateCurrentStep()) {
      messageSlot.innerHTML = '<div class="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-rose-800">Please complete the required fields before continuing.</div>';
      return;
    }
    messageSlot.innerHTML = '';
    showStep(Math.min(current + 1, steps.length - 1));
  });

  document.getElementById('wizard-prev').addEventListener('click', () => {
    showStep(Math.max(current - 1, 0));
  });

  document.querySelectorAll('.review-edit').forEach((button) => {
    button.addEventListener('click', () => showStep(Number(button.dataset.step)));
  });

  document.getElementById('head-password').addEventListener('input', updatePasswordMeter);
  document.getElementById('head-password-confirm').addEventListener('input', updatePasswordMeter);

  const attachPasswordToggle = (inputId, toggleId) => {
    const input = document.getElementById(inputId);
    const toggle = document.getElementById(toggleId);
    if (!input || !toggle) return;
    toggle.addEventListener('click', () => {
      const isVisible = input.type === 'text';
      input.type = isVisible ? 'password' : 'text';
      toggle.textContent = isVisible ? 'Show' : 'Hide';
    });
  };

  attachPasswordToggle('head-password', 'toggle-password');
  attachPasswordToggle('head-password-confirm', 'toggle-password-confirm');

  document.getElementById('logo-choose').addEventListener('click', () => logoInput.click());
  document.getElementById('logo-skip').addEventListener('click', () => {
    logoDataUrl = '';
    setImagePreview(null);
  });

  logoInput.addEventListener('change', (event) => {
    const [file] = event.target.files || [];
    setImagePreview(file);
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    document.getElementById('branding-dropzone').addEventListener(eventName, (event) => {
      event.preventDefault();
      document.getElementById('branding-dropzone').classList.add('border-sky-400', 'bg-sky-50');
    });
  });
  ['dragleave', 'drop'].forEach((eventName) => {
    document.getElementById('branding-dropzone').addEventListener(eventName, (event) => {
      event.preventDefault();
      document.getElementById('branding-dropzone').classList.remove('border-sky-400', 'bg-sky-50');
    });
  });
  document.getElementById('branding-dropzone').addEventListener('drop', (event) => {
    const [file] = event.dataTransfer.files || [];
    setImagePreview(file);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    messageSlot.innerHTML = '';
    const submitBtn = document.getElementById('wizard-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating account...';
    loadingOverlay.classList.remove('hidden');
    loadingOverlay.classList.add('flex');

    if (!validateCurrentStep()) {
      messageSlot.innerHTML = '<div class="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-rose-800">Please review the required fields before submitting.</div>';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create School Account';
      return;
    }

    const values = readFormValues();
    const selectedLogoFile = logoInput && logoInput.files && logoInput.files[0] ? logoInput.files[0] : null;
    const payloadLogo = selectedLogoFile ? null : logoDataUrl || null;

    try {
      const payload = {
        ...values,
        logo: payloadLogo || null,
        schoolName: values.schoolName,
        head: values.head,
        agreements: values.agreements,
      };

      const result = await apiRegister(payload);
      if (result.ok && result.data?.status === 'pending_verification') {
        loadingOverlay.classList.add('hidden');
        loadingOverlay.classList.remove('flex');
        const notice = document.createElement('div');
        notice.className = 'rounded-2xl border border-sky-100 bg-sky-50 p-5 text-sky-950';
        notice.setAttribute('role', 'status');

        const heading = document.createElement('p');
        heading.className = 'font-semibold';
        heading.textContent = 'Email verification is required before sign-in';
        const instructions = document.createElement('p');
        instructions.className = 'mt-2 text-sm';
        instructions.textContent = `We sent a verification link to ${result.data.verificationEmail || values.head.email}. Open that link to activate the account. New school accounts cannot sign in until their email is verified.`;
        const schoolId = document.createElement('p');
        schoolId.className = 'mt-2 text-sm';
        schoolId.textContent = `School ID: ${result.data.schoolId}. You will need it to sign in after verification.`;
        const loginLink = document.createElement('a');
        loginLink.href = '#/login';
        loginLink.className = 'mt-4 inline-flex font-semibold text-sky-800 underline underline-offset-4';
        loginLink.textContent = 'Go to sign in';

        notice.append(heading, instructions, schoolId, loginLink);
        messageSlot.replaceChildren(notice);
        submitBtn.disabled = true;
        submitBtn.textContent = 'Verification email sent';
        return;
      }

      if (!result.ok || result.data?.status !== 'ok') {
        loadingOverlay.classList.add('hidden');
        loadingOverlay.classList.remove('flex');
        messageSlot.innerHTML = `<div class="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-rose-800">${result.data?.message || 'We could not create your school account right now. Please try again.'}</div>`;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create School Account';
        return;
      }

      localStorage.setItem('globyedu_accessToken', result.data.accessToken || '');
      localStorage.setItem('globyedu_userRole', 'school_authority');
      localStorage.setItem('globyedu_platformAdmin', 'false');
      localStorage.setItem('globyedu_userEmail', values.head.email);
      localStorage.setItem('globyedu_userFullName', values.head.fullName);
      localStorage.setItem('globyedu_schoolId', result.data.schoolId || '');
      localStorage.setItem('globyedu_schoolName', values.schoolName);
      localStorage.setItem('globyedu_trialEnds', result.data.trialEndsAt || '');
      localStorage.setItem('globyedu_trialStatus', result.data.trialStatus || '14-Day Trial');
      localStorage.setItem('globyedu_accountStatus', result.data.accountStatus || 'trial');
      sessionStorage.setItem('globyedu_sessionActive', 'true');
      let logoUploadWarning = '';
      if (selectedLogoFile) {
        try {
          const uploadedLogo = await uploadSchoolBrandAsset(selectedLogoFile, result.data.schoolId);
          const logoResponse = await fetch(`/api/v1/schools/${encodeURIComponent(result.data.schoolId || '')}`, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${result.data.accessToken || ''}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ logo: uploadedLogo.url, logoPath: uploadedLogo.path }),
          });
          const logoData = await logoResponse.json().catch(() => null);
          if (!logoResponse.ok || logoData?.status !== 'ok') throw new Error(logoData?.message || 'Unable to save the school logo.');
        } catch (error) {
          logoUploadWarning = 'The school was created, but its logo could not be uploaded. You can add it from the school profile.';
        }
      }
      loadingOverlay.innerHTML = `
        <div class="w-full max-w-lg rounded-[2rem] border border-white/10 bg-white p-8 text-center shadow-2xl">
          <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl">✓</div>
          <h3 class="mt-6 text-2xl font-semibold text-slate-900">Welcome to GlobyEdu</h3>
          <p class="mt-2 text-sm text-slate-600">Your school has been created successfully. A 14-day trial is now active.</p>
          <div class="mt-6 rounded-2xl bg-slate-50 p-4 text-left text-sm text-slate-700">
            <p><span class="font-semibold">School:</span> ${values.schoolName}</p>
            <p class="mt-2"><span class="font-semibold">School ID:</span> ${result.data.schoolId || 'GLB-2026-00001'}</p>
            <p class="mt-2"><span class="font-semibold">Trial expiry:</span> ${result.data.trialEndsAt ? new Date(result.data.trialEndsAt).toLocaleDateString() : '14 days from now'}</p>
          </div>
          <p class="mt-6 text-sm text-slate-500">Taking you to your dashboard now.</p>
          ${logoUploadWarning ? `<p class="mt-3 text-sm text-amber-700">${logoUploadWarning}</p>` : ''}
        </div>`;
      setTimeout(() => {
        location.hash = '#/school/overview';
      }, 1400);
    } catch (error) {
      loadingOverlay.classList.add('hidden');
      loadingOverlay.classList.remove('flex');
      messageSlot.innerHTML = '<div class="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-rose-800">Submission failed. Please try again.</div>';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create School Account';
    }
  });

  updatePasswordMeter();
  showStep(0);
}
