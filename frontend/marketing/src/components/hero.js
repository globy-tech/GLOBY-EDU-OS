// hero.js
// Hero section for the marketing homepage, focused on the first impression.

import { heroDashboardImage } from '../assets/asset-paths.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function Hero(cms = {}) {
  const title = escapeHtml(cms.heroTitle || 'The premium operating system for modern schools.');
  const subtitle = escapeHtml(cms.heroSubtitle || 'Unify admissions, attendance, lesson planning, finance, messaging, and reporting in one elegant school operations experience built for growth.');
  const companyName = escapeHtml(cms.companyName || 'GlobyEdu OS');
  const heroImage = cms.heroImage || heroDashboardImage;
  const highlights = ['Admissions', 'Attendance', 'Finance', 'Reporting'];
  const values = ['Secure by design', 'Cloud-first platform', 'Multi-tenant scale', 'Role-based access'];

  return `
  <section class="relative overflow-hidden pt-8 pb-16 sm:pt-10 lg:pt-14 lg:pb-20">
    <div class="hero-mesh absolute inset-0"></div>
    <div class="relative mx-auto max-w-7xl px-6">
      <div class="grid gap-8 lg:grid-cols-[minmax(0,0.56fr)_minmax(0,0.44fr)] lg:items-start">
        <div class="min-w-0 pt-2 lg:pt-4">
          <div class="inline-flex items-center gap-2 rounded-full border border-sky-100 bg-sky-50/90 px-4 py-2 text-sm font-semibold text-sky-700 shadow-sm shadow-sky-100">
            <span class="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
            ${companyName.toUpperCase()} • Trusted • Enterprise
          </div>

          <div class="mt-6">
            <h1 class="text-4xl leading-tight font-extrabold tracking-tight text-slate-900 sm:text-6xl lg:text-6xl">${title}</h1>
            <p class="mt-6 max-w-2xl text-xl leading-8 text-slate-600">${subtitle}</p>
          </div>

          <div class="mt-8 flex gap-4">
            <button data-action="get-started" class="btn btn-primary">Get Started</button>
            <button data-action="request-demo" class="btn btn-secondary">Book a demo</button>
          </div>

          <div class="mt-8 flex flex-wrap gap-x-4 gap-y-3 text-sm text-muted">
            ${values.map((v) => `<div class="flex items-center gap-3"><svg class="icon" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#10B981" stroke-width="1.6"></circle></svg><span>${v}</span></div>`).join('')}
          </div>
        </div>

        <div class="relative flex justify-end lg:justify-center">
          <div class="relative w-full max-w-160 card shadow-hero">
            <div class="p-4 sm:p-6 card-tight">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-xs uppercase tracking-[0.35em] text-slate-400">Dashboard preview</p>
                  <h3 class="mt-2 text-lg font-semibold text-slate-900">Live school insights</h3>
                </div>
                <div class="text-xs text-slate-500">Cloud</div>
              </div>

              <div class="dashboard-preview-media mt-4 overflow-hidden rounded-lg card-media skeleton" data-skeleton>
                <img src="${heroImage}" alt="Dashboard preview" loading="lazy" decoding="async" class="block h-auto w-full bg-slate-100 object-contain" onload="this.closest('[data-skeleton]').classList.remove('skeleton')"/>
              </div>

              <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div class="stat-card text-center"><div class="text-sm text-muted">Students</div><div class="mt-1 text-lg font-semibold">1,248</div></div>
                <div class="stat-card text-center"><div class="text-sm text-muted">Attendance</div><div class="mt-1 text-lg font-semibold">98%</div></div>
                <div class="stat-card text-center"><div class="text-sm text-muted">Fees</div><div class="mt-1 text-lg font-semibold">$24,860</div></div>
              </div>

              <div class="mt-5 grid gap-3 sm:grid-cols-2">
                <div class="rounded-[1.75rem] border border-slate-200 bg-slate-50 p-4 text-left">
                  <p class="text-xs uppercase tracking-[0.35em] text-slate-500">Live alerts</p>
                  <p class="mt-2 text-sm text-slate-700">2 new teacher messages waiting</p>
                </div>
                <div class="rounded-[1.75rem] border border-slate-200 bg-slate-50 p-4 text-left">
                  <p class="text-xs uppercase tracking-[0.35em] text-slate-500">Workflow pace</p>
                  <p class="mt-2 text-sm text-slate-700">Attendance reviewed for 14 classes today</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
  `;
}
