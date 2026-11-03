// reset-password.js
// UI for resetting a password with a token. Supports both school and platform administrator password resets.

export function ResetPasswordPage(token = '', loginType = 'school') {
  const safeToken = String(token || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
  const isTeacherSetup = loginType === 'teacher';
  const title = loginType === 'platform_admin'
    ? 'Platform Admin Reset'
    : isTeacherSetup ? 'Set up your teacher password' : 'Reset your password';
  const description = loginType === 'platform_admin'
    ? 'Enter a new password for your Globy platform administrator account.'
    : isTeacherSetup
      ? 'Choose a secure password for your teacher account. Verify your email before signing in.'
      : 'Choose a new password for your school account.';
  const backLink = loginType === 'platform_admin' ? '#/platform-admin' : '#/login';
  const backLabel = loginType === 'platform_admin'
    ? 'Return to admin login'
    : isTeacherSetup ? 'Return to teacher login' : 'Return to school login';

  return `
    <main class="max-w-3xl mx-auto px-6 py-14">
      <div class="rounded-[2rem] border border-slate-200 bg-white p-10 shadow-2xl shadow-slate-200/60">
        <div class="mb-8 text-center">
          <p class="text-sm uppercase tracking-[0.3em] text-sky-600">${title}</p>
          <h1 class="mt-4 text-3xl font-semibold text-slate-900">${title}</h1>
          <p class="mt-3 text-slate-600">${description}</p>
        </div>
        <form id="reset-password-form" class="grid gap-5">
          <input type="hidden" id="reset-token" value="${safeToken}" />
          <label class="block text-sm text-slate-700">
            New Password
            <input type="password" id="reset-password" required placeholder="New password" class="mt-3 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
          </label>
          <label class="block text-sm text-slate-700">
            Confirm Password
            <input type="password" id="reset-password-confirm" required placeholder="Confirm new password" class="mt-3 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
          </label>
          <button type="submit" class="rounded-full bg-sky-600 px-6 py-3 text-base font-semibold text-white transition hover:bg-sky-700">Update password</button>
          <div id="reset-password-message" class="min-h-[2rem] text-sm"></div>
          <p class="text-center text-sm text-slate-500"><a href="${backLink}" class="font-semibold text-sky-600">${backLabel}</a></p>
        </form>
      </div>
    </main>
  `;
}
