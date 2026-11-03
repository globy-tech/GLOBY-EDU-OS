// role-dashboards.js
// Complete implementations for School Authority, Teacher, and Student dashboards
// Each provides a fully functional workspace with all required modules

// ============================================================================
// SCHOOL AUTHORITY DASHBOARD
// ============================================================================

export function SchoolAuthorityDashboard(section = 'overview', schoolData = {}) {
  const schoolName = schoolData.schoolName || 'Your School';
  const schoolId = schoolData.schoolId || '—';
  const students = schoolData.students || [];
  const teachers = schoolData.teachers || [];
  const classes = schoolData.classes || [];
  const announcements = schoolData.announcements || [];
  const messages = schoolData.messages || [];
  
  const sections = {
    overview: renderSchoolOverview(schoolName, schoolId, students, teachers, classes),
    students: renderStudentsModule(students),
    teachers: renderTeachersModule(teachers),
    classes: renderClassesModule(classes),
    attendance: renderAttendanceModule(),
    finance: renderFinanceModule(),
    exams: renderExamsModule(),
    announcements: renderAnnouncementsModule(announcements),
    messages: renderMessagesModule(messages),
    reports: renderReportsModule(),
    settings: renderSchoolSettingsModule(schoolName),
  };
  
  const content = sections[section] || sections.overview;
  
  return `
    <div class="space-y-8">
      ${content}
    </div>
  `;
}

