const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

describe('marketing frontend syntax', () => {
  it('parses the changed marketing modules without syntax errors', () => {
    const sourcePaths = [
      path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js'),
      path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'admin.js'),
      path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'register-wizard.js'),
      path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'school-dashboard.js'),
    ];

    sourcePaths.forEach((sourcePath) => {
      const result = spawnSync(process.execPath, ['--input-type=module', '--check'], {
        input: fs.readFileSync(sourcePath, 'utf8'),
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
    });
  });

  it('includes searchable country and image upload fields for the completed school profile flow', () => {
    const entryPath = path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js');
    const source = fs.readFileSync(entryPath, 'utf8');

    expect(source).toContain('profile-country');
    expect(source).toContain('list="profile-country-options"');
    expect(source).toContain('profile-stamp-file');
    expect(source).toContain('profile-principal-signature-file');
  });

  it('leaves mobile image pickers free to offer both camera and gallery sources', () => {
    const mainPath = path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js');
    const registrationPath = path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'register-wizard.js');
    const dashboardPath = path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'school-dashboard.js');
    const mainSource = fs.readFileSync(mainPath, 'utf8');
    const registrationSource = fs.readFileSync(registrationPath, 'utf8');
    const dashboardSource = fs.readFileSync(dashboardPath, 'utf8');

    expect(mainSource).toContain('accept="${field.accept || \'image/*\'}"');
    expect(registrationSource).toContain('id="school-logo-input" type="file" accept="image/*" class="hidden"');
    expect(dashboardSource).toContain('type="file" accept="image/*" data-student-profile-photo-input');
    expect(mainSource).not.toContain('capture="${field.capture}"');
    expect(registrationSource).not.toContain('capture="environment"');
    expect(dashboardSource).not.toContain('capture="environment"');
    expect(dashboardSource).toContain('Upload Photo');
    expect(dashboardSource).toContain('Open Camera');
    expect(mainSource).toContain('async function refreshStoredProfilePhotos(records, token)');
    expect(mainSource).toContain('await refreshStoredProfilePhotos(schoolData.teachers, token);');
    expect(mainSource).toContain('profilePhotoPath: uploadedPhoto.path');
    expect(mainSource).toContain("cache: 'no-store'");
  });

  it('locks subscription checkout while pending and exposes recoverable errors', () => {
    const entryPath = path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js');
    const source = fs.readFileSync(entryPath, 'utf8');

    expect(source).toContain('let checkoutPending = false;');
    expect(source).toContain('checkoutButton.disabled = true;');
    expect(source).toContain("checkoutButton.setAttribute('aria-busy', 'true');");
    expect(source).toContain("role=\"status\" aria-live=\"polite\"");
    expect(source).toContain('message.textContent = error.message || \'Unable to initialize payment. Please try again.\';');
    expect(source).toContain('if (!redirecting) {');
  });

  it('guards admin create/edit school submits with a busy state and safe retry handling', () => {
    const adminPath = path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'admin.js');
    const source = fs.readFileSync(adminPath, 'utf8');

    expect(source).toContain('let isSubmitting = false;');
    expect(source).toContain("submitBtn.setAttribute('aria-busy', 'true');");
    expect(source).toContain("resetButton.setAttribute('aria-busy', 'true');");
    expect(source).toContain("if (isSubmitting) return;");
    expect(source).toContain('isSubmitting = false;');
  });

  it('supports academic JSON export and import for the academic management workflow', () => {
    const entryPath = path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js');
    const source = fs.readFileSync(entryPath, 'utf8');

    expect(source).toContain("exportType === 'academic'");
    expect(source).toContain("importType === 'academic'");
    expect(source).toContain("record.recordType || record.type || 'academic-years'");
  });

  it('persists the school identity returned by role-specific login flows', () => {
    const entryPath = path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js');
    const source = fs.readFileSync(entryPath, 'utf8');

    expect(source).toContain("const resolvedSchoolId = schoolId || response.data.schoolId || response.data.response?.schoolId || ''");
    expect(source).toContain("localStorage.setItem('globyedu_schoolId', resolvedSchoolId)");
  });

  it('adds the polished public contact block and validated CMS logo upload flow', () => {
    const entryPath = path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js');
    const adminPath = path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'admin.js');
    const mainSource = fs.readFileSync(entryPath, 'utf8');
    const adminSource = fs.readFileSync(adminPath, 'utf8');

    expect(mainSource).toContain('bg-gradient-to-br from-white via-slate-50 to-sky-50/60');
    expect(adminSource).toContain('Please choose a valid image file for the website logo.');
    expect(adminSource).toContain('const validationError = validateImageUpload(file);');
  });

  it('persists upload paths and refreshes private file URLs for school assets', () => {
    const mainPath = path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js');
    const registrationPath = path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'register-wizard.js');
    const adminPath = path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'admin.js');
    const mainSource = fs.readFileSync(mainPath, 'utf8');
    const registrationSource = fs.readFileSync(registrationPath, 'utf8');
    const adminSource = fs.readFileSync(adminPath, 'utf8');

    expect(mainSource).toContain('return includePath ? { url: signedUrlData.url, path: uploadData.path } : signedUrlData.url;');
    expect(mainSource).toContain('result[`${field.name}Path`] = uploadedAsset.path;');
    expect(mainSource).toContain("uploadTenantAsset(file, 'school-cover', true, {");
    expect(mainSource).toContain("type: 'school', id: schoolId, field: 'coverImagePath'");
    expect(mainSource).toContain('coverImagePath: uploadedAsset.path');
    expect(mainSource).toContain('logoPath: uploadedAsset.path');
    expect(mainSource).toContain('async function refreshStoredSchoolAssets(school, token)');
    expect(mainSource).toContain('await refreshStoredSchoolAssets(school, token);');
    expect(mainSource).toContain("cache: 'no-store'");
    const coverUploadSource = mainSource.slice(
      mainSource.indexOf("if (uploadCoverButton)"),
      mainSource.indexOf("if (entityRefreshButton)"),
    );
    expect(coverUploadSource).toContain("uploadTenantAsset(file, 'school-cover', true, {");
    expect(coverUploadSource).not.toContain('readFileAsDataUrl(file)');
    expect(registrationSource).toContain('body: JSON.stringify({ logo: uploadedLogo.url, logoPath: uploadedLogo.path })');
    expect(adminSource).toContain('values.logoPath = uploadedLogoPath || getWebsiteCMSSettings().logoPath || \'\';');
  });

  it('does not present unsupported workspace updates as persisted account changes', () => {
    const mainPath = path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js');
    const dashboardPath = path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'school-dashboard.js');
    const mainSource = fs.readFileSync(mainPath, 'utf8');
    const dashboardSource = fs.readFileSync(dashboardPath, 'utf8');
    const profileSaveSource = mainSource.slice(
      mainSource.indexOf("const profileSaveButton = document.querySelector('[data-workspace-profile-save]');"),
      mainSource.indexOf("const profileUploadButton = document.querySelector('[data-workspace-profile-upload]');"),
    );

    expect(profileSaveSource).toContain('profile.localDraft = true;');
    expect(profileSaveSource).toContain('Profile draft saved in this browser.');
    expect(profileSaveSource).not.toContain("localStorage.setItem('globyedu_userEmail'");
    expect(profileSaveSource).not.toContain("localStorage.setItem('globyedu_userFullName'");
    expect(mainSource).toContain('profile: getWorkspaceProfile(),');
    expect(mainSource).toContain('no 2FA service is configured');
    expect(dashboardSource).toContain('These preferences are stored in this browser only.');
  });

  it('requires backend success for workspace messages and support tickets', () => {
    const mainPath = path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js');
    const mainSource = fs.readFileSync(mainPath, 'utf8');
    const supportLoadSource = mainSource.slice(
      mainSource.indexOf('async function refreshSupport('),
      mainSource.indexOf("document.querySelectorAll('[data-workspace-notification-filter]')"),
    );
    const handlersSource = mainSource.slice(
      mainSource.indexOf("const messageButton = event.target.closest('[data-message-action]');"),
      mainSource.indexOf("const profileSaveButton = document.querySelector('[data-workspace-profile-save]');"),
    );

    expect(supportLoadSource).toContain('Browser-stored tickets are not authoritative.');
    expect(supportLoadSource).not.toContain('readWorkspaceStorage');
    expect(handlersSource).toContain('if (!result.ok || result.data?.status !== \'ok\')');
    expect(handlersSource).toContain('Sign in to update messages.');
    expect(handlersSource).toContain('Sign in to update support tickets.');
    expect(handlersSource).not.toContain('writeWorkspaceStorage(WORKSPACE_STORAGE_KEYS.messages');
    expect(handlersSource).not.toContain('writeWorkspaceStorage(WORKSPACE_STORAGE_KEYS.supportTickets');

    const supportCreateSource = mainSource.slice(
      mainSource.indexOf("const supportCreateButton = document.querySelector('[data-workspace-support-create]');"),
      mainSource.indexOf('  refreshNotifications();', mainSource.indexOf("const supportCreateButton = document.querySelector('[data-workspace-support-create]');")),
    );
    expect(supportCreateSource).toContain('if (!result.ok || result.data?.status !== \'ok\')');
    expect(supportCreateSource).toContain('Sign in to create a support ticket.');
    expect(supportCreateSource).not.toContain('writeWorkspaceStorage(WORKSPACE_STORAGE_KEYS.supportTickets');

    const formSaveSource = mainSource.slice(
      mainSource.indexOf('if (onSave) {', mainSource.indexOf('async function showAdminForm')),
      mainSource.indexOf('settled = true;', mainSource.indexOf('if (onSave) {', mainSource.indexOf('async function showAdminForm'))),
    );
    expect(formSaveSource).toContain('if (!saveResponse?.ok || saveResponse.data?.status !== \'ok\')');
    expect(formSaveSource).toContain('throw new Error(saveResponse?.data?.message || \'Unable to save this record.\')');
  });

  it('routes Get Started to the existing public registration flow and guards the public pricing fetch', () => {
    const entryPath = path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js');
    const source = fs.readFileSync(entryPath, 'utf8');

    expect(source).toContain("#/register");
    expect(source).toContain("Unable to load public pricing plans; showing the default pricing state");
    expect(source).toContain("Array.isArray(pricingPlans) ? pricingPlans.filter((plan) => plan && plan.active !== false) : []");
  });
});
