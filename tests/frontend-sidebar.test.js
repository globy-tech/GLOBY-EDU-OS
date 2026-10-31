const fs = require('fs');
const path = require('path');

describe('authenticated dashboard shell', () => {
  it('does not render an extra sidebar inside the admin page content', () => {
    const adminSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'admin.js'), 'utf8');
    expect(adminSource).not.toContain('renderSidebar(');
    expect(adminSource).not.toContain('renderAdminTopbar(');
    expect(adminSource).toContain('Super Admin Control Panel');
  });

  it('keeps the authenticated mobile drawer and responsive content within the viewport', () => {
    const shellSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'components', 'app-shell.js'), 'utf8');
    const adminSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'admin.js'), 'utf8');
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js'), 'utf8');
    const styles = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'styles.css'), 'utf8');

    expect(shellSource).toContain('h-dvh w-[min(88vw,20rem)]');
    expect(shellSource).toContain('data-app-shell-content');
    expect(shellSource).toContain('aria-controls="app-sidebar"');
    expect(shellSource).toContain('aria-hidden="true" inert');
    expect(shellSource).toContain('h-11 w-11');
    expect(shellSource).toContain('aria-label="Notifications"');
    expect(shellSource).toContain('aria-label="Messages"');
    expect(adminSource).toContain('data-admin-page');
    expect(styles).toMatch(/\[data-admin-page\]\s+table\s*\{[^}]*min-width:\s*720px;/);
    expect(styles).toMatch(/\[data-app-shell-content\],\s*\[data-admin-page\]\s*\{[^}]*min-width:\s*0;/);
    expect(mainSource).toContain('sidebar.inert = isMobile && !open;');
    expect(mainSource).toContain("if (event.key === 'Escape' && backdrop && !backdrop.classList.contains('hidden'))");
    expect(mainSource).toContain("if (event.key !== 'Tab' || window.innerWidth >= 1024 || !backdrop || backdrop.classList.contains('hidden')) return;");
    expect(mainSource).toContain('sidebarTrigger?.focus();');
  });

  it('navigates authenticated sidebar links to their configured destinations', () => {
    const shellSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'components', 'app-shell.js'), 'utf8');
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js'), 'utf8');

    expect(shellSource).toContain('href="${item.path ||');
    expect(mainSource).toContain("{ id: 'notifications', label: 'Notifications', path: '#/school/notifications'");
    expect(mainSource).toContain("const destination = link.getAttribute('href');");
    expect(mainSource).toContain("if (!destination || !destination.startsWith('#/')) return;");
    expect(mainSource).toContain('location.hash = destination;');
  });

  it('includes privacy masking and super-admin-only section guards', () => {
    const adminSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'admin.js'), 'utf8');
    expect(adminSource).toContain('maskSensitiveValue');
    expect(adminSource).toContain('SUPER_ADMIN_ONLY_SECTIONS');
    expect(adminSource).toContain('renderRestrictedAccessNotice');
    expect(adminSource).toContain('data-sensitive-field');
  });

  it('routes each core super-admin module to its working renderer', () => {
    const adminSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'admin.js'), 'utf8');
    expect(adminSource).toContain("if (normalizedSection === 'analytics') return renderAnalytics(summary, schools);");
    expect(adminSource).toContain("if (normalizedSection === 'settings') return renderPlatformSettings(maintenanceMode);");
    expect(adminSource).toContain("if (normalizedSection === 'backups') return renderBackups();");
    expect(adminSource).toContain("if (normalizedSection === 'security') return renderSecurity();");
  });

  it('consolidates pricing and subscriptions while keeping the legacy route working', () => {
    const adminSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'admin.js'), 'utf8');
    expect(adminSource).toContain("{ id: 'pricing', label: 'Plans & subscriptions'");
    expect(adminSource).toContain("normalizedSection === 'pricing' || normalizedSection === 'subscriptions'");
    expect(adminSource).toContain('renderSubscriptions(summary, schools)}${renderPricingManagement(pricingPlans)');
  });

  it('limits payment provider settings to Paystack', () => {
    const adminSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'admin.js'), 'utf8');
    expect(adminSource).toContain("(state.payments || []).filter((provider) => provider.id === 'paystack')");
  });
});
