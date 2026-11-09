// cta.js
// Call-to-action section encouraging signups and demos.

export function CTA() {
  return `
    <section class="mt-12">
      <div class="mx-auto max-w-7xl px-6">
        <div class="rounded-3xl card p-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div class="flex items-center gap-4">
            <div class="flex h-12 w-12 items-center justify-center rounded-full bg-sky-600 text-white">G</div>
            <div>
              <p class="text-lg font-semibold text-slate-900">Ready to Transform Your School?</p>
              <p class="text-sm text-muted">Let's talk about how GlobyEdu OS can help your school thrive.</p>
            </div>
          </div>

          <div class="flex w-full flex-col items-start gap-3 text-sm text-slate-600 sm:w-auto sm:flex-row sm:items-center sm:gap-6">
            <div class="flex items-center gap-2"><svg class="icon" viewBox="0 0 24 24" fill="none"><path d="M3 6h18" stroke="#0ea5e9" stroke-width="1.4"/></svg>+233 53 749 7607</div>
            <div class="flex items-center gap-2"><svg class="icon" viewBox="0 0 24 24" fill="none"><path d="M3 12h18" stroke="#0ea5e9" stroke-width="1.4"/></svg>hello@globyedu.com</div>
            <a href="#/contact" class="btn btn-primary">Contact Us</a>
          </div>
        </div>
      </div>
    </section>
  `;
}
