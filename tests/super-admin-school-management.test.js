const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

describe('Super Admin school directory filters', () => {
  let scenarios;

  beforeAll(() => {
    const helperUrl = pathToFileURL(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'utils', 'school-management-filters.mjs')).href;
    const script = `
      import { getAdminSchoolStatus, getAdminSchoolSubscriptionStatus, getAdminSchoolStatuses, matchesAdminSchoolFilter } from ${JSON.stringify(helperUrl)};
      const beta = { name: 'Beta School', schoolId: 'school-beta-2', subscriptionStatus: 'Expired', schoolStatus: 'active' };
      const alpha = { name: 'Alpha School', schoolId: 'GLB-ALPHA-1', subscriptionStatus: 'trial', schoolStatus: 'active' };
      const suspended = { name: 'Suspended School', schoolId: 'GLB-SUSPENDED-1', subscriptionStatus: 'expired', schoolStatus: 'suspended' };
      const searchableBeta = 'Beta School school-beta-2 expired';
      const searchableAlpha = 'Alpha School GLB-ALPHA-1 trial';
      process.stdout.write(JSON.stringify({
        betaStatus: getAdminSchoolStatus(beta),
        betaSubscriptionStatus: getAdminSchoolSubscriptionStatus(beta),
        suspendedStatus: getAdminSchoolStatus(suspended),
        legacyTrialStatus: getAdminSchoolStatus({ status: 'trial', subscriptionStatus: 'trial' }),
        legacyExpiredStatus: getAdminSchoolStatus({ status: 'expired' }),
        legacyExpiredSubscription: getAdminSchoolSubscriptionStatus({ status: 'expired' }),
        legacySuspendedStatus: getAdminSchoolStatus({ subscriptionStatus: 'suspended' }),
        statuses: getAdminSchoolStatuses([beta, alpha, suspended, { subscriptionStatus: 'pending-review' }]),
        byName: matchesAdminSchoolFilter(searchableBeta, getAdminSchoolStatus(beta), 'Beta School'),
        byId: matchesAdminSchoolFilter(searchableBeta, getAdminSchoolStatus(beta), 'school-beta-2'),
        noMatch: matchesAdminSchoolFilter(searchableBeta, getAdminSchoolStatus(beta), 'missing school'),
        cleared: matchesAdminSchoolFilter(searchableBeta, getAdminSchoolStatus(beta), ''),
        combinedMatch: matchesAdminSchoolFilter(searchableBeta, getAdminSchoolStatus(beta), 'beta', 'expired', getAdminSchoolSubscriptionStatus(beta)),
        operationalMatch: matchesAdminSchoolFilter(searchableBeta, getAdminSchoolStatus(beta), 'beta', 'active', getAdminSchoolSubscriptionStatus(beta)),
        combinedMismatch: matchesAdminSchoolFilter(searchableBeta, getAdminSchoolStatus(beta), 'beta', 'suspended', getAdminSchoolSubscriptionStatus(beta)),
        otherSchool: matchesAdminSchoolFilter(searchableAlpha, getAdminSchoolStatus(alpha), 'alpha', 'trial', getAdminSchoolSubscriptionStatus(alpha)),
      }));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || 'School filter helper failed.');
    scenarios = JSON.parse(result.stdout);
  });

  it('searches case-insensitively by school name and ID', () => {
    expect(scenarios.byName).toBe(true);
    expect(scenarios.byId).toBe(true);
  });

  it('returns no-match for an unknown query and restores rows when cleared', () => {
    expect(scenarios.noMatch).toBe(false);
    expect(scenarios.cleared).toBe(true);
  });

  it('filters by the displayed lifecycle status and composes search with status', () => {
    expect(scenarios.betaStatus).toBe('active');
    expect(scenarios.betaSubscriptionStatus).toBe('expired');
    expect(scenarios.suspendedStatus).toBe('suspended');
    expect(scenarios.legacyTrialStatus).toBe('active');
    expect(scenarios.legacyExpiredStatus).toBe('active');
    expect(scenarios.legacyExpiredSubscription).toBe('expired');
    expect(scenarios.legacySuspendedStatus).toBe('suspended');
    expect(scenarios.combinedMatch).toBe(true);
    expect(scenarios.operationalMatch).toBe(true);
    expect(scenarios.combinedMismatch).toBe(false);
    expect(scenarios.otherSchool).toBe(true);
  });

  it('offers standard and data-backed status options', () => {
    expect(scenarios.statuses).toEqual(expect.arrayContaining(['active', 'trial', 'expired', 'suspended', 'pending-review']));
  });

  it('wires existing directory rows to combined in-place search and status filtering', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js'), 'utf8');
    const adminSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'admin.js'), 'utf8');

    expect(mainSource).toContain('document.querySelectorAll(isArchivedSection');
    expect(mainSource).toContain("'#school-directory-rows [data-school-id]'");
    expect(mainSource).toContain('matchesAdminSchoolFilter(');
    expect(mainSource).toContain('row.dataset.schoolSubscriptionStatus');
    expect(mainSource).toContain("'archived-school-directory-empty' : 'school-directory-empty'");
    expect(adminSource).toContain('getAdminSchoolStatuses(schools)');
    expect(adminSource).toContain('data-school-status="${status}"');
    expect(adminSource).toContain('data-school-subscription-status="${subscriptionStatus}"');
    expect(adminSource).toContain('Operational</span>');
    expect(adminSource).toContain('Subscription</span>');
  });

  it('uses the existing details API result to open the school details modal', () => {
    const adminSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'admin.js'), 'utf8');
    const viewHandler = adminSource.match(/if \(action === 'view'\) \{([\s\S]*?)\n {6}\} else if \(action === 'edit'\)/)?.[1] || '';

    expect(adminSource).toMatch(/import \{[^}]*fetchSchoolDetails[^}]*\} from '\.\.\/api\/school\.js'/);
    expect(viewHandler).toContain('const schoolResult = await fetchSchoolDetails(token, schoolId);');
    expect(viewHandler).toContain('schoolResult.data?.status === \'ok\' ? schoolResult.data.school : null');
    expect(viewHandler).toContain("document.getElementById('school-details-content').innerHTML = renderSchoolDetailsModal(school);");
    expect(viewHandler).toContain('detailsModal.classList.remove');
  });

  it('requires explicit confirmation before calling the existing activation service', () => {
    const adminSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'admin.js'), 'utf8');
    const activateStart = adminSource.indexOf("const activateButton = document.getElementById('security-activate-school');");
    const usersStart = adminSource.indexOf("if (normalizedSection === 'users')", activateStart);
    const securityHandler = adminSource.slice(activateStart, usersStart);

    expect(securityHandler).toContain('if (!confirm(`Activate school ${school.name || school.schoolName || schoolId}? It will regain platform access.`)) return;');
    expect(securityHandler.indexOf('if (!confirm(')).toBeLessThan(securityHandler.indexOf('await activateAdminSchool('));
    expect(securityHandler).toContain('is operationally active, but its subscription is');
    expect(securityHandler).toContain('Verified checkout is required before school access is restored.');
  });

  it('preserves create/edit required fields, existing API methods, and cancel controls', () => {
    const adminSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'admin.js'), 'utf8');
    const createForm = adminSource.match(/function renderCreateSchoolModal\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
    const editForm = adminSource.match(/function renderEditSchoolModal\(school\) \{([\s\S]*?)\n\}/)?.[1] || '';
    const createHandler = adminSource.match(/function attachSchoolCreateForm\(token, onSuccess\) \{([\s\S]*?)\n\}/)?.[1] || '';
    const editHandler = adminSource.match(/function attachSchoolEditForm\(token, schoolId, onSuccess\) \{([\s\S]*?)\n\}/)?.[1] || '';
    const schoolActions = adminSource.match(/\/\/ School Row Action Buttons[\s\S]*?\/\/ Create school form handler/)?.[0] || '';

    expect(createForm.match(/required/g)).toHaveLength(4);
    expect(createForm).toContain('id="school-modal-cancel"');
    expect(editForm).toContain('name="schoolName"');
    expect(editForm).toContain('name="headName"');
    expect(editForm).toContain('name="headEmail"');
    expect(editForm).toContain('name="subscriptionPlan"');
    expect(editForm).toContain('id="school-modal-cancel"');
    expect(createHandler).toContain("fetch('/api/v1/schools'");
    expect(createHandler).toContain("method: 'POST'");
    expect(editHandler).toContain("method: 'PUT'");
    expect(schoolActions.match(/addEventListener\('click', closeModal\)/g).length).toBeGreaterThanOrEqual(2);
    expect(schoolActions).toContain("if (document.getElementById('school-modal-cancel'))");
  });

  it('does not request a school credential update when the head email is unchanged', () => {
    const adminSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'admin.js'), 'utf8');
    const editHandler = adminSource.match(/function attachSchoolEditForm\(token, schoolId, onSuccess\) \{([\s\S]*?)\n\}/)?.[1] || '';
    const credentialUpdate = editHandler.match(/if \(updatedHeadEmail !== originalHeadEmail\) \{([\s\S]*?)\n {6}\}/)?.[1] || '';

    expect(editHandler).toContain("const originalHeadEmail = String(form.querySelector('[name=\"headEmail\"]')?.value || '').trim().toLowerCase();");
    expect(editHandler).toContain("const updatedHeadEmail = String(updateData.headEmail || '').trim().toLowerCase();");
    expect(credentialUpdate).toContain("fetch(`/api/v1/schools/${encodeURIComponent(schoolId)}/credentials`");
    expect(credentialUpdate).toContain("JSON.stringify({ email: updateData.headEmail, updatePassword: false })");
  });

  it('binds the primary create button once while preserving the quick-action create flow', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js'), 'utf8');
    const adminSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'admin.js'), 'utf8');

    expect(mainSource).toContain("createButton.addEventListener('click', () => handleCreateSchool())");
    expect(adminSource).not.toContain("createBtn.addEventListener('click'");
    expect(adminSource).toContain("document.querySelectorAll('.school-action-quick')");
  });

  it('does not advertise an unhandled renewal action and keeps verified payment as the renewal gate', () => {
    const adminSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'admin.js'), 'utf8');
    const subscriptions = adminSource.match(/function renderSubscriptions\(summary = \{\}, schools = \[\]\) \{([\s\S]*?)\n\}/)?.[1] || '';

    expect(subscriptions).not.toContain('data-admin-action="renew-subscriptions"');
    expect(subscriptions).toContain('Subscription renewals take effect only after the school completes verified checkout.');
  });

  it('uses the existing Super Admin archive endpoints through the school API service', () => {
    const apiSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'api', 'school.js'), 'utf8');

    expect(apiSource).toContain("export async function fetchArchivedAdminSchools(token, search = '', status = '')");
    expect(apiSource).toContain("/api/v1/schools/archived${query ? `?${query}` : ''}");
    expect(apiSource).toContain("/api/v1/schools/${encodeURIComponent(schoolId)}/archive");
    expect(apiSource).toContain("/api/v1/schools/${encodeURIComponent(schoolId)}/restore");
    expect(apiSource).toContain("/api/v1/schools/${encodeURIComponent(schoolId)}/permanent");
  });

  it('loads archived records only in the archived section and filters its own directory', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js'), 'utf8');
    const adminSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'admin.js'), 'utf8');

    expect(mainSource).toContain("section === 'archived-schools' ? fetchArchivedAdminSchools(token) : fetchAdminSchoolList(token)");
    expect(mainSource).toContain("'#archived-school-directory-rows [data-archived-school-row]'");
    expect(mainSource).toContain("'archived-school-search-input'");
    expect(adminSource).toContain('if (normalizedSection === \'archived-schools\') return renderArchivedSchools(schools);');
    expect(adminSource).toContain('data-admin-nav="archived-schools"');
  });

  it('keeps permanent delete off normal rows and exposes archive plus archived school details', () => {
    const adminSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'admin.js'), 'utf8');
    const normalRow = adminSource.match(/function renderSchoolRow\(school\) \{([\s\S]*?)\n\}/)?.[1] || '';
    const archivedView = adminSource.match(/function renderArchivedSchools\(schools = \[\]\) \{([\s\S]*?)\n\}/)?.[1] || '';
    const detailRenderer = adminSource.match(/function renderSchoolDetailsModal\(school, isArchived = false\) \{([\s\S]*?)\n\}/)?.[1] || '';
    const archivedHandlers = adminSource.match(/function attachArchivedSchoolHandlers\(token\) \{([\s\S]*?)\n\}/)?.[1] || '';

    expect(normalRow).toContain('data-action="archive"');
    expect(normalRow).not.toContain('data-action="delete"');
    expect(archivedView).toContain('data-archived-school-action="view"');
    expect(archivedView).toContain('data-archived-school-action="restore"');
    expect(archivedView).toContain('data-archived-school-action="permanent-delete"');
    expect(archivedView).toContain('Archived Date');
    expect(detailRenderer).toContain('school.archivedAt');
    expect(archivedHandlers).toContain('fetchSchoolDetails(token, schoolId)');
    expect(archivedHandlers).toContain('renderSchoolDetailsModal(school, true)');
  });

  it('requires confirmation for archive and restore and typed irreversible-delete confirmation in archive view', () => {
    const adminSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'admin.js'), 'utf8');
    const archiveStart = adminSource.indexOf("} else if (action === 'archive') {");
    const suspendStart = adminSource.indexOf("} else if (action === 'suspend')", archiveStart);
    const archiveHandler = adminSource.slice(archiveStart, suspendStart);
    const archivedHandler = adminSource.match(/function attachArchivedSchoolHandlers\(token\) \{([\s\S]*?)\n\}/)?.[1] || '';
    const restoreStart = archivedHandler.indexOf("if (action === 'restore') {");
    const deleteStart = archivedHandler.indexOf("if (action === 'permanent-delete') {");
    const restoreHandler = archivedHandler.slice(restoreStart, deleteStart);
    const deleteHandler = archivedHandler.slice(deleteStart);

    expect(archiveHandler.indexOf('confirm(')).toBeGreaterThanOrEqual(0);
    expect(archiveHandler.indexOf('confirm(')).toBeLessThan(archiveHandler.indexOf('archiveAdminSchool('));
    expect(restoreHandler.indexOf('confirm(')).toBeGreaterThanOrEqual(0);
    expect(restoreHandler.indexOf('confirm(')).toBeLessThan(restoreHandler.indexOf('restoreAdminSchool('));
    expect(deleteHandler).toContain('This cannot be undone');
    expect(deleteHandler).toContain('if (confirmation !== `DELETE ${schoolId}`) return;');
    expect(deleteHandler.indexOf('window.prompt(')).toBeLessThan(deleteHandler.indexOf('permanentlyDeleteArchivedSchool('));
  });

  it('publishes restored CMS settings before applying the local backup snapshot', () => {
    const adminSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'admin.js'), 'utf8');
    const restoreHandler = adminSource.match(/async function restoreLatestBackup\(\) \{([\s\S]*?)\n\}/)?.[1] || '';

    expect(restoreHandler).toContain('if (!token)');
    expect(restoreHandler).toContain('await publishWebsiteCMS(token, backupData.cms)');
    expect(restoreHandler).toContain('if (!result.ok || result.data?.status !== \'ok\' || !result.data.settings)');
    expect(restoreHandler).toContain('if (restoredCms) nextState.cms');
    expect(restoreHandler.indexOf('await publishWebsiteCMS(token, backupData.cms)')).toBeLessThan(restoreHandler.indexOf('saveAdminState(nextState)'));
    expect(restoreHandler.indexOf('await publishWebsiteCMS(token, backupData.cms)'))
      .toBeLessThan(restoreHandler.indexOf("localStorage.setItem('globyedu_websiteCms'"));
    expect(restoreHandler).toContain("window.dispatchEvent(new CustomEvent('globyedu-cms-updated'");
  });
});