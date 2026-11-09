// app-shell.js
// Authenticated application shell used once a user signs in.
// This keeps the public marketing experience separate from the app workspace.

export function AppShell({
  role = 'super_admin',
  title = 'Workspace',
  subtitle = 'Authenticated experience',
  navItems = [],
  activeItem = 'overview',
  children = '',
  profileName = 'User',
  searchPlaceholder = 'Search this workspace',
}) {
  const roleLabel =
    role === 'school_authority'
      ? 'School Authority'
      : role === 'teacher'
      ? 'Teacher'
      : role === 'student'
      ? 'Student'
      : 'Super Admin';

  const navMarkup = navItems
    .map((item) => {
      const isActive = item.id === activeItem;
      return `
        <a
          href="${item.path || '#'}"
          data-app-nav="${item.id}"
          class="flex items-center justify-between rounded-2xl px-4 py-3 text-sm font-medium transition ${
            isActive
              ? 'bg-sky-600 text-white shadow-lg shadow-sky-500/10'
              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
          }"
        >
          <span>${item.label}</span>
          <span class="text-xs opacity-70">${item.icon || '↗'}</span>
        </a>
      `;
    })
    .join('');

  return `
    <div class="min-h-screen overflow-x-hidden bg-slate-100 text-slate-900">
      <div class="flex min-h-screen flex-col lg:flex-row">
        <div id="app-sidebar-backdrop" class="fixed inset-0 z-30 hidden bg-slate-950/70 lg:hidden" aria-hidden="true"></div>

        <aside id="app-sidebar" class="fixed inset-y-0 left-0 z-40 flex h-dvh w-[min(88vw,20rem)] -translate-x-full flex-col border-r border-slate-800 bg-[#0B0F19] p-5 text-slate-100 shadow-2xl transition-transform duration-200 lg:static lg:h-auto lg:w-72 lg:translate-x-0 lg:border-r lg:border-slate-800 lg:p-6 lg:shadow-none" aria-label="${roleLabel} navigation" aria-hidden="true" inert>
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-3">
              <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-linear-to-br from-sky-500 to-emerald-500 text-lg font-bold text-white">
                G
              </div>
              <div>
                <p class="text-xs uppercase tracking-[0.3em] text-slate-400">GlobyEdu</p>
                <p class="text-lg font-semibold text-white">${roleLabel}</p>
              </div>
            </div>
            <button type="button" data-app-sidebar-close aria-label="Close navigation" class="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900/70 text-slate-100 lg:hidden">×</button>
          </div>

          <div class="mt-8 flex-1 space-y-2 overflow-y-auto">${navMarkup}</div>

          <div class="mt-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
            <p class="text-xs uppercase tracking-[0.3em] text-slate-500">Workspace</p>
            <div class="mt-3 flex items-center gap-2 text-sm text-slate-300">
              <span class="h-2.5 w-2.5 rounded-full bg-sky-400"></span>
              Ready to continue
            </div>
          </div>
        </aside>

        <div data-app-shell-content class="min-w-0 flex-1">
          <header class="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur-xl">
            <div class="flex flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-6">
              <div class="flex items-center gap-3">
                <button type="button" data-app-sidebar-toggle class="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-sm lg:hidden" aria-label="Open navigation" aria-controls="app-sidebar" aria-expanded="false">☰</button>
                <div class="min-w-0">
                  <p class="text-xs uppercase tracking-[0.3em] text-slate-500">${title}</p>
                  <h1 class="truncate text-xl font-semibold text-slate-900 sm:text-2xl">${subtitle}</h1>
                </div>
              </div>

              <div class="min-w-0 flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
                <label class="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600 sm:w-48 sm:flex-none">
                  <span>🔎</span>
                  <input type="search" placeholder="${searchPlaceholder}" class="w-full min-w-0 bg-transparent outline-none" />
                </label>

                <div class="flex flex-wrap items-center gap-2">
                  <button type="button" data-app-action="notifications" aria-label="Notifications" class="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50">🔔</button>
                  <button type="button" data-app-action="messages" aria-label="Messages" class="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50">💬</button>
                  <button type="button" data-app-action="help" aria-label="Help" class="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50">❓</button>
                  <div class="relative" data-account-menu>
                    <button type="button" data-account-menu-toggle aria-haspopup="true" aria-expanded="false" aria-controls="account-actions-menu" class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50">
                      <span data-account-profile-initial class="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-sky-100 text-sky-700">${profileName.slice(0, 1)}</span>
                      <img data-account-profile-photo alt="Profile photo" class="hidden h-8 w-8 rounded-full object-cover" />
                      <span>${profileName}</span>
                    </button>
                    <div id="account-actions-menu" data-account-menu-panel class="absolute right-0 top-full z-30 mt-2 hidden w-48 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                      <button type="button" data-app-action="profile" class="w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50">Profile</button>
                      <button type="button" data-app-action="settings" class="w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50">Settings</button>
                      <button type="button" data-app-action="logout" class="w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-rose-700 hover:bg-rose-50">Logout</button>
                      <p id="account-action-status" class="hidden px-3 py-2 text-xs text-rose-700" role="status"></p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </header>

          <main class="p-4 sm:p-6 lg:p-8">${children}</main>
        </div>
      </div>
    </div>
  `;
}
