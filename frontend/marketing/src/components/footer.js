// footer.js
// Footer with branding and CMS-driven contact information.

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function Footer(cms = {}) {
  const companyName = escapeHtml(cms.companyName || 'GlobyEdu OS');
  const logoUrl = escapeHtml(cms.logoUrl || '/src/assets/images/ui/globyedu-logo.jpg');
  const contactEmail = escapeHtml(cms.contactEmail || 'hello@globyedu.com');
  const contactPhone = escapeHtml(cms.contactPhone || '+233 53 749 7607');
  const socialLinks = [
    { label: 'Facebook', url: 'https://www.facebook.com/share/18j4bKMorr/' },
    { label: 'X', url: 'https://x.com/GlobyTechndz' },
    { label: 'Instagram', url: 'https://www.instagram.com/globytechnologies?igsh=aWgwdGVocHFya3g3' },
  ];

  return `
    <footer class="mt-12 border-t bg-white" role="contentinfo" aria-label="Footer">
      <div class="mx-auto max-w-7xl px-6 py-12">
        <div class="grid grid-cols-1 gap-8 md:grid-cols-4">
          <div>
            <div class="flex items-center gap-3">
              ${logoUrl ? `<img src="${logoUrl}" alt="${companyName} logo" class="h-10 w-10 rounded-full border border-slate-200 bg-white object-contain p-1" onerror="this.onerror=null;this.src='/src/assets/images/ui/globyedu-logo.jpg'" />` : '<div class="flex h-10 w-10 items-center justify-center rounded-full bg-sky-600 font-bold text-white">G</div>'}
              <div>
                <div class="font-semibold text-slate-900">${companyName}</div>
                <div class="text-sm text-slate-500">School Operating System</div>
              </div>
            </div>
            <p class="mt-4 text-sm text-slate-600">Modern school operations: admissions, attendance, messaging, finance, and analytics — unified.</p>
            <div class="mt-4 space-y-1 text-sm text-slate-500">
              <p>${contactEmail}</p>
              <p>${contactPhone}</p>
            </div>
          </div>
          <div>
            <h4 class="text-sm font-semibold text-slate-900">Product</h4>
            <ul class="mt-4 space-y-2 text-sm text-slate-600">
              <li><a href="#/features" class="transition hover:text-slate-900">Features</a></li>
              <li><a href="#/pricing" class="transition hover:text-slate-900">Pricing</a></li>
              <li><a href="#/solutions" class="transition hover:text-slate-900">Solutions</a></li>
              <li><a href="#/overview" class="transition hover:text-slate-900">Platform overview</a></li>
            </ul>
          </div>
          <div>
            <h4 class="text-sm font-semibold text-slate-900">Resources</h4>
            <ul class="mt-4 space-y-2 text-sm text-slate-600">
              <li><a href="#/about" class="transition hover:text-slate-900">About</a></li>
              <li><a href="#/contact" class="transition hover:text-slate-900">Contact</a></li>
              <li><a href="#/faq" class="transition hover:text-slate-900">FAQ</a></li>
              <li><a href="#/docs" class="transition hover:text-slate-900">Documentation</a></li>
            </ul>
          </div>
          <div>
            <h4 class="text-sm font-semibold text-slate-900">Stay connected</h4>
              <p class="mt-4 text-sm text-slate-600">Subscribe for product updates, launch notes, and education insights.</p>
              <form id="footer-newsletter" class="mt-4 flex gap-2">
                <input type="email" aria-label="Newsletter email" placeholder="Email address" class="min-w-0 flex-1 rounded-full border border-slate-200 px-4 py-2 text-sm outline-none" />
                <button class="btn btn-primary" type="submit">Subscribe</button>
              </form>
            <div class="mt-4 flex flex-wrap gap-x-3 gap-y-2 text-sm text-slate-600">
              ${socialLinks.map((link) => `<a href="${link.url}" target="_blank" rel="noopener noreferrer" class="transition hover:text-slate-900">${link.label}</a>`).join('')}
            </div>
          </div>
        </div>

        <div class="mt-8 border-t pt-6 text-sm text-slate-500 flex flex-col items-center justify-between gap-4 md:flex-row">
          <div>© ${new Date().getFullYear()} ${companyName}. All rights reserved.</div>
          <div class="flex gap-4">
            <a href="#/legal/privacy" class="transition hover:text-slate-900">Privacy</a>
            <a href="#/legal/terms" class="transition hover:text-slate-900">Terms</a>
            <a href="#/legal/cookies" class="transition hover:text-slate-900">Cookies</a>
            <a href="#/legal/payments" class="transition hover:text-slate-900">Payments & refunds</a>
          </div>
        </div>
        <div class="mt-4 border-t pt-4 text-center text-xs font-medium uppercase tracking-[0.25em] text-slate-500">
          Powered by <span class="font-semibold text-slate-900">GlobyTechnologies</span>
        </div>
      </div>
    </footer>
  `;
}
