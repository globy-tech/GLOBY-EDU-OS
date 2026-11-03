/* eslint-env jest */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');

describe('login experience', () => {
  it('renders the required school authority, teacher, and student login fields while preserving the secure-session option', () => {
    const loginSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'login.js'), 'utf8');
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js'), 'utf8');

    expect(loginSource).toContain('School Authority');
    expect(loginSource).toContain('Teacher');
    expect(loginSource).toContain('Student');
    expect(loginSource).not.toContain('super-admin-portal');
    expect(loginSource).not.toContain('Super Admin Login');
    expect(loginSource).toContain('School ID');
    expect(mainSource).toContain("identifierLabel: 'Email address'");
    expect(mainSource).toContain("identifierPlaceholder: 'teacher@school.edu'");
    expect(mainSource).toContain("identifierLabel: 'Student ID'");
    expect(loginSource).not.toContain('Student name');
    expect(loginSource).not.toContain('Teacher name');
    expect(loginSource).not.toContain('School Name');
    expect(loginSource).toContain('Keep me signed in on this device.');
    expect(loginSource).toContain('Google Sign In');
  });

  it('keeps responsive navigation and footer content from forcing tablet overflow', () => {
    const navbarSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'components', 'navbar.js'), 'utf8');
    const footerSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'components', 'footer.js'), 'utf8');

    expect(navbarSource).toContain('xl:flex');
    expect(navbarSource).toContain('xl:hidden');
    expect(footerSource).toContain('flex flex-wrap gap-x-3 gap-y-2');
  });

  it('invalidates stale route renders and clears authentication state on logout', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js'), 'utf8');
    const serviceWorkerSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'sw.js'), 'utf8');
    const appShellSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'components', 'app-shell.js'), 'utf8');
    const authApiSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'api', 'auth.js'), 'utf8');

    expect(mainSource).toContain('let routeGeneration = 0;');
    expect(mainSource).toContain('if (navigationId !== routeGeneration) return;');
    expect(mainSource).toContain("localStorage.removeItem('globyedu_accessToken');");
    expect(mainSource).toContain("localStorage.removeItem('globyedu_userRole');");
    expect(mainSource).toContain("profile.email = localStorage.getItem('globyedu_userEmail') || profile.email || '';");
    expect(serviceWorkerSource).toContain("const CACHE_NAME = 'globyedu-pwa-v17';");
    expect(serviceWorkerSource).toContain('/src/main.js?v=20261022-neutral-upload-copy');
    expect(serviceWorkerSource).toContain('/src/assets/images/ui/globyedu-icon-512.png');
    expect(serviceWorkerSource).not.toContain('20260923-pricing-fix');
    expect(serviceWorkerSource).toContain("if (/\\.(?:css|js)$/.test(requestUrl.pathname))");
    expect(appShellSource).toContain('data-account-menu-toggle');
    expect(appShellSource).toContain('data-app-action="profile"');
    expect(appShellSource).toContain('data-app-action="settings"');
    expect(appShellSource).toContain('data-app-action="logout"');
    expect(mainSource).toContain('await apiLogout(getAccessToken())');
    expect(mainSource).toContain("role === 'super_admin' ? '#/platform-admin' : '#/login'");
    expect(authApiSource).toContain("'/api/v1/auth/logout'");
    expect(appShellSource.match(/data-app-action="logout"/g)).toHaveLength(1);
    expect(mainSource).toContain("button.addEventListener('click', async () => {");
    expect(mainSource).not.toContain('workspace-profile-password');
    expect(mainSource).toContain('delete profile.password;');
  });

  it('serializes student profile uploads to the school record instead of only local storage', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js'), 'utf8');

    expect(mainSource).not.toContain("localStorage.setItem('globyedu_profilePhoto', uploadedPhoto.url);");
    expect(mainSource).toContain('updateSchoolEntity(token, schoolId, \'students\', studentId, {');
    expect(mainSource).toContain('profilePhoto: uploadedPhoto.url');
    expect(mainSource).toContain('profilePhotoPath: uploadedPhoto.path');
  });

  it('blocks protected cross-role and school/admin hash routes when a different authenticated role is active', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js'), 'utf8');

    expect(mainSource).toContain("const authenticatedRole = getUserRole();");
    expect(mainSource).toContain("if (authenticatedRole !== 'school_authority' && authenticatedRole !== 'school_head' && authenticatedRole !== 'super_admin' && !getPlatformAdminFlag())");
    expect(mainSource).toContain("if (role && authenticatedRole && authenticatedRole !== role)");
    expect(mainSource).toContain("location.hash = redirectPath;");
    expect(mainSource).toContain("location.hash = '#/role/student';");
  });

  it('returns each authenticated role to its matching dashboard', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js'), 'utf8');
    const routeStart = mainSource.indexOf('async function route() {');
    const routeEnd = mainSource.indexOf('\nfunction attachAdminHandlers()', routeStart);
    const routeSource = mainSource.slice(routeStart, routeEnd);

    expect(mainSource).toContain("if (platformAdmin || role === 'platform_admin' || role === 'super_admin') return '#/admin/overview';");
    expect(mainSource).toContain("if (role === 'school_authority' || role === 'school_head') return '#/school/overview';");
    expect(mainSource).toContain("role === 'school_authority' || role === 'school_head' ? 'school_authority'");
    expect(mainSource).toContain("authenticatedRole !== 'school_head'");
    expect(mainSource).toContain("school_head: '#/school/overview'");
    expect(mainSource).toContain("sessionRole === 'school_head' ? 'school_authority' : sessionRole");
    expect(mainSource).toContain("if (authenticatedRole !== 'super_admin' && !getPlatformAdminFlag())");
    expect(mainSource).toContain("if (role === 'teacher' || role === 'student') return `#/role/${role}`;");
    expect(mainSource).toContain("location.hash = getDashboardPathForRole(getUserRole(), getPlatformAdminFlag());");
    expect(mainSource).toContain("location.hash = getDashboardPathForRole(roleFromResponse, roleFromResponse === 'platform_admin');");
    expect(routeSource).toContain('location.pathname.replace');
    expect(routeSource).toContain("current === 'admin/login'");
    expect(routeSource).not.toContain('roleFromResponse');
  });

  it('shows trial expiry separately from operational suspension and provides support contact options', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js'), 'utf8');

    expect(mainSource).toContain("details.code === 'SUBSCRIPTION_EXPIRED'");
    expect(mainSource).toContain('This school trial or subscription has expired');
    expect(mainSource).toContain('mailto:support@globyedu.com');
    expect(mainSource).toContain('href="#/contact">Contact us</a>');
    expect(mainSource).toContain("renderSuspendedSchoolPage(event.detail || {});");
  });
});

describe('PWA branding', () => {
  it('uses shipped GlobyEdu icons in the manifest and document metadata', () => {
    const root = path.join(__dirname, '..', 'frontend', 'marketing');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

    expect(manifest.name).toBe('GlobyEdu OS');
    expect(manifest.short_name).toBe('GlobyEdu');
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(['192x192', '512x512']);
    manifest.icons.forEach((icon) => {
      const iconPath = path.join(root, icon.src.slice(1));
      expect(fs.existsSync(iconPath)).toBe(true);
      expect(icon.type).toBe('image/png');
    });
    expect(html).toContain('rel="icon"');
    expect(html).toContain('rel="manifest" href="/manifest.json"');
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain('apple-mobile-web-app-title" content="GlobyEdu OS"');
  });
});
