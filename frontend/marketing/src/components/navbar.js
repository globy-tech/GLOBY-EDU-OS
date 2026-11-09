// navbar.js
// Responsive marketing navigation for the GlobyEdu SaaS homepage.

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function Nav(cms = {}) {
  const companyName = String(cms.companyName || 'GlobyEdu OS').trim() || 'GlobyEdu OS';
  const configuredLogo = String(cms.logoUrl || '').trim();
  const defaultLogo = '/src/assets/images/ui/globyedu-logo.jpg';
  const logoUrl = configuredLogo && configuredLogo !== 'null' && configuredLogo !== 'undefined'
    ? configuredLogo
    : defaultLogo;
  const safeLogoUrl = escapeHtml(logoUrl);
  const safeCompanyName = escapeHtml(companyName);
  return `
  <header class="sticky top-0 z-50 border-b border-slate-200/70 bg-white/85 backdrop-blur-xl shadow-sm">
    <div class="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
      <div class="flex items-center gap-4">
        <div class="flex items-center gap-3">
          ${safeLogoUrl ? `<img src="${safeLogoUrl}" alt="${safeCompanyName} logo" class="h-11 w-11 rounded-2xl border border-slate-200 bg-white object-contain p-1 shadow-sm sm:h-12 sm:w-12" onerror="this.onerror=null;this.src='${defaultLogo}'" />` : `<div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-600 to-emerald-500 text-xl font-bold text-white shadow-lg shadow-sky-500/10 sm:h-12 sm:w-12">G</div>`}
          <div>
            <div class="text-lg font-semibold text-slate-900">${safeCompanyName}</div>
            <div class="text-xs uppercase tracking-[0.25em] text-slate-500">School operating system</div>
          </div>
        </div>
      </div>

      <nav class="hidden items-center gap-6 xl:flex">
        <a href="#/home" data-scroll="home" class="text-sm font-medium text-slate-700 transition hover:text-slate-900">Home</a>
        <a href="#/features" data-scroll="features" class="text-sm font-medium text-slate-700 transition hover:text-slate-900">Features</a>
        <a href="#/solutions" data-scroll="solutions" class="text-sm font-medium text-slate-700 transition hover:text-slate-900">Solutions</a>
        <a href="#/pricing" data-scroll="pricing" class="text-sm font-medium text-slate-700 transition hover:text-slate-900">Pricing</a>
        <a href="#/about" data-scroll="about" class="text-sm font-medium text-slate-700 transition hover:text-slate-900">About</a>
        <a href="#/contact" data-scroll="contact" class="text-sm font-medium text-slate-700 transition hover:text-slate-900">Contact</a>
      </nav>

      <div class="hidden items-center gap-3 xl:flex">
        <button id="theme-toggle" aria-label="Toggle theme" class="btn btn-ghost" title="Toggle theme"> 
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="4"/></svg>
        </button>
        <a href="#/login" class="btn btn-secondary" role="button">Login</a>
        <button data-action="get-started" class="btn btn-primary">Get Started</button>
      </div>

      <button id="mobile-menu-toggle" aria-label="Open menu" class="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-sm xl:hidden">
        <svg width="24" height="24" fill="none" stroke="currentColor" class="text-slate-700"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
      </button>
    </div>

      <div id="mobile-menu" class="hidden border-t border-slate-200/70 bg-white/95 xl:hidden" aria-hidden="true">
      <div class="px-6 py-5 flex flex-col gap-4">
        <a href="#/home" data-scroll="home" class="block rounded-2xl px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100">Home</a>
        <a href="#/features" data-scroll="features" class="block rounded-2xl px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100">Features</a>
        <a href="#/solutions" data-scroll="solutions" class="block rounded-2xl px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100">Solutions</a>
        <a href="#/pricing" data-scroll="pricing" class="block rounded-2xl px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100">Pricing</a>
        <a href="#/about" data-scroll="about" class="block rounded-2xl px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100">About</a>
        <a href="#/contact" data-scroll="contact" class="block rounded-2xl px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100">Contact</a>
        <a href="#/login" class="block rounded-2xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white text-center">Login</a>
        <button data-action="get-started" class="block rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900 bg-slate-50">Get Started</button>
      </div>
    </div>
  </header>
  `;
}

// Toggle mobile menu after DOM mounts
document.addEventListener('click', (e) => {
  const toggle = document.getElementById('mobile-menu-toggle');
  const panel = document.getElementById('mobile-menu');
  if (!toggle || !panel) return;
  if (e.target.closest && e.target.closest('#mobile-menu-toggle')) {
    panel.classList.toggle('hidden');
  }
});

// Theme toggle wiring (architecture only) and active link indicator.
document.addEventListener('DOMContentLoaded', () => {
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const evt = new CustomEvent('globyedu-toggle-theme', { bubbles: true });
      document.dispatchEvent(evt);
    });
  }

  const updateActive = () => {
    const hash = location.hash || '#/home';
    document.querySelectorAll('nav a[data-scroll]').forEach((a) => {
      const section = a.getAttribute('data-scroll');
      if (!section) return;
      const shouldBeActive = hash.includes(section) || (section === 'home' && (hash === '#/' || hash === '#/home'));
      a.classList.toggle('text-sky-600', shouldBeActive);
      a.setAttribute('aria-current', shouldBeActive ? 'page' : 'false');
    });
  };

  updateActive();
  window.addEventListener('hashchange', updateActive);
});