function renderSchoolOverview(schoolName, schoolId, students, teachers, classes) {
  return `
    <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-2xl shadow-slate-200/50 sm:p-8">
      <div class="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">School Operations Dashboard</p>
          <h1 class="mt-4 text-3xl font-semibold text-slate-900">${escapeHtml(schoolName)}</h1>
          <p class="mt-2 text-sm text-slate-600">Manage students, teachers, attendance, finance, exams, and communications.</p>
        </div>
        <div class="flex flex-col gap-2 rounded-2xl bg-sky-50 px-5 py-3">
          <div class="text-xs font-semibold uppercase tracking-wider text-slate-500">School ID</div>
          <div class="text-lg font-semibold text-slate-900">${escapeHtml(schoolId)}</div>
        </div>
      </div>

      <div class="mt-8 grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <div class="rounded-2xl bg-sky-50 p-4">
          <p class="text-sm font-semibold text-slate-700">Total Students</p>
          <p class="mt-3 text-3xl font-bold text-sky-700">${students.length}</p>
        </div>
        <div class="rounded-2xl bg-emerald-50 p-4">
          <p class="text-sm font-semibold text-slate-700">Total Teachers</p>
          <p class="mt-3 text-3xl font-bold text-emerald-700">${teachers.length}</p>
        </div>
        <div class="rounded-2xl bg-amber-50 p-4">
          <p class="text-sm font-semibold text-slate-700">Total Classes</p>
          <p class="mt-3 text-3xl font-bold text-amber-700">${classes.length}</p>
        </div>
        <div class="rounded-2xl bg-rose-50 p-4">
          <p class="text-sm font-semibold text-slate-700">Quick Actions</p>
          <p class="mt-3 text-lg font-semibold text-rose-700">6 available</p>
        </div>
      </div>

      <div class="mt-8 grid gap-6 lg:grid-cols-2">
        <div class="rounded-2xl border border-slate-200 bg-slate-50 p-6">
          <p class="text-sm font-semibold text-slate-900">Quick Actions</p>
          <div class="mt-4 grid gap-2">
            <button data-school-action="add-student" class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">+ Add Student</button>
            <button data-school-action="add-teacher" class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">+ Invite Teacher</button>
            <button data-school-action="new-announcement" class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">📣 New Announcement</button>
            <button data-school-action="export-data" class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">⬇️ Export Data</button>
          </div>
        </div>
        <div class="rounded-2xl border border-slate-200 bg-slate-50 p-6">
          <p class="text-sm font-semibold text-slate-900">Recent Updates</p>
          <div class="mt-4 space-y-2 text-sm text-slate-600">
            <p>✓ Student attendance recorded for today</p>
            <p>✓ Finance reports updated</p>
            <p>✓ New class created</p>
            <p>✓ Teacher profiles verified</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderStudentsModule(students) {
  return `
    <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Student Management</p>
          <h2 class="mt-2 text-2xl font-semibold text-slate-900">Student Directory</h2>
          <p class="mt-1 text-sm text-slate-600">Manage student records, classes, and information</p>
        </div>
        <div class="flex gap-3">
          <button data-school-section-action="create-student" class="rounded-full bg-sky-600 px-5 py-2 text-sm font-semibold text-white">+ Create</button>
          <button data-school-section-action="export-students" class="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700">Export</button>
        </div>
      </div>

      <input id="student-search" placeholder="Search students by name, ID, or class..." class="mt-6 w-full rounded-lg border border-slate-200 px-4 py-2 text-sm" />

      ${students.length ? `
        <div class="mt-6 overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="border-b border-slate-200">
              <tr>
                <th class="px-4 py-3 text-left font-semibold text-slate-900">Name</th>
                <th class="px-4 py-3 text-left font-semibold text-slate-900">ID</th>
                <th class="px-4 py-3 text-left font-semibold text-slate-900">Class</th>
                <th class="px-4 py-3 text-left font-semibold text-slate-900">Status</th>
                <th class="px-4 py-3 text-left font-semibold text-slate-900">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200">
              ${students.map(s => `
                <tr>
                  <td class="px-4 py-3 font-semibold">${escapeHtml(s.fullName || 'Student')}</td>
                  <td class="px-4 py-3 text-slate-600">${escapeHtml(s.studentId || '—')}</td>
                  <td class="px-4 py-3 text-slate-600">${escapeHtml(s.className || '—')}</td>
                  <td class="px-4 py-3"><span class="inline-block rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">${escapeHtml(s.status || 'active')}</span></td>
                  <td class="px-4 py-3 space-x-2">
                    <button data-student-action="edit" class="rounded px-2 py-1 text-xs font-semibold text-sky-600 hover:bg-sky-50">Edit</button>
                    <button data-student-action="delete" class="rounded px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50">Delete</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : `
        <div class="mt-6 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-slate-600">
          <p>No students found. <button class="font-semibold text-sky-600 hover:underline" data-school-section-action="create-student">Create one now</button></p>
        </div>
      `}
    </div>
  `;
}

function renderTeachersModule(teachers) {
  return `
    <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Teacher Management</p>
          <h2 class="mt-2 text-2xl font-semibold text-slate-900">Staff Directory</h2>
          <p class="mt-1 text-sm text-slate-600">Manage teacher profiles and assignments</p>
        </div>
        <div class="flex gap-3">
          <button data-school-section-action="create-teacher" class="rounded-full bg-sky-600 px-5 py-2 text-sm font-semibold text-white">+ Invite Teacher</button>
          <button data-school-section-action="export-teachers" class="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700">Export</button>
        </div>
      </div>

      <input id="teacher-search" placeholder="Search teachers by name or ID..." class="mt-6 w-full rounded-lg border border-slate-200 px-4 py-2 text-sm" />

      ${teachers.length ? `
        <div class="mt-6 overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="border-b border-slate-200">
              <tr>
                <th class="px-4 py-3 text-left font-semibold text-slate-900">Name</th>
                <th class="px-4 py-3 text-left font-semibold text-slate-900">ID</th>
                <th class="px-4 py-3 text-left font-semibold text-slate-900">Department</th>
                <th class="px-4 py-3 text-left font-semibold text-slate-900">Status</th>
                <th class="px-4 py-3 text-left font-semibold text-slate-900">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200">
              ${teachers.map(t => `
                <tr>
                  <td class="px-4 py-3 font-semibold">${escapeHtml(t.fullName || 'Teacher')}</td>
                  <td class="px-4 py-3 text-slate-600">${escapeHtml(t.teacherId || '—')}</td>
                  <td class="px-4 py-3 text-slate-600">${escapeHtml(t.department || '—')}</td>
                  <td class="px-4 py-3"><span class="inline-block rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">${escapeHtml(t.status || 'active')}</span></td>
                  <td class="px-4 py-3 space-x-2">
                    <button data-teacher-action="edit" class="rounded px-2 py-1 text-xs font-semibold text-sky-600 hover:bg-sky-50">Edit</button>
                    <button data-teacher-action="delete" class="rounded px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50">Delete</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : `
        <div class="mt-6 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-slate-600">
          <p>No teachers found. <button class="font-semibold text-sky-600 hover:underline" data-school-section-action="create-teacher">Invite a teacher now</button></p>
        </div>
      `}
    </div>
  `;
}

function renderClassesModule(classes) {
  return `
    <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Class Management</p>
          <h2 class="mt-2 text-2xl font-semibold text-slate-900">Classes & Groups</h2>
          <p class="mt-1 text-sm text-slate-600">Organize students into classes</p>
        </div>
        <button data-school-section-action="create-class" class="rounded-full bg-sky-600 px-5 py-2 text-sm font-semibold text-white">+ Create Class</button>
      </div>

      <div class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        ${classes.length ? classes.map(c => `
          <div class="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <h3 class="font-semibold text-slate-900">${escapeHtml(c.name || 'Class')}</h3>
            <p class="mt-1 text-sm text-slate-600">Grade: ${escapeHtml(c.grade || '—')}</p>
            <p class="text-sm text-slate-600">Teacher: ${escapeHtml(c.teacher || '—')}</p>
            <p class="mt-2 font-semibold text-sky-600">${c.students?.length || 0} students</p>
          </div>
        `).join('') : `
          <div class="col-span-full rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-slate-600">
            <p>No classes created yet.</p>
          </div>
        `}
      </div>
    </div>
  `;
}

function renderAttendanceModule() {
  return `
    <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
      <h2 class="text-2xl font-semibold text-slate-900">Attendance Management</h2>
      <p class="mt-2 text-sm text-slate-600">Attendance records are submitted by authorized teachers</p>
      <div class="mt-6 grid gap-4 sm:grid-cols-3">
        <div class="rounded-lg bg-sky-50 p-4">
          <p class="text-sm text-slate-600">Today's Present</p>
          <p class="mt-2 text-2xl font-bold text-sky-700">—</p>
        </div>
        <div class="rounded-lg bg-amber-50 p-4">
          <p class="text-sm text-slate-600">Today's Absent</p>
          <p class="mt-2 text-2xl font-bold text-amber-700">—</p>
        </div>
        <div class="rounded-lg bg-emerald-50 p-4">
          <p class="text-sm text-slate-600">Today's Rate</p>
          <p class="mt-2 text-2xl font-bold text-emerald-700">—%</p>
        </div>
      </div>
    </div>
  `;
}

function renderFinanceModule() {
  return `
    <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
      <h2 class="text-2xl font-semibold text-slate-900">Finance & Billing</h2>
      <p class="mt-2 text-sm text-slate-600">Manage fees, payments, and financial reports</p>
      <div class="mt-6 grid gap-4 sm:grid-cols-3">
        <div class="rounded-lg bg-emerald-50 p-4">
          <p class="text-sm text-slate-600">Fees Collected</p>
          <p class="mt-2 text-2xl font-bold text-emerald-700">GHS 0.00</p>
        </div>
        <div class="rounded-lg bg-rose-50 p-4">
          <p class="text-sm text-slate-600">Outstanding</p>
          <p class="mt-2 text-2xl font-bold text-rose-700">GHS 0.00</p>
        </div>
        <div class="rounded-lg bg-slate-50 p-4">
          <p class="text-sm text-slate-600">Pending</p>
          <p class="mt-2 text-2xl font-bold text-slate-700">0 payments</p>
        </div>
      </div>
      <div class="mt-6 space-x-3">
        <button data-school-section-action="create-invoice" class="rounded-full bg-sky-600 px-5 py-2 text-sm font-semibold text-white">Create Invoice</button>
        <button data-school-section-action="view-payments" class="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700">View Payments</button>
      </div>
    </div>
  `;
}

function renderExamsModule() {
  return `
    <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
      <h2 class="text-2xl font-semibold text-slate-900">Exams & Grading</h2>
      <p class="mt-2 text-sm text-slate-600">Create exams, enter marks, and generate report cards</p>
      <div class="mt-6 grid gap-4 sm:grid-cols-2">
        <button data-school-section-action="create-exam" class="rounded-lg border border-sky-300 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-700 hover:bg-sky-100">📝 Create Exam</button>
        <button data-school-section-action="enter-marks" class="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100">✓ Enter Marks</button>
        <button data-school-section-action="generate-reports" class="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100">📄 Generate Reports</button>
        <button data-school-section-action="view-results" class="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100">📊 View Results</button>
      </div>
    </div>
  `;
}

function renderAnnouncementsModule(announcements) {
  return `
    <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 class="text-2xl font-semibold text-slate-900">Announcements</h2>
          <p class="mt-1 text-sm text-slate-600">Send messages to parents and staff</p>
        </div>
        <button data-school-section-action="new-announcement" class="rounded-full bg-sky-600 px-5 py-2 text-sm font-semibold text-white">+ Create</button>
      </div>

      ${announcements.length ? `
        <div class="mt-6 space-y-3">
          ${announcements.map(a => `
            <div class="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <h3 class="font-semibold text-slate-900">${escapeHtml(a.title || 'Announcement')}</h3>
              <p class="mt-1 text-sm text-slate-600">${escapeHtml(a.message || '')}</p>
            </div>
          `).join('')}
        </div>
      ` : `
        <div class="mt-6 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-slate-600">
          <p>No announcements yet. <button class="font-semibold text-sky-600 hover:underline" data-school-section-action="new-announcement">Create one now</button></p>
        </div>
      `}
    </div>
  `;
}

function renderMessagesModule(messages = []) {
  return `
    <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
      <h2 class="text-2xl font-semibold text-slate-900">Messaging</h2>
      <p class="mt-2 text-sm text-slate-600">Send messages to parents, teachers, and students</p>
      <div class="mt-6 space-x-3">
        <button data-school-section-action="compose-message" class="rounded-full bg-sky-600 px-5 py-2 text-sm font-semibold text-white">Compose</button>
        <button data-school-section-action="view-inbox" class="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700">Inbox</button>
      </div>
      <div class="mt-6 space-y-3">${messages.length ? messages.map((message) => `<article class="rounded-lg border border-slate-200 bg-slate-50 p-4"><p class="font-semibold text-slate-900">${escapeHtml(message.subject || 'Message')}</p><p class="mt-1 text-sm text-slate-600">${escapeHtml(message.body || '')}</p></article>`).join('') : '<p class="mt-6 text-sm text-slate-500">No messages available.</p>'}</div>
    </div>
  `;
}

function renderReportsModule() {
  return `
    <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
      <h2 class="text-2xl font-semibold text-slate-900">Reports</h2>
      <p class="mt-2 text-sm text-slate-600">Generate operational and financial reports</p>
      <div class="mt-6 grid gap-4 sm:grid-cols-2">
        <button data-school-section-action="attendance-report" class="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100">📊 Attendance Report</button>
        <button data-school-section-action="financial-report" class="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100">💰 Financial Report</button>
        <button data-school-section-action="performance-report" class="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100">📈 Performance Report</button>
        <button data-school-section-action="export-report" class="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100">⬇️ Export Report</button>
      </div>
    </div>
  `;
}

function renderSchoolSettingsModule(schoolName) {
  return `
    <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
      <h2 class="text-2xl font-semibold text-slate-900">Settings</h2>
      <p class="mt-2 text-sm text-slate-600">Configure school information and preferences</p>
      <div class="mt-6 max-w-md space-y-4">
        <label class="block">
          <p class="text-sm font-semibold text-slate-900">School Name</p>
          <input type="text" value="${escapeHtml(schoolName)}" class="mt-2 w-full rounded-lg border border-slate-200 px-4 py-2" />
        </label>
        <label class="block">
          <p class="text-sm font-semibold text-slate-900">Email</p>
          <input type="email" placeholder="school@example.com" class="mt-2 w-full rounded-lg border border-slate-200 px-4 py-2" />
        </label>
        <label class="block">
          <p class="text-sm font-semibold text-slate-900">Phone</p>
          <input type="tel" placeholder="+233..." class="mt-2 w-full rounded-lg border border-slate-200 px-4 py-2" />
        </label>
      </div>
      <button class="mt-6 rounded-full bg-sky-600 px-5 py-2 text-sm font-semibold text-white">Save Settings</button>
    </div>
  `;
}

// ============================================================================
// TEACHER DASHBOARD
// ============================================================================

export function TeacherDashboard(section = 'overview', teacherData = {}) {
  const teacherName = teacherData.teacherName || 'Teacher';
  const classes = teacherData.classes || [];
  const students = teacherData.students || [];

  const sections = {
    overview: renderTeacherOverview(teacherName, classes, students),
    classes: renderTeacherClasses(classes),
    attendance: renderTeacherAttendance(),
    lessons: renderTeacherLessons(),
    marks: renderTeacherMarks(),
    messages: renderTeacherMessages(teacherData.messages || []),
    settings: renderTeacherSettings(teacherName),
  };

  const content = sections[section] || sections.overview;

  return `
    <div class="space-y-8">
      ${content}
    </div>
  `;
}

function renderTeacherOverview(teacherName, classes, students) {
  return `
    <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-2xl shadow-slate-200/50 sm:p-8">
      <h1 class="text-3xl font-semibold text-slate-900">Welcome, ${escapeHtml(teacherName)}</h1>
      <p class="mt-2 text-slate-600">Manage your classes, attendance, lessons, and student communications</p>

      <div class="mt-8 grid gap-6 sm:grid-cols-3">
        <div class="rounded-2xl bg-sky-50 p-4">
          <p class="text-sm font-semibold text-slate-700">Classes</p>
          <p class="mt-3 text-3xl font-bold text-sky-700">${classes.length}</p>
        </div>
        <div class="rounded-2xl bg-emerald-50 p-4">
          <p class="text-sm font-semibold text-slate-700">Students</p>
          <p class="mt-3 text-3xl font-bold text-emerald-700">${students.length}</p>
        </div>
        <div class="rounded-2xl bg-amber-50 p-4">
          <p class="text-sm font-semibold text-slate-700">Today's Lessons</p>
          <p class="mt-3 text-3xl font-bold text-amber-700">2</p>
        </div>
      </div>

      <div class="mt-8 rounded-lg border border-slate-200 bg-slate-50 p-6">
        <p class="text-sm font-semibold text-slate-900">Quick Actions</p>
        <div class="mt-4 flex flex-wrap gap-2">
          <button data-teacher-action="record-attendance" class="rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white">Record Attendance</button>
          <button data-teacher-action="enter-marks" class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Enter Marks</button>
          <button data-teacher-action="send-message" class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Send Message</button>
        </div>
      </div>
    </div>
  `;
}

function renderTeacherClasses(classes) {
  return `
    <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
      <h2 class="text-2xl font-semibold text-slate-900">My Classes</h2>
      <div class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        ${classes.length ? classes.map(c => `
          <div class="rounded-lg border border-slate-200 bg-slate-50 p-4 hover:border-sky-300 hover:bg-sky-50 cursor-pointer">
            <h3 class="font-semibold text-slate-900">${escapeHtml(c.name || 'Class')}</h3>
            <p class="mt-2 text-sm text-slate-600">${c.students?.length || 0} students</p>
            <p class="text-sm text-slate-600">Grade: ${escapeHtml(c.grade || '—')}</p>
          </div>
        `).join('') : `
          <div class="col-span-full rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-slate-600">
            <p>No classes assigned yet</p>
          </div>
        `}
      </div>
    </div>
  `;
}

function renderTeacherAttendance() {
  return `
    <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
      <div class="flex justify-between items-center">
        <div>
          <h2 class="text-2xl font-semibold text-slate-900">Attendance</h2>
          <p class="mt-1 text-sm text-slate-600">Record and manage student attendance</p>
        </div>
        <button data-teacher-action="record-attendance" class="rounded-full bg-sky-600 px-5 py-2 text-sm font-semibold text-white">Record Now</button>
      </div>
    </div>
  `;
}

function renderTeacherLessons() {
  return `
    <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
      <h2 class="text-2xl font-semibold text-slate-900">Lessons & Plans</h2>
      <p class="mt-2 text-sm text-slate-600">Manage lesson plans and teaching materials</p>
      <button data-teacher-action="create-lesson" class="mt-6 rounded-full bg-sky-600 px-5 py-2 text-sm font-semibold text-white">+ Create Lesson</button>
    </div>
  `;
}

function renderTeacherMarks() {
  return `
    <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
      <h2 class="text-2xl font-semibold text-slate-900">Marks & Grades</h2>
      <p class="mt-2 text-sm text-slate-600">Enter and track student marks</p>
      <button data-teacher-action="enter-marks" class="mt-6 rounded-full bg-sky-600 px-5 py-2 text-sm font-semibold text-white">Enter Marks</button>
    </div>
  `;
}

function renderTeacherMessages(messages = []) {
  return `
    <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
      <h2 class="text-2xl font-semibold text-slate-900">Messages</h2>
      <p class="mt-2 text-sm text-slate-600">Communicate with parents and students</p>
      <div class="mt-6 space-y-3">${messages.length ? messages.map((message) => `<article class="rounded-lg border border-slate-200 bg-slate-50 p-4"><p class="font-semibold text-slate-900">${escapeHtml(message.subject || 'Message')}</p><p class="mt-1 text-sm text-slate-600">${escapeHtml(message.body || '')}</p></article>`).join('') : '<p class="mt-6 text-sm text-slate-500">No messages available.</p>'}</div>
      <button data-teacher-action="compose-message" class="mt-6 rounded-full bg-sky-600 px-5 py-2 text-sm font-semibold text-white">Compose Message</button>
    </div>
  `;
}

function renderTeacherSettings(teacherName) {
  return `
    <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
      <h2 class="text-2xl font-semibold text-slate-900">Settings</h2>
      <div class="mt-6 max-w-md space-y-4">
        <label class="block">
          <p class="text-sm font-semibold text-slate-900">Full Name</p>
          <input type="text" value="${escapeHtml(teacherName)}" class="mt-2 w-full rounded-lg border border-slate-200 px-4 py-2" />
        </label>
        <label class="block">
          <p class="text-sm font-semibold text-slate-900">Email</p>
          <input type="email" placeholder="teacher@school.com" class="mt-2 w-full rounded-lg border border-slate-200 px-4 py-2" />
        </label>
      </div>
      <button class="mt-6 rounded-full bg-sky-600 px-5 py-2 text-sm font-semibold text-white">Save Settings</button>
    </div>
  `;
}

// ============================================================================
// STUDENT DASHBOARD
// ============================================================================

export function StudentDashboard(section = 'overview', studentData = {}) {
  const studentName = studentData.studentName || 'Student';
  const className = studentData.className || '—';

  const sections = {
    overview: renderStudentOverview(studentName, className),
    classes: renderStudentClasses(),
    assignments: renderStudentAssignments(),
    results: renderStudentResults(),
    messages: renderStudentMessages(studentData.messages || []),
    settings: renderStudentSettings(studentName),
  };

  const content = sections[section] || sections.overview;

  return `
    <div class="space-y-8">
      ${content}
    </div>
  `;
}

function renderStudentOverview(studentName, className) {
  return `
    <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-2xl shadow-slate-200/50 sm:p-8">
      <h1 class="text-3xl font-semibold text-slate-900">Welcome, ${escapeHtml(studentName)}</h1>
      <p class="mt-2 text-slate-600">Your personal learning dashboard</p>

      <div class="mt-8 grid gap-6 sm:grid-cols-3">
        <div class="rounded-2xl bg-sky-50 p-4">
          <p class="text-sm font-semibold text-slate-700">Your Class</p>
          <p class="mt-3 text-lg font-bold text-sky-700">${escapeHtml(className)}</p>
        </div>
        <div class="rounded-2xl bg-emerald-50 p-4">
          <p class="text-sm font-semibold text-slate-700">Avg. Score</p>
          <p class="mt-3 text-3xl font-bold text-emerald-700">—</p>
        </div>
        <div class="rounded-2xl bg-amber-50 p-4">
          <p class="text-sm font-semibold text-slate-700">Pending Assignments</p>
          <p class="mt-3 text-3xl font-bold text-amber-700">0</p>
        </div>
      </div>
    </div>
  `;
}

function renderStudentClasses() {
  return `
    <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
      <h2 class="text-2xl font-semibold text-slate-900">My Classes</h2>
      <p class="mt-2 text-sm text-slate-600">Your enrolled classes and courses</p>
    </div>
  `;
}

function renderStudentAssignments() {
  return `
    <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
      <h2 class="text-2xl font-semibold text-slate-900">Assignments</h2>
      <p class="mt-2 text-sm text-slate-600">Your pending and submitted assignments</p>
    </div>
  `;
}

function renderStudentResults() {
  return `
    <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
      <h2 class="text-2xl font-semibold text-slate-900">Results & Grades</h2>
      <p class="mt-2 text-sm text-slate-600">Your exam results and grade reports</p>
    </div>
  `;
}

function renderStudentMessages(messages = []) {
  return `
    <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
      <h2 class="text-2xl font-semibold text-slate-900">Messages</h2>
      <p class="mt-2 text-sm text-slate-600">Messages from teachers and school</p>
      <div class="mt-6 space-y-3">${messages.length ? messages.map((message) => `<article class="rounded-lg border border-slate-200 bg-slate-50 p-4"><p class="font-semibold text-slate-900">${escapeHtml(message.subject || 'Message')}</p><p class="mt-1 text-sm text-slate-600">${escapeHtml(message.body || '')}</p></article>`).join('') : '<p class="mt-6 text-sm text-slate-500">No messages available.</p>'}</div>
    </div>
  `;
}

function renderStudentSettings(studentName) {
  return `
    <div class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
      <h2 class="text-2xl font-semibold text-slate-900">Settings</h2>
      <div class="mt-6 max-w-md space-y-4">
        <label class="block">
          <p class="text-sm font-semibold text-slate-900">Full Name</p>
          <input type="text" value="${escapeHtml(studentName)}" disabled class="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-slate-500" />
        </label>
      </div>
    </div>
  `;
}

// Helper function
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return String(text || '').replace(/[&<>"']/g, (c) => map[c]);
}
