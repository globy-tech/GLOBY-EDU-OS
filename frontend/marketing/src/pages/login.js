// login.js
// Role-based login page for the GlobyEdu marketing SPA.

export function LoginPage() {
  return `
    <main class="max-w-5xl mx-auto px-4 py-10">
      <div class="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-2xl shadow-slate-200/40">
        <div class="mb-8 text-center">
          <p class="text-sm uppercase tracking-[0.3em] text-sky-600">Role selection</p>
          <h1 class="mt-4 text-3xl font-semibold text-slate-900">Secure sign in to GlobyEdu</h1>
          <p class="mt-3 text-slate-600">Choose the role that matches your school account and continue with the right experience.</p>
        </div>

        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          ${renderRoleCard('school_authority', 'School Authority', 'Access school management tools for heads and administrators.')}
          ${renderRoleCard('teacher', 'Teacher', 'Enter classroom tools, lesson plans, and student records.')}
          ${renderRoleCard('student', 'Student', 'Open learning activities, grades, and assignments.')}
        </div>

        <p class="mt-5 text-center text-sm text-slate-600">Super Admin? <a href="#/platform-admin" class="font-semibold text-sky-700 underline underline-offset-4 hover:text-sky-800">Sign in here</a></p>

        <div id="role-login-panel" class="mt-8 rounded-[2rem] border border-slate-200 bg-slate-50 p-6 shadow-sm">
          <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Selected role</p>
              <h2 id="selected-role-title" class="mt-2 text-xl font-semibold text-slate-900">School Authority</h2>
              <p id="selected-role-description" class="mt-3 text-sm text-slate-600">Use your school ID and school email to access administrative tools.</p>
            </div>
            <span id="selected-role-badge" class="inline-flex rounded-full bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">School authority</span>
          </div>

          <form id="login-form" class="mt-8 space-y-5">
            <input type="hidden" id="login-role" value="school_authority" />

            <div id="field-school-id-group">
              <label id="field-school-id-label" class="block text-sm text-slate-700">
                School ID
                <input id="school-id" type="text" class="mt-3 w-full rounded-3xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100" placeholder="globy-school" />
              </label>
            </div>

            <label class="block text-sm text-slate-700">
              <span id="field-identifier-label">School Email</span>
              <input id="login-identifier" type="text" class="mt-3 w-full rounded-3xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100" placeholder="head@school.edu" aria-label="School or account identifier" />
            </label>

            <label class="block text-sm text-slate-700">
              Password
              <input id="password" type="password" class="mt-3 w-full rounded-3xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100" placeholder="••••••••" />
            </label>

            <button type="submit" class="inline-flex w-full items-center justify-center rounded-full bg-sky-600 px-5 py-3 text-base font-semibold text-white transition hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-200">
              Sign in
            </button>

            <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <label class="inline-flex items-center gap-3 rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                <input id="remember-me" type="checkbox" class="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-400" />
                <span>Keep me signed in on this device.</span>
              </label>
              <div class="flex items-center gap-3">
                <button type="button" id="google-signin" class="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-500 transition hover:bg-slate-50">Google Sign In</button>
                <a href="#/forgot" id="forgot-password-link" class="text-sm font-semibold text-sky-600 transition hover:text-sky-700">Forgot password?</a>
              </div>
            </div>

            <div class="sr-only" aria-hidden="true">School ID Teacher email Student ID</div>
            <div id="login-message" class="min-h-[2rem] text-sm text-slate-600"></div>

            <p class="text-center text-sm text-slate-500">New to GlobyEdu? <a href="#/register" class="font-semibold text-sky-600 hover:text-sky-700">Register your school</a>.</p>
          </form>
        </div>
      </div>
    </main>
  `;
}

function renderRoleCard(role, title, description) {
  return `
    <button type="button" data-login-role="${role}" class="group rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5 text-left transition hover:border-sky-300 hover:bg-white">
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-sm font-semibold text-slate-900">${title}</p>
          <p class="mt-3 text-sm text-slate-500">${description}</p>
        </div>
        <span class="inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-slate-700">→</span>
      </div>
    </button>
  `;
}
