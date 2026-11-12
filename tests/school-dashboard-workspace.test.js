const fs = require('fs');
const path = require('path');

describe('school authority workspace', () => {
  it('keeps the sidebar focused on the required school-authority modules', () => {
    const sidebarSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'components', 'sidebar.js'), 'utf8');

    expect(sidebarSource).toContain('Dashboard');
    expect(sidebarSource).toContain('Profile');
    expect(sidebarSource).toContain('Students');
    expect(sidebarSource).toContain('Teachers');
    expect(sidebarSource).toContain('Attendance');
    expect(sidebarSource).toContain('Finance & Billing');
    expect(sidebarSource).toContain('Examination & Grading');
    expect(sidebarSource).toContain('Announcements');
    expect(sidebarSource).toContain('Notifications');
    expect(sidebarSource).toContain('Messaging');
    expect(sidebarSource).toContain('Reports');
    expect(sidebarSource).toContain('Settings');
  });

  it('renders the full quick-action set on the dashboard overview', () => {
    const dashboardSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'school-dashboard.js'), 'utf8');

    expect(dashboardSource).toContain('Create Announcement');
    expect(dashboardSource).toContain('Send Message');
    expect(dashboardSource).toContain('Create Class');
    expect(dashboardSource).toContain('Generate Report');
    expect(dashboardSource).toContain('Add Student');
    expect(dashboardSource).toContain('Invite Teacher');
  });

  it('reserves attendance submission for teachers, not School Authority', () => {
    const roleDashboardSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'role-dashboards.js'), 'utf8');
    const schoolAttendanceModule = roleDashboardSource.match(/function renderAttendanceModule\(\) \{[\s\S]*?\n\}/)?.[0] || '';

    expect(schoolAttendanceModule).toContain('Attendance records are submitted by authorized teachers');
    expect(schoolAttendanceModule).not.toContain('data-school-section-action="record-attendance"');
    expect(roleDashboardSource).toContain('data-teacher-action="record-attendance"');
  });

  it('routes both quick and finance payment actions through the validated fee endpoint', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js'), 'utf8');

    expect(mainSource).not.toContain("appendSchoolCollectionData(token, schoolId, 'payments'");
    expect(mainSource.match(/createFeePayment\(token, schoolId/g)).toHaveLength(3);
    expect(mainSource).toContain("{ name: 'reference', label: 'External reference (optional)' }");
    expect(mainSource).toContain("{ name: 'studentId', label: 'Student', type: 'select', options: studentOptions, required: true }");
  });

  it('keeps school dashboard content usable on phones and tablets', () => {
    const dashboardSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'school-dashboard.js'), 'utf8');
    const styles = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'styles.css'), 'utf8');

    expect(dashboardSource).toContain('max-w-7xl px-0 py-4 sm:px-2 sm:py-6 lg:px-8 lg:py-8');
    expect(dashboardSource).toContain('sm:grid-cols-2 lg:gap-6 lg:grid-cols-4');
    expect(dashboardSource).toContain('min-w-3xl');
    expect(dashboardSource).toContain('aria-label="Student directory table" tabindex="0"');
    expect(dashboardSource).toContain('aria-label="Teacher directory table" tabindex="0"');
    expect(styles).toMatch(/\[data-school-student-action\],[\s\n]*\[data-school-teacher-action\]\s*\{[^}]*min-height:\s*44px;/);
  });

  it('routes school-authority messages navigation to the canonical workspace section', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js'), 'utf8');

    expect(mainSource).toContain("{ id: 'messages', label: 'Messaging', path: '#/school/messages'");
  });

  it('preserves the selected school-authority section when refreshing summary state', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js'), 'utf8');

    expect(mainSource).toContain("renderSchoolDashboardPage(section, navigationId);");
    expect(mainSource).toContain("SchoolDashboardPage(summary, normalizedSection, sectionData)");
    expect(mainSource).not.toContain("loadSchoolSummary(section);");
  });

  it('loads the live school summary and entity data before rendering the authority dashboard', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js'), 'utf8');

    expect(mainSource).toContain('const summaryResult = await fetchSchoolSummary(token, schoolId);');
    expect(mainSource).toContain("const normalizedSection = normalizeSchoolSection(section);");
    expect(mainSource).toContain('currentSchoolStudents');
    expect(mainSource).toContain('currentSchoolTeachers');
  });

  it('describes approved student deletion requests as archival with history retention', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js'), 'utf8');

    expect(mainSource).toContain('student record was archived and its history preserved');
    expect(mainSource).not.toContain('Permanently delete ${studentRecord.fullName');
    expect(mainSource).not.toContain('the account was deleted.');
  });

  it('offers the requested teacher management fields and curriculum coverage', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js'), 'utf8');
    const actionsSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'utils', 'school-dashboard-actions.cjs'), 'utf8');

    expect(mainSource).not.toContain('National ID / Passport');
    expect(mainSource).toContain("{ id: 'classes', label: 'Class Management', path: '#/school/classes'");
    expect(mainSource).toContain('RME');
    expect(mainSource).toContain("{ label: 'Nursery 1', value: 'Nursery 1' }");
    expect(mainSource).toContain('[1, 2, 3, 4, 5, 6].map');
    expect(mainSource).toContain('[1, 2, 3].map((level) => ({ label: `JHS ${level}`, value: `JHS ${level}` }))');
    expect(mainSource).toContain('[1, 2, 3].map((level) => ({ label: `SHS ${level}`, value: `SHS ${level}` }))');
    expect(mainSource).toContain('Principal');
    expect(mainSource).not.toContain('Is house master?');
    expect(mainSource).toContain("showAdminForm('Invite a teacher'");
    expect(mainSource).toContain("{ name: 'gender', label: 'Gender', type: 'select'");
    expect(mainSource).toContain("{ name: 'dateOfBirth', label: 'Date of birth (optional)'");
    expect(mainSource).toContain("{ name: 'profilePhoto', label: 'Profile photo', type: 'file'");
    expect(actionsSource).not.toContain('payload.signature = data.signature');
  });

  it('renders school settings controls as dropdowns', () => {
    const dashboardSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'school-dashboard.js'), 'utf8');

    expect(dashboardSource).toContain('id="school-settings-theme"');
    expect(dashboardSource).toContain('id="school-settings-colours"');
    expect(dashboardSource).toContain('id="school-settings-email"');
    expect(dashboardSource).toContain('id="school-settings-sms"');
    expect(dashboardSource).toContain('id="school-settings-messaging"');
    expect(dashboardSource).toContain('id="school-settings-analytics"');
    expect(dashboardSource).toContain('<select');
    expect(dashboardSource).not.toContain('id="school-settings-theme" value=');
  });

  it('stores a workspace notification when a new school is created', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js'), 'utf8');

    expect(mainSource).toContain('pushWorkspaceNotification({');
    expect(mainSource).toContain("title: 'New school created'");
    expect(mainSource).toContain("message: `School created successfully: ${");
  });

  it('keeps the teacher student form aligned with the school-authority form and strips National ID', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js'), 'utf8');

    expect(mainSource).toContain("{ name: 'email', label: 'Email', type: 'email', placeholder: 'student@example.com', required: true }");
    expect(mainSource).toContain("{ name: 'gender', label: 'Gender', type: 'select', options: [");
    expect(mainSource).toContain("{ name: 'dateOfBirth', label: 'Date of birth', type: 'date' }");
    expect(mainSource).toContain("{ name: 'guardian', label: 'Guardian name' }");
    expect(mainSource).not.toContain("{ name: 'nationalId', label: 'National ID' }");
    expect(mainSource).not.toContain('payload.nationalId =');
  });

  it('surfaces teacher student create/edit failures and uses CRUD action labels', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js'), 'utf8');
    const apiSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'api', 'school.js'), 'utf8');

    expect(mainSource).toContain('teacherData.schoolDataLoadError');
    expect(mainSource).toContain('No classes are assigned to your teacher account.');
    expect(mainSource).toContain('Student record was not found in your assigned classes.');
    expect(mainSource).toContain("{ submitLabel: 'Create Student' }");
    expect(mainSource).toContain("submitLabel: 'Save Changes'");
    expect(mainSource).toContain('initializeTeacherWorkspaceHandlers(teacherData)');
    expect(mainSource).toContain('Array.isArray(teacherData.classes)');
    expect(mainSource).toContain('Array.isArray(teacherData.students)');
    expect(apiSource).toContain("message: error.message || 'Network request failed.'");
  });

  it('stores a workspace notification when a teacher creates an assignment', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js'), 'utf8');

    expect(mainSource).toContain("title: 'New assignment created'");
    expect(mainSource).toContain("message: `Assignment created for ${");
  });
});
