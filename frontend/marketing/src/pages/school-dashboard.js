// school-dashboard.js
// Tenant-scoped school head dashboard foundation with live summary metrics,
// profile controls, academic structure management, search, and permissions.

import { MetricCard } from '../components/metric-card.js';
import { SetupProgressIndicator } from '../components/setup-progress.js';
import { AttendanceTrendChart, FeeCollectionChart, StudentGrowthChart, MonthlyRevenueChart, TeacherAttendanceChart } from '../components/charts.js';
import { formatCurrencyValue, getSchoolCurrency } from '../utils/currency-utils.js';
import { getAttendanceClassOptions, getAttendancePeriodOptions, getAttendanceStatusLabel, getAttendanceStudentOptions, summarizeAttendanceRecords } from '../utils/attendance-summary.mjs';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeExamItems(records = []) {
  const list = Array.isArray(records) ? records : [];
  return list.map((entry, index) => ({
    id: entry.id || `exam-${index + 1}`,
    title: entry.title || entry.examName || entry.name || 'Assessment',
    examType: entry.examType || entry.type || 'Custom exam',
    subject: entry.subject || 'General Studies',
    className: entry.className || entry.class || entry.classroom || 'All classes',
    section: entry.section || 'Main',
    teacher: entry.teacher || 'Assigned teacher',
    date: entry.date || entry.examDate || 'TBD',
    status: entry.status || (entry.published ? 'Published' : 'Draft'),
    academicYear: entry.academicYear || '2025/2026',
    term: entry.term || 'Term 1',
    maxMarks: entry.maxMarks || 100,
    passingMarks: entry.passingMarks || 40,
    remarks: entry.remarks || entry.remark || 'Ready for marking',
    ...entry,
  }));
}

function normalizeExamResults(results = []) {
  const list = Array.isArray(results) ? results : [];
  return list.map((entry, index) => {
    const maxMarks = Number(entry.maxMarks || entry.maximumMarks || 100);
    const rawMark = entry.mark ?? entry.score ?? entry.total;
    const hasMark = rawMark !== undefined && rawMark !== null && rawMark !== '';
    const mark = hasMark ? Number(rawMark) : undefined;
    const passingMarks = Number(entry.passingMarks || entry.passMark || 40);
    const average = hasMark && maxMarks ? Math.round((mark / maxMarks) * 100) : undefined;
    const passed = hasMark ? mark >= passingMarks : undefined;
    return {
      id: entry.id || `result-${index + 1}`,
      student: entry.student || 'Student',
      subject: entry.subject || 'Subject',
      className: entry.className || entry.class || 'All classes',
      exam: entry.exam || entry.examName || 'Assessment',
      mark,
      maxMarks,
      passingMarks,
      average,
      passed,
      grade: entry.grade || '—',
      remark: entry.remark || (passed ? 'Competent performance' : 'Needs support'),
      term: entry.term || 'Term 1',
      academicYear: entry.academicYear || '2025/2026',
      ...entry,
    };
  });
}

function normalizeGradingSystem(gradingSystem = []) {
  const defaults = [
    { label: 'A', min: 80 },
    { label: 'B', min: 70 },
    { label: 'C', min: 60 },
    { label: 'D', min: 50 },
    { label: 'E', min: 40 },
    { label: 'F', min: 0 },
  ];
  const list = Array.isArray(gradingSystem) && gradingSystem.length ? gradingSystem : defaults;
  return list.map((entry) => ({
    label: entry.label || entry.name || 'Grade',
    min: Number(entry.min || entry.minimum || entry.threshold || 0),
  })).filter((entry) => entry.label);
}

function getGradeForMark(mark, gradingSystem = []) {
  const numericMark = Number(mark) || 0;
  const scale = normalizeGradingSystem(gradingSystem).sort((left, right) => right.min - left.min);
  const found = scale.find((entry) => numericMark >= Number(entry.min || 0));
  return found ? found.label : 'F';
}

function renderReportSheets(results = [], students = [], schoolName = '') {
  const studentById = new Map();
  const studentByName = new Map();
  (Array.isArray(students) ? students : []).forEach((student) => {
    const id = student.studentId || student.id || student.email;
    const name = student.fullName || student.name || student.email;
    if (id) studentById.set(String(id).trim().toLowerCase(), student);
    if (name) studentByName.set(String(name).trim().toLowerCase(), student);
  });
  const groups = new Map();
  (Array.isArray(results) ? results : []).filter((entry) => Array.isArray(entry.reportColumns) && Array.isArray(entry.reportCells)).forEach((entry) => {
    const key = [
      entry.studentId || entry.student || '',
      entry.exam || entry.examName || '',
      entry.term || '',
      entry.academicYear || '',
    ].map((value) => String(value).trim().toLowerCase()).join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  });
  return Array.from(groups.values()).map((entries) => {
    const first = entries[0];
    const columns = first.reportColumns;
    const studentId = String(first.studentId || '').trim().toLowerCase();
    const studentName = String(first.student || '').trim().toLowerCase();
    const student = studentById.get(studentId) || studentByName.get(studentName);
    const displayName = student?.fullName || student?.name || first.student || 'Student';
    const photo = student?.profilePhoto || student?.passportPhoto || '';
    return `
      <article data-report-card class="rounded-2xl border border-slate-200 bg-white p-4">
        <div class="report-card-header mb-3 flex flex-wrap items-start justify-between gap-2">
          <div class="flex items-center gap-3">
            ${photo ? `<img class="report-card-photo h-16 w-16 rounded-full object-cover" src="${escapeHtml(photo)}" alt="${escapeHtml(displayName)}" />` : `<div class="report-card-photo-fallback flex h-16 w-16 items-center justify-center rounded-full bg-sky-100 text-xl font-semibold text-sky-700">${escapeHtml(displayName.charAt(0).toUpperCase())}</div>`}
            <div><p class="font-semibold text-slate-900">${escapeHtml(displayName)}</p><p class="mt-1 text-sm text-slate-600">${escapeHtml(schoolName || first.schoolName || '')}</p><p class="mt-1 text-sm text-slate-600">${escapeHtml(first.exam || 'Assessment')} · ${escapeHtml(first.term || 'Term 1')} · ${escapeHtml(first.academicYear || '')}</p></div>
          </div>
          <div class="flex items-center gap-2">
            <span class="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">${escapeHtml(first.className || student?.className || 'Class')}</span>
            <button type="button" data-print-report-card class="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">Print report card</button>
          </div>
        </div>
        <div class="overflow-x-auto rounded-xl border border-slate-200">
          <table class="report-card-table min-w-full border-collapse text-left text-sm">
            <thead class="bg-slate-50 text-slate-700"><tr>${columns.map((column) => `<th class="whitespace-nowrap px-3 py-2 font-semibold">${escapeHtml(column)}</th>`).join('')}</tr></thead>
            <tbody>${entries.map((entry) => `<tr class="border-t border-slate-200">${columns.map((_, index) => `<td class="whitespace-nowrap px-3 py-2 text-slate-700">${escapeHtml(entry.reportCells[index] || '')}</td>`).join('')}</tr>`).join('')}</tbody>
          </table>
        </div>
      </article>`;
  }).join('');
}

function buildExamDashboardMetrics(exams = [], results = [], gradingSystem = []) {
  const examList = normalizeExamItems(exams);
  const resultList = normalizeExamResults(results);
  const scoredResultList = resultList.filter((entry) => entry.mark !== undefined && entry.mark !== null);
  const upcomingExams = examList.filter((exam) => String(exam.status || '').toLowerCase() !== 'completed' && String(exam.status || '').toLowerCase() !== 'published').length;
  const completedExams = examList.filter((exam) => String(exam.status || '').toLowerCase() === 'completed' || String(exam.status || '').toLowerCase() === 'published').length;
  const pendingMarking = examList.filter((exam) => String(exam.status || '').toLowerCase() === 'draft' || String(exam.status || '').toLowerCase() === 'pending-marking').length;
  const averagePerformance = scoredResultList.length
    ? Math.round(scoredResultList.reduce((sum, entry) => sum + Number(entry.average || 0), 0) / scoredResultList.length)
    : 0;
  const passRate = scoredResultList.length
    ? Math.round((scoredResultList.filter((entry) => entry.passed).length / scoredResultList.length) * 100)
    : 0;
  const failRate = scoredResultList.length ? Math.max(0, 100 - passRate) : 0;
  const topClass = scoredResultList.length
    ? scoredResultList.reduce((best, entry) => (entry.average > best.average ? entry : best), scoredResultList[0]).className || '—'
    : '—';
  const lowestClass = scoredResultList.length
    ? scoredResultList.reduce((worst, entry) => (entry.average < worst.average ? entry : worst), scoredResultList[0]).className || '—'
    : '—';

  return {
    upcomingExams,
    completedExams,
    pendingMarking,
    averagePerformance,
    passRate,
    failRate,
    topClass,
    lowestClass,
    gradeScale: normalizeGradingSystem(gradingSystem).map((entry) => `${entry.label} (${entry.min}+)`).join(', '),
  };
}

export function SchoolDashboardPage(summary = {}, section = 'overview', sectionData = {}) {
  const totalStudents = summary.studentCount !== undefined ? summary.studentCount : summary.totalStudents ?? '—';
  const totalTeachers = summary.teacherCount !== undefined ? summary.teacherCount : summary.totalTeachers ?? '—';
  const totalStaff = summary.staffCount !== undefined ? summary.staffCount : summary.staffCount ?? '—';
  const activeClasses = summary.classCount !== undefined ? summary.classCount : '—';
  const activeSubjects = summary.subjectCount !== undefined ? summary.subjectCount : '—';
  const attendanceToday = summary.attendanceSummary?.attendanceToday ?? '—';
  const feesCollectedToday = summary.feesSummary?.collectedToday ?? '—';
  const outstandingFees = summary.feesSummary?.outstanding ?? '—';
  const aiTutorStatus = summary.performanceSummary?.aiTutorStatus || 'Available';
  const academicYear = summary.performanceSummary?.academicYear || '—';
  const currentTerm = summary.performanceSummary?.currentTerm || '—';
  const recentActivities = Array.isArray(summary.recentActivities) ? summary.recentActivities : [];
  const upcomingEvents = Array.isArray(summary.upcomingEvents) ? summary.upcomingEvents : [];
  const schoolNotices = Array.isArray(summary.schoolNotices) ? summary.schoolNotices : [];
  const schoolName = summary.name || 'Your School';
  const schoolId = summary.schoolId || sectionData.school?.schoolId || localStorage.getItem('globyedu_schoolId') || '';
  const schoolStatus = summary.schoolStatus || 'active';
  const logoUrl = summary.logo || sectionData.school?.logo || '';
  const coverImage = summary.coverImage || sectionData.school?.coverImage || '';
  const departmentCount = summary.departmentCount ?? '—';
  const subjectCount = summary.subjectCount ?? '—';
  const academicYearCount = summary.academicYearCount ?? '—';
  const termCount = summary.termCount ?? '—';
  const semesterCount = summary.semesterCount ?? '—';

  const students = Array.isArray(sectionData.students) ? sectionData.students : [];
  const teachers = Array.isArray(sectionData.teachers) ? sectionData.teachers : [];
  const classes = Array.isArray(sectionData.classes) ? sectionData.classes : Array.isArray(sectionData.school?.classes) ? sectionData.school.classes : [];
  const attendanceRecords = Array.isArray(sectionData.attendanceRecords) ? sectionData.attendanceRecords : [];
  const payments = Array.isArray(sectionData.payments) ? sectionData.payments : [];
  const financeCategories = Array.isArray(sectionData.financeCategories) ? sectionData.financeCategories : [];
  const invoices = Array.isArray(sectionData.invoices) ? sectionData.invoices : [];
  const receipts = Array.isArray(sectionData.receipts) ? sectionData.receipts : [];
  const refunds = Array.isArray(sectionData.refunds) ? sectionData.refunds : [];
  const announcements = Array.isArray(sectionData.announcements) ? sectionData.announcements : [];
  const messages = Array.isArray(sectionData.messages) ? sectionData.messages : [];
  const reports = Array.isArray(sectionData.reports) ? sectionData.reports : [];
  const academicRecords = Array.isArray(sectionData.academicRecords) ? sectionData.academicRecords : [];
  const examSchedules = Array.isArray(sectionData.examSchedules) ? sectionData.examSchedules : [];
  const gradeEntries = Array.isArray(sectionData.gradeEntries) ? sectionData.gradeEntries : [];
  const reportCards = Array.isArray(sectionData.reportCards) ? sectionData.reportCards : [];
  const examRecords = Array.isArray(sectionData.examRecords) ? sectionData.examRecords : [];
  const examResults = Array.isArray(sectionData.examResults) ? sectionData.examResults : [];
  const gradingSystem = Array.isArray(sectionData.gradingSystem) ? sectionData.gradingSystem : [];
  const teacherActivity = Array.isArray(sectionData.teacherActivity) ? sectionData.teacherActivity : [];
  const teacherActivityLoadError = sectionData.teacherActivityLoadError || '';
  const school = sectionData.school || summary || {};
  const attendanceDate = sectionData.attendanceViewDate || new Date().toISOString().slice(0, 10);
  const attendanceClasses = getAttendanceClassOptions(classes);
  const attendanceViewClass = sectionData.attendanceViewClass || 'all';
  const attendanceStudents = getAttendanceStudentOptions(attendanceRecords);
  const attendanceViewStudent = sectionData.attendanceViewStudent || 'all';
  const attendanceTerms = getAttendancePeriodOptions(attendanceRecords, 'term');
  const attendanceAcademicYears = getAttendancePeriodOptions(attendanceRecords, 'academicYear');
  const attendanceViewTerm = sectionData.attendanceViewTerm || 'all';
  const attendanceViewAcademicYear = sectionData.attendanceViewAcademicYear || 'all';
  const attendanceSummary = summarizeAttendanceRecords(
    attendanceRecords,
    attendanceDate,
    classes,
    attendanceViewClass,
    attendanceViewStudent,
    attendanceViewTerm,
    attendanceViewAcademicYear,
  );
  const normalizedExamRecords = normalizeExamItems(examRecords.length ? examRecords : examSchedules);
  const normalizedExamResults = normalizeExamResults(examResults.length ? examResults : gradeEntries);
  const reportSheetResults = normalizedExamResults.filter((entry) => Array.isArray(entry.reportColumns) && Array.isArray(entry.reportCells));
  const legacyExamResults = normalizedExamResults.filter((entry) => !Array.isArray(entry.reportColumns) || !Array.isArray(entry.reportCells));
  const examDashboardMetrics = buildExamDashboardMetrics(examRecords.length ? examRecords : examSchedules, examResults.length ? examResults : gradeEntries, gradingSystem);

  const sectionContent = {
    teacherActivity: `
      <div class="space-y-6">
        <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Teacher Activity</p>
          <h2 class="mt-2 text-2xl font-semibold text-slate-900">Dated school activity log</h2>
          <p class="mt-3 text-sm text-slate-600">Review teacher attendance, marks, assignments, lessons, student-record changes, and message activity. Message contents and sensitive student details are not shown in this log.</p>
        </div>
        ${teacherActivityLoadError ? `<div role="alert" class="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">${escapeHtml(teacherActivityLoadError)}</div>` : ''}
        <div class="space-y-3">
          ${teacherActivity.length ? teacherActivity.map((entry) => {
            const actionLabels = {
              'teacher.attendance.updated': 'Attendance records updated',
              'teacher.marks.updated': 'Student marks updated',
              'teacher.assignment.created': 'Assignment created',
              'teacher.lesson.created': 'Learning material created',
              'teacher.message.sent': 'Message sent',
              'teacher.message.updated': 'Message activity updated',
              'teacher.message.deleted': 'Message deleted',
              'teacher.profile.updated': 'Teacher profile updated',
              'student.created': 'Student record created',
              'student.updated': 'Student record updated',
              'student.archived': 'Student record archived',
            };
            const action = String(entry.action || '');
            const label = actionLabels[action] || action.replace(/^teacher\\./, '').replace(/[._-]/g, ' ');
            const actor = String(entry.actorId || 'Teacher').split(':').pop();
            const timestamp = entry.createdAt ? new Date(entry.createdAt).toLocaleString() : 'Date unavailable';
            const metadata = entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {};
            const details = [
              metadata.title,
              metadata.className,
              metadata.subject,
              metadata.recordCount ? `${metadata.recordCount} record${metadata.recordCount === 1 ? '' : 's'}` : '',
              metadata.date,
              metadata.recipientCount ? `${metadata.recipientCount} recipient${metadata.recipientCount === 1 ? '' : 's'}` : '',
            ].filter(Boolean).join(' • ');
            return `<article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p class="font-semibold capitalize text-slate-900">${escapeHtml(label)}</p>
                  <p class="mt-1 text-sm text-slate-600">By ${escapeHtml(actor)}${details ? ` • ${escapeHtml(details)}` : ''}</p>
                </div>
                <time class="text-xs text-slate-500">${escapeHtml(timestamp)}</time>
              </div>
            </article>`;
          }).join('') : teacherActivityLoadError ? '' : '<div class="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">No teacher activity has been recorded yet.</div>'}
        </div>
      </div>
    `,
    notifications: `
      <div class="space-y-6">
        <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Notifications</p>
          <h2 class="mt-2 text-2xl font-semibold text-slate-900">Unread, read, announcements, and alerts</h2>
          <p class="mt-3 text-sm text-slate-600">Use the notification center to track school updates, payment notices, and AI prompts.</p>
        </div>
        <div class="rounded-4xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
          <div class="flex flex-wrap gap-3">
            <button type="button" data-workspace-notification-filter="all" class="rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white">All</button>
            <button type="button" data-workspace-notification-filter="unread" class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Unread</button>
            <button type="button" data-workspace-notification-filter="announcements" class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Announcements</button>
            <button type="button" data-workspace-notification-filter="alerts" class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Alerts</button>
          </div>
          <div class="mt-5 space-y-3" id="workspace-notifications-list"></div>
        </div>
      </div>
    `,
    messages: `
      <div class="space-y-6">
        <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Messaging</p>
          <h2 class="mt-2 text-2xl font-semibold text-slate-900">Inbox, sent, drafts, reply, forward, and search</h2>
        </div>
        <div class="rounded-4xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
          <div class="flex flex-wrap gap-3">
            <button type="button" data-workspace-message-folder="inbox" class="rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white">Inbox</button>
            <button type="button" data-workspace-message-folder="sent" class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Sent</button>
            <button type="button" data-workspace-message-folder="drafts" class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Drafts</button>
            <button type="button" data-workspace-message-compose class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Compose message</button>
          </div>
          <input id="workspace-message-search" class="mt-4 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm" placeholder="Search messages" />
          <div class="mt-5 space-y-3" id="workspace-messages-list"></div>
        </div>
      </div>
    `,
    schoolProfile: `
      <div class="space-y-6">
        <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Profile</p>
          <h2 class="mt-2 text-2xl font-semibold text-slate-900">Manage your profile and contact information</h2>
        </div>
        <div class="rounded-4xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
          <div class="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
            <div class="rounded-4xl border border-slate-200 bg-white p-5">
              <p class="text-sm font-semibold text-slate-900">Profile photo</p>
              <div class="mt-4 flex items-center gap-4">
                <div class="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-sky-100 text-xl font-semibold text-sky-700">
                  <span data-school-profile-initial>${escapeHtml(((sectionData.profile && sectionData.profile.fullName) || school.name || 'U').slice(0, 1))}</span>
                  <img data-school-profile-photo alt="Profile photo" class="hidden absolute inset-0 h-full w-full object-cover" />
                </div>
                <div>
                  <p class="font-semibold text-slate-900">${escapeHtml((sectionData.profile && sectionData.profile.fullName) || school.name || 'User')}</p>
                  <p class="text-sm text-slate-600">${escapeHtml((sectionData.profile && sectionData.profile.email) || summary.email || '')}</p>
                </div>
              </div>
              <label class="mt-5 inline-flex cursor-pointer rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white">
                Upload photo
                <input data-account-profile-photo-input type="file" accept="image/jpeg,image/png,image/gif,image/webp" class="sr-only" />
              </label>
              <button type="button" data-account-profile-camera class="ml-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">Use camera</button>
              <p data-account-profile-photo-status class="mt-2 text-sm text-slate-600" role="status" aria-live="polite"></p>
            </div>
            <div class="rounded-4xl border border-slate-200 bg-white p-5">
              <p class="text-sm font-semibold text-slate-900">Personal information</p>
              <div class="mt-4 grid gap-4 md:grid-cols-2">
                <label class="text-sm text-slate-700">Full name<input id="workspace-profile-fullname" value="${escapeHtml((sectionData.profile && sectionData.profile.fullName) || school.name || '')}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" /></label>
                <label class="text-sm text-slate-700">Email<input id="workspace-profile-email" value="${escapeHtml((sectionData.profile && sectionData.profile.email) || '')}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" /></label>
                <label class="text-sm text-slate-700">Phone<input id="workspace-profile-phone" value="${escapeHtml((sectionData.profile && sectionData.profile.phone) || '')}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" /></label>
              </div>
              <p class="mt-4 text-sm text-amber-800">Profile edits are browser-only drafts. Account updates and two-factor authentication are not available through this service.</p>
              <div class="mt-4 flex flex-wrap gap-3">
                <button type="button" data-workspace-profile-save class="rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white">Save browser draft</button>
                <button type="button" data-workspace-profile-2fa class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">2FA unavailable</button>
              </div>
            </div>
          </div>
        </div>
        <div class="rounded-4xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
          <p class="text-sm font-semibold text-slate-900">Security and devices</p>
          <div class="mt-4 space-y-3">
            <div class="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Login devices: 2 active sessions on this browser and one trusted mobile device.</div>
            <div class="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Activity history: your recent workspace actions are tracked locally for continuity and can be synced to the backend later.</div>
          </div>
        </div>
      </div>
    `,
    schoolSettings: `
      <div class="space-y-6">
        <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Settings</p>
          <h2 class="mt-2 text-2xl font-semibold text-slate-900">Workspace preferences</h2>
          <p class="mt-3 text-sm text-amber-800">These preferences are stored in this browser only. Account security settings are not changed here.</p>
        </div>
        <div class="rounded-4xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
          <div class="grid gap-4 md:grid-cols-2">
            <label class="text-sm text-slate-700">Theme<input id="workspace-settings-theme" value="${escapeHtml((sectionData.settings && sectionData.settings.theme) || 'midnight')}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3" /></label>
            <label class="text-sm text-slate-700">Language<input id="workspace-settings-language" value="${escapeHtml((sectionData.settings && sectionData.settings.language) || 'English')}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3" /></label>
            <label class="text-sm text-slate-700">Timezone<input id="workspace-settings-timezone" value="${escapeHtml((sectionData.settings && sectionData.settings.timezone) || 'UTC')}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3" /></label>
            <p class="text-sm text-slate-600">Security settings are managed by your account provider.</p>
          </div>
          <div class="mt-6 flex flex-wrap gap-3">
            <button type="button" data-workspace-settings-save class="rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white">Save settings</button>
            <button type="button" data-workspace-settings-reset class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Reset defaults</button>
          </div>
        </div>
      </div>
    `,
    support: `
      <div class="space-y-6">
        <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Support</p>
          <h2 class="mt-2 text-2xl font-semibold text-slate-900">Create tickets, track progress, and reply from one place</h2>
        </div>
        <div class="rounded-4xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
          <div class="flex flex-wrap gap-3">
            <button type="button" data-workspace-support-create class="rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white">New ticket</button>
            <button type="button" data-workspace-support-filter="open" class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Open</button>
            <button type="button" data-workspace-support-filter="resolved" class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Resolved</button>
          </div>
          <div class="mt-5 space-y-3" id="workspace-support-list"></div>
        </div>
      </div>
    `,
    overview: `
      <div class="space-y-8">
        <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-2xl shadow-slate-200/50 sm:p-8 lg:p-10">
          <div class="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(schoolName)} logo" class="mb-4 h-16 w-16 rounded-xl border border-slate-200 bg-white object-contain p-2" />` : ''}
              <p class="text-sm uppercase tracking-[0.3em] text-slate-500">School Authority Workspace</p>
              <h1 class="mt-4 text-3xl font-semibold text-slate-900">${escapeHtml(schoolName)}</h1>
              <p class="mt-3 text-slate-600">A focused operational view for school summaries, attendance, revenue, fees, activity, and upcoming events.</p>
            </div>
            <div class="max-w-full break-all rounded-full bg-sky-50 px-5 py-3 text-sm font-semibold text-sky-700">School ID: <span id="school-dashboard-id">${escapeHtml(schoolId || '---')}</span></div>
          </div>

          <div class="mt-8 grid gap-4 sm:grid-cols-2 lg:gap-6 lg:grid-cols-4">
            ${MetricCard({ label: 'Total Students', value: totalStudents, description: 'Active learners in the tenant school.' })}
            ${MetricCard({ label: 'Total Teachers', value: totalTeachers, description: 'Teaching staff available to the school.' })}
            ${MetricCard({ label: 'Total Staff', value: totalStaff, description: 'Non-teaching staff linked to the school.' })}
            ${MetricCard({ label: 'Active Classes', value: activeClasses, description: 'Live class groups currently in use.' })}
          </div>

          <div class="mt-8 grid gap-4 sm:grid-cols-2 lg:gap-6 lg:grid-cols-4">
            ${MetricCard({ label: "Today's Attendance", value: attendanceToday, description: 'Current daily attendance snapshot.' })}
            ${MetricCard({ label: 'Today&apos;s Revenue', value: feesCollectedToday, description: 'Cashflow captured today.' })}
            ${MetricCard({ label: 'Outstanding Fees', value: outstandingFees, description: 'Open invoices requiring follow-up.' })}
            ${MetricCard({ label: 'Recent Activity', value: recentActivities.length, description: 'Latest school events and updates.' })}
          </div>
        </div>

        ${SetupProgressIndicator(sectionData.completedSetupSteps || [])}

        <div class="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
          ${AttendanceTrendChart(sectionData.attendanceTrendData || [])}
          ${FeeCollectionChart(sectionData.feeCollectionData || {}, getSchoolCurrency(school))}
          ${MonthlyRevenueChart(sectionData.monthlyRevenueData || [])}
        </div>

        <div class="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
            <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Recent Activities</p>
            <div class="mt-4 space-y-3">
              ${(recentActivities.length ? recentActivities : [{ title: 'No activity yet', detail: 'This tenant has not recorded recent activity.' }]).map((item) => `
                <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p class="text-sm font-semibold text-slate-900">${escapeHtml(item.title || 'Activity')}</p>
                  <p class="mt-1 text-sm text-slate-600">${escapeHtml(item.detail || '')}</p>
                </div>
              `).join('')}
            </div>
          </div>
          <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
            <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Upcoming Events</p>
            <div class="mt-4 space-y-3">
              ${(upcomingEvents.length ? upcomingEvents : [{ title: 'No events yet', detail: 'No school events have been scheduled.' }]).map((item) => `
                <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p class="text-sm font-semibold text-slate-900">${escapeHtml(item.title || 'Event')}</p>
                  <p class="mt-1 text-sm text-slate-600">${escapeHtml(item.detail || '')}</p>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="grid gap-6 lg:grid-cols-2">
          <div class="rounded-4xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
            <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Recent Announcements</p>
            <div class="mt-4 space-y-3">
              ${(schoolNotices.length ? schoolNotices : [{ title: 'No notices yet', detail: 'No school notices are available.' }]).map((item) => `
                <div class="rounded-2xl border border-slate-200 bg-white p-4">
                  <p class="text-sm font-semibold text-slate-900">${escapeHtml(item.title || 'Notice')}</p>
                  <p class="mt-1 text-sm text-slate-600">${escapeHtml(item.detail || '')}</p>
                </div>
              `).join('')}
            </div>
          </div>
          <div class="rounded-4xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
            <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Quick Actions</p>
            <div class="mt-4 grid gap-3 sm:grid-cols-2">
              ${renderQuickAction('Add Student', 'add-student')}
              ${renderQuickAction('Invite Teacher', 'add-teacher')}
              ${renderQuickAction('Create Announcement', 'create-announcement')}
              ${renderQuickAction('Send Message', 'send-message')}
              ${renderQuickAction('Create Class', 'create-class')}
              ${renderQuickAction('Generate Report', 'generate-report')}
            </div>
          </div>
        </div>
      </div>
    `,
    profile: `
      <div class="space-y-6">
        <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">School Profile</p>
          <h2 class="mt-2 text-2xl font-semibold text-slate-900">Complete school profile management</h2>
          <p class="mt-3 text-sm text-slate-600">Update branding, contact details, and profile data connected to the current tenant.</p>
        </div>
        <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
          <p class="text-sm font-semibold text-slate-900">Personal profile photo</p>
          <div class="mt-4 flex items-center gap-4">
            <div class="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-sky-100 text-xl font-semibold text-sky-700">
              <span data-school-profile-initial>${escapeHtml(String(summary.headName || summary.name || 'U').slice(0, 1))}</span>
              <img data-school-profile-photo alt="Profile photo" class="hidden absolute inset-0 h-full w-full object-cover" />
            </div>
            <div>
              <label class="inline-flex cursor-pointer rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white">
                Upload photo
                <input data-account-profile-photo-input type="file" accept="image/jpeg,image/png,image/gif,image/webp" class="sr-only" />
              </label>
              <button type="button" data-account-profile-camera class="ml-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">Use camera</button>
              <p data-account-profile-photo-status class="mt-2 text-sm text-slate-600" role="status" aria-live="polite"></p>
            </div>
          </div>
        </div>
        <div class="rounded-4xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
          <div class="grid gap-4 md:grid-cols-2">
            <label class="block text-sm text-slate-700">School Name<input id="school-profile-name" value="${escapeHtml(school.name || '')}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3" /></label>
            <label class="block text-sm text-slate-700">School Motto<input id="school-profile-motto" value="${escapeHtml(school.branding?.motto || '')}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3" /></label>
            <label class="block text-sm text-slate-700">Email<input id="school-profile-email" type="email" value="${escapeHtml(school.email || '')}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3" /></label>
            <label class="block text-sm text-slate-700">Phone<input id="school-profile-phone" value="${escapeHtml(school.phone || '')}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3" /></label>
            <label class="block text-sm text-slate-700">Website<input id="school-profile-website" value="${escapeHtml(school.website || '')}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3" /></label>
            <label class="block text-sm text-slate-700">Country<input id="school-profile-country" value="${escapeHtml(school.country || '')}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3" /></label>
            <label class="block text-sm text-slate-700">Region<input id="school-profile-region" value="${escapeHtml(school.region || '')}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3" /></label>
            <label class="block text-sm text-slate-700">City<input id="school-profile-city" value="${escapeHtml(school.city || school.branding?.city || '')}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3" /></label>
            <label class="block text-sm text-slate-700">School Type<input id="school-profile-type" value="${escapeHtml(school.schoolType || school.branding?.schoolType || '')}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3" /></label>
            <label class="block text-sm text-slate-700">School Level<input id="school-profile-level" value="${escapeHtml(school.schoolLevel || school.branding?.schoolLevel || '')}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3" /></label>
            <label class="block text-sm text-slate-700">School Colours<input id="school-profile-colours" value="${escapeHtml(school.branding?.colours || '')}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3" /></label>
            <label class="block text-sm text-slate-700 md:col-span-2">Description<textarea id="school-profile-description" rows="4" class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3">${escapeHtml(school.description || '')}</textarea></label>
          </div>
          <div class="mt-6 flex flex-wrap gap-3">
            <button type="button" data-school-profile-save class="rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700">Save changes</button>
            <button id="school-profile-edit" class="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">Manage branding</button>
            <button type="button" data-school-action="delete-logo" class="rounded-full border border-rose-200 bg-rose-50 px-5 py-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-100">Remove logo</button>
          </div>
        </div>
      </div>
    `,
    academic: `
      <div class="space-y-6">
        <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Academic Management</p>
          <h2 class="mt-2 text-2xl font-semibold text-slate-900">Academic years, terms, semesters, departments, classes and subjects</h2>
          <div class="mt-4 flex flex-wrap gap-3">
            <button type="button" data-school-section-action="create-academic-record" data-school-section-entity="departments" class="rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white">Create department</button>
            <button type="button" data-school-section-action="create-academic-record" data-school-section-entity="classes" class="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">Create class</button>
            <button type="button" data-school-section-action="create-academic-record" data-school-section-entity="subjects" class="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">Create subject</button>
            <button type="button" data-school-section-action="create-academic-record" data-school-section-entity="streams" class="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">Create stream</button>
            <button type="button" data-school-section-action="create-academic-record" data-school-section-entity="academic-years" class="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">Create academic year</button>
            <button type="button" data-school-section-action="create-academic-record" data-school-section-entity="terms" class="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">Create term</button>
            <button type="button" data-school-section-action="create-academic-record" data-school-section-entity="semesters" class="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-white">Create semester</button>
            <button type="button" data-school-export="academic" class="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">Export JSON</button>
            <label class="cursor-pointer rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">
              <input type="file" accept="application/json" data-school-import="academic" class="hidden" />Import JSON
            </label>
          </div>
        </div>
        <div class="rounded-4xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
          <div class="space-y-3">
            ${academicRecords.length ? academicRecords.map((item) => `
              <div class="rounded-2xl border border-slate-200 bg-white p-4">
                <div class="flex items-center justify-between gap-4">
                  <div>
                    <p class="font-semibold text-slate-900">${escapeHtml(item.name || item.label || item.fullName || item.title || 'Record')}</p>
                    <p class="mt-1 text-sm text-slate-500">${escapeHtml(item.description || item.code || item.email || item.status || '')}</p>
                  </div>
                  <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-slate-700">${escapeHtml(item.status || 'active')}</span>
                </div>
              </div>
            `).join('') : `<div class="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">No academic records have been created yet.</div>`}
          </div>
        </div>
      </div>
    `,
    students: `
      <div class="space-y-6">
        <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
          <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Student Management</p>
              <h2 class="mt-2 text-2xl font-semibold text-slate-900">Admissions, registration, profiles and guardian information</h2>
              <p class="mt-2 text-sm text-slate-600">Manage student records, class assignments, guardians, and active enrollment from one central workspace.</p>
            </div>
            <div class="flex flex-wrap gap-3">
              <button type="button" data-school-section-action="create-student" class="rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white">Create student</button>
              <button type="button" data-school-export="students" class="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">Export CSV</button>
              <label class="cursor-pointer rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">
                Import CSV
                <input type="file" accept=".csv,application/json" data-school-import="students" class="hidden" />
              </label>
            </div>
          </div>
          <div class="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div class="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
              <p class="font-semibold text-slate-900">Total students</p>
              <p class="mt-2 text-3xl font-semibold text-slate-900">${students.length}</p>
            </div>
            <div class="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
              <p class="font-semibold text-slate-900">Active learners</p>
              <p class="mt-2 text-3xl font-semibold text-slate-900">${students.filter((student) => String(student.status || '').toLowerCase() === 'active').length}</p>
            </div>
            <div class="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
              <p class="font-semibold text-slate-900">Classes represented</p>
              <p class="mt-2 text-3xl font-semibold text-slate-900">${new Set(students.map((student) => student.className || 'Unassigned')).size}</p>
            </div>
            <div class="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
              <p class="font-semibold text-slate-900">Guardian contacts</p>
              <p class="mt-2 text-3xl font-semibold text-slate-900">${new Set(students.map((student) => student.guardian || student.parentEmail || '')).size}</p>
            </div>
          </div>
        </div>
        <div class="rounded-4xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
          <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p class="text-sm font-semibold text-slate-900">Student directory</p>
              <p class="mt-2 text-sm text-slate-600">Search, view, edit, or archive student records in your school register.</p>
            </div>
            <input id="school-student-search" class="min-w-0 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" placeholder="Search students by name, ID, class, grade, or guardian" />
          </div>
          <div class="mt-6 max-w-full overflow-x-auto overscroll-x-contain" role="region" aria-label="Student directory table" tabindex="0">
            ${students.length ? `
              <table class="min-w-3xl divide-y divide-slate-200 text-sm text-slate-700">
                <thead class="bg-slate-100 text-slate-700">
                  <tr>
                    <th class="px-4 py-3 text-left font-semibold">Name</th>
                    <th class="px-4 py-3 text-left font-semibold">Student ID</th>
                    <th class="px-4 py-3 text-left font-semibold">Class</th>
                    <th class="px-4 py-3 text-left font-semibold">Grade</th>
                    <th class="px-4 py-3 text-left font-semibold">Guardian</th>
                    <th class="px-4 py-3 text-left font-semibold">Status</th>
                    <th class="px-4 py-3 text-left font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-200 bg-white">
                  ${students.map((student) => {
                    const studentClassName = student.className || sectionData.classes.find((entry) => String(entry.classId || entry.id) === String(student.classId))?.name || '';
                    const searchText = [student.fullName, student.email, student.studentId, student.admissionNumber, studentClassName, student.gradeLevel, student.grade, student.guardian, student.parentEmail].filter(Boolean).join(' ').toLowerCase();
                    const studentIdentifier = student.id || student.email || student.studentId || '';
                    const hasPendingDeletionRequest = student.metadata?.deletionRequest?.status === 'pending';
                    return `
                      <tr data-school-student-row data-school-student-id="${escapeHtml(student.id || student.email || student.studentId || '')}" data-search-text="${escapeHtml(searchText)}" class="${student.status === 'archived' ? 'opacity-60' : ''}">
                        <td class="px-4 py-4 font-semibold text-slate-900"><div class="flex items-center gap-3"><span class="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-emerald-100 text-xs font-semibold text-emerald-700">${student.profilePhoto ? `<img src="${escapeHtml(student.profilePhoto)}" alt="" class="h-full w-full object-cover" />` : escapeHtml((student.fullName || student.name || 'S').trim().charAt(0).toUpperCase())}</span><span>${escapeHtml(student.fullName || student.name || student.email || 'Student')}</span></div></td>
                        <td class="px-4 py-4">${escapeHtml(student.studentId || student.admissionNumber || '—')}</td>
                        <td class="px-4 py-4">${escapeHtml(studentClassName || '—')}</td>
                        <td class="px-4 py-4">${escapeHtml(student.gradeLevel || student.grade || '—')}</td>
                        <td class="px-4 py-4">${escapeHtml(student.guardian || student.parentEmail || '—')}</td>
                        <td class="px-4 py-4"><span class="inline-flex rounded-full ${student.status === 'archived' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'} px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em]">${escapeHtml(student.status || 'active')}</span></td>
                        <td class="px-4 py-4 space-x-1">
                          <button type="button" data-school-student-action="edit" data-school-student-id="${escapeHtml(student.id || student.email || student.studentId || '')}" class="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-100">Edit</button>
                          ${hasPendingDeletionRequest ? `<button type="button" data-school-student-action="approve-deletion" data-school-student-id="${escapeHtml(studentIdentifier)}" class="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100">Approve deletion</button><button type="button" data-school-student-action="reject-deletion" data-school-student-id="${escapeHtml(studentIdentifier)}" class="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">Reject</button>` : student.status === 'active' ? `<button type="button" data-school-student-action="archive" data-school-student-id="${escapeHtml(studentIdentifier)}" class="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100">Archive</button>` : `<button type="button" data-school-student-action="restore" data-school-student-id="${escapeHtml(studentIdentifier)}" class="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100">Restore</button>`}
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            ` : `<div class="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">No students have been created yet.</div>`}
          </div>
        </div>
      </div>
    `,
    teachers: `
      <div class="space-y-6">
        <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
          <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Teacher Management</p>
              <h2 class="mt-2 text-2xl font-semibold text-slate-900">Profiles, subjects, classes, assignments and performance</h2>
              <p class="mt-2 text-sm text-slate-600">Manage teacher records and assignments. Invite teachers by email; they verify their email and set their own password before signing in.</p>
            </div>
            <div class="flex flex-wrap gap-3">
              <button type="button" data-school-section-action="create-teacher" class="rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white">Invite Teacher</button>
              <button type="button" data-school-export="teachers" class="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">Export CSV</button>
            </div>
          </div>
          <div class="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div class="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
              <p class="font-semibold text-slate-900">Total teachers</p>
              <p class="mt-2 text-3xl font-semibold text-slate-900">${teachers.length}</p>
            </div>
            <div class="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
              <p class="font-semibold text-slate-900">Active staff</p>
              <p class="mt-2 text-3xl font-semibold text-slate-900">${teachers.filter((teacher) => String(teacher.status || '').toLowerCase() === 'active').length}</p>
            </div>
            <div class="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
              <p class="font-semibold text-slate-900">Class teachers</p>
              <p class="mt-2 text-3xl font-semibold text-slate-900">${teachers.filter((teacher) => teacher.classTeacher).length}</p>
            </div>
            <div class="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
              <p class="font-semibold text-slate-900">Departments</p>
              <p class="mt-2 text-3xl font-semibold text-slate-900">${new Set(teachers.map((teacher) => teacher.department || 'Unassigned')).size}</p>
            </div>
          </div>
        </div>
        <div class="rounded-4xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
          <div class="mt-6 max-w-full overflow-x-auto overscroll-x-contain" role="region" aria-label="Teacher directory table" tabindex="0">
            ${teachers.length ? `
              <table class="min-w-3xl divide-y divide-slate-200 text-sm text-slate-700">
                <thead class="bg-slate-100 text-slate-700">
                  <tr>
                    <th class="px-4 py-3 text-left font-semibold">Name</th>
                    <th class="px-4 py-3 text-left font-semibold">Teacher ID</th>
                    <th class="px-4 py-3 text-left font-semibold">Department</th>
                    <th class="px-4 py-3 text-left font-semibold">Position</th>
                    <th class="px-4 py-3 text-left font-semibold">Subjects</th>
                    <th class="px-4 py-3 text-left font-semibold">Status</th>
                    <th class="px-4 py-3 text-left font-semibold">Account access</th>
                    <th class="px-4 py-3 text-left font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-200 bg-white">
                  ${teachers.map((teacher) => {
                    const subjects = Array.isArray(teacher.assignedSubjects) ? teacher.assignedSubjects.join(', ') : (teacher.assignedSubjects || '—');
                    const verified = teacher.emailVerified === true || teacher.isVerified === true;
                    const invitationExpired = teacher.invitationExpiresAt && Date.parse(teacher.invitationExpiresAt) <= Date.now();
                    const invitationLabel = verified
                      ? 'Account activated'
                      : teacher.invitationEmailStatus === 'failed' || teacher.invitationStatus === 'failed'
                        ? 'Invitation email failed'
                        : teacher.invitationEmailStatus === 'provider_accepted'
                          ? 'Provider accepted; delivery unconfirmed'
                          : invitationExpired
                            ? 'Invitation expired'
                            : teacher.invitationStatus === 'pending'
                              ? 'Email verification pending'
                              : 'Not invited';
                    return `
                      <tr class="${teacher.status === 'archived' ? 'opacity-60' : ''}">
                        <td class="px-4 py-4 font-semibold text-slate-900"><div class="flex items-center gap-3"><span class="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-sky-100 text-xs font-semibold text-sky-700">${teacher.profilePhoto ? `<img src="${escapeHtml(teacher.profilePhoto)}" alt="" class="h-full w-full object-cover" />` : escapeHtml((teacher.fullName || teacher.name || 'T').trim().charAt(0).toUpperCase())}</span><span>${escapeHtml(teacher.fullName || teacher.name || teacher.email || 'Teacher')}</span></div></td>
                        <td class="px-4 py-4">${escapeHtml(teacher.teacherId || teacher.employeeNumber || '—')}</td>
                        <td class="px-4 py-4">${escapeHtml(teacher.department || '—')}</td>
                        <td class="px-4 py-4">${escapeHtml(teacher.position || '—')}</td>
                        <td class="px-4 py-4">${escapeHtml(subjects)}</td>
                        <td class="px-4 py-4"><span class="inline-flex rounded-full ${teacher.status === 'archived' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'} px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em]">${escapeHtml(teacher.status || 'active')}</span></td>
                        <td class="px-4 py-4">${escapeHtml(invitationLabel)}</td>
                        <td class="px-4 py-4 space-x-1">
                          ${teacher.invitationStatus && !verified && teacher.status === 'active' ? `<button type="button" data-school-teacher-action="resend-invitation" data-school-teacher-id="${escapeHtml(teacher.teacherId || '')}" class="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-100">Resend invite</button>` : ''}
                          <button type="button" data-school-teacher-action="edit" data-school-teacher-id="${escapeHtml(teacher.id || teacher.email || teacher.teacherId || '')}" class="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-100">Edit</button>
                          ${teacher.status === 'active' ? `<button type="button" data-school-teacher-action="archive" data-school-teacher-id="${escapeHtml(teacher.id || teacher.email || teacher.teacherId || '')}" class="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100">Archive</button>` : `<button type="button" data-school-teacher-action="restore" data-school-teacher-id="${escapeHtml(teacher.id || teacher.email || teacher.teacherId || '')}" class="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100">Restore</button><button type="button" data-school-teacher-action="delete" data-school-teacher-id="${escapeHtml(teacher.id || teacher.email || teacher.teacherId || '')}" class="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100">Delete</button>`}
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            ` : `<div class="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">No teachers have been created yet.</div>`}
          </div>
        </div>
      </div>
    `,
    classes: `
      <div class="space-y-6">
        <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
          <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Class Management</p>
              <h2 class="mt-2 text-2xl font-semibold text-slate-900">Classes, streams, teachers, and enrolled students</h2>
              <p class="mt-2 text-sm text-slate-600">Create and manage the class records used by student enrollment and attendance.</p>
            </div>
            <button type="button" data-school-section-action="create-academic-record" data-school-section-entity="classes" class="rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white">Create class</button>
          </div>
        </div>
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          ${(() => {
            const activeClassRecords = (Array.isArray(sectionData.classes) ? sectionData.classes : []).filter((entry) => String(entry.status || 'active').toLowerCase() !== 'archived');
            const classTeachers = Array.isArray(sectionData.teachers) ? sectionData.teachers : [];
            const classStudents = Array.isArray(sectionData.students) ? sectionData.students : [];
            if (!activeClassRecords.length) return '<div class="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600 md:col-span-2 xl:col-span-3">No classes have been created yet.</div>';
            return activeClassRecords.map((classRecord) => {
              const classId = classRecord.classId || classRecord.id || classRecord.name;
              const className = classRecord.name || classRecord.className || classId;
              const assignedTeacher = classTeachers.find((teacher) => String(teacher.teacherId || teacher.username || teacher.email) === String(classRecord.teacherId || classRecord.teacher || ''));
              const enrolledStudents = classStudents.filter((student) => {
                const sameClassId = student.classId && String(student.classId) === String(classId);
                const sameLegacyName = String(student.className || student.gradeLevel || student.grade || '').trim() === String(className).trim();
                return sameClassId || sameLegacyName;
              });
              return `<article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div class="flex items-start justify-between gap-3">
                  <div><h3 class="font-semibold text-slate-900">${escapeHtml(className)}</h3><p class="mt-1 text-sm text-slate-600">${escapeHtml(classRecord.grade || 'Class')} ${classRecord.section ? `• ${escapeHtml(classRecord.section)}` : ''}</p></div>
                  <span class="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">${enrolledStudents.length} student${enrolledStudents.length === 1 ? '' : 's'}</span>
                </div>
                <p class="mt-4 text-sm text-slate-600">Teacher: <span class="font-semibold text-slate-900">${escapeHtml(assignedTeacher?.fullName || assignedTeacher?.name || classRecord.teacher || 'Unassigned')}</span></p>
                <div class="mt-4 flex flex-wrap gap-2">
                  <button type="button" data-school-section-action="edit-class" data-class-id="${escapeHtml(classId)}" class="rounded-full border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700">Edit</button>
                  <button type="button" data-school-section-action="assign-class-teacher" data-class-id="${escapeHtml(classId)}" class="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">Assign teacher</button>
                </div>
                <div class="mt-4 border-t border-slate-100 pt-4"><p class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Students</p>${enrolledStudents.length ? `<ul class="mt-2 space-y-1 text-sm text-slate-700">${enrolledStudents.slice(0, 5).map((student) => `<li>${escapeHtml(student.fullName || student.name || student.studentId || 'Student')}</li>`).join('')}</ul>` : '<p class="mt-2 text-sm text-slate-500">No students enrolled yet.</p>'}</div>
              </article>`;
            }).join('');
          })()}
        </div>
      </div>
    `,
    attendance: `
      <div class="space-y-6">
        <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Attendance</p>
          <h2 class="mt-2 text-2xl font-semibold text-slate-900">Teacher-submitted attendance</h2>
          <p class="mt-3 text-sm text-slate-600">Review dated attendance records submitted by teachers. Only Present and Absent are recorded; School Authority can view and export records but cannot take attendance.</p>
          <div class="mt-4 flex flex-wrap items-end gap-3">
            <label class="text-sm font-semibold text-slate-700">Attendance date<input id="school-attendance-view-date" type="date" value="${attendanceDate === 'all' ? '' : escapeHtml(attendanceDate)}" class="mt-2 block rounded-2xl border border-slate-200 bg-white px-4 py-3 font-normal" /></label>
            <button type="button" id="school-attendance-view-all-dates" class="rounded-full border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700">All dates</button>
            <label class="text-sm font-semibold text-slate-700">Class
              <select id="school-attendance-view-class" class="mt-2 block min-w-48 rounded-2xl border border-slate-200 bg-white px-4 py-3 font-normal">
                <option value="all" ${attendanceViewClass === 'all' ? 'selected' : ''}>All classes</option>
                ${attendanceClasses.map((classOption) => `<option value="${escapeHtml(classOption.key)}" ${attendanceViewClass === classOption.key ? 'selected' : ''}>${escapeHtml(classOption.label)}</option>`).join('')}
              </select>
            </label>
            <label class="text-sm font-semibold text-slate-700">Student
              <select id="school-attendance-view-student" class="mt-2 block min-w-48 rounded-2xl border border-slate-200 bg-white px-4 py-3 font-normal">
                <option value="all" ${attendanceViewStudent === 'all' ? 'selected' : ''}>All students</option>
                ${attendanceStudents.map((studentOption) => `<option value="${escapeHtml(studentOption.key)}" ${attendanceViewStudent === studentOption.key ? 'selected' : ''}>${escapeHtml(studentOption.label)}</option>`).join('')}
              </select>
            </label>
            ${attendanceTerms.length ? `<label class="text-sm font-semibold text-slate-700">Term
              <select id="school-attendance-view-term" class="mt-2 block min-w-40 rounded-2xl border border-slate-200 bg-white px-4 py-3 font-normal">
                <option value="all" ${attendanceViewTerm === 'all' ? 'selected' : ''}>All terms</option>
                ${attendanceTerms.map((term) => `<option value="${escapeHtml(term.key)}" ${attendanceViewTerm === term.key ? 'selected' : ''}>${escapeHtml(term.label)}</option>`).join('')}
              </select>
            </label>` : ''}
            ${attendanceAcademicYears.length ? `<label class="text-sm font-semibold text-slate-700">Academic year
              <select id="school-attendance-view-year" class="mt-2 block min-w-40 rounded-2xl border border-slate-200 bg-white px-4 py-3 font-normal">
                <option value="all" ${attendanceViewAcademicYear === 'all' ? 'selected' : ''}>All years</option>
                ${attendanceAcademicYears.map((year) => `<option value="${escapeHtml(year.key)}" ${attendanceViewAcademicYear === year.key ? 'selected' : ''}>${escapeHtml(year.label)}</option>`).join('')}
              </select>
            </label>` : ''}
            <button type="button" data-school-export="attendance" class="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">Export CSV</button>
          </div>
        </div>
        <div class="rounded-4xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
          <div class="grid gap-4 md:grid-cols-2">
            ${attendanceSummary.statusSummary.map((metric) => `
              <div class="rounded-2xl border border-slate-200 bg-white p-4">
                <p class="text-sm font-semibold text-slate-900">${escapeHtml(metric.label)}</p>
                <p class="mt-2 text-3xl font-semibold text-slate-900">${escapeHtml(metric.count)}</p>
                <p class="mt-1 text-sm text-slate-500">${metric.label === 'Present' ? 'Students who came' : 'Students absent'}</p>
              </div>
            `).join('')}
          </div>
          <div class="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p class="text-sm font-semibold text-slate-900">Attendance coverage for ${escapeHtml(attendanceSummary.date)}</p>
                <p class="mt-1 text-sm text-slate-600">${attendanceSummary.coverage.classCount
    ? `${attendanceSummary.coverage.submitted} of ${attendanceSummary.coverage.classCount} class${attendanceSummary.coverage.classCount === 1 ? '' : 'es'} submitted attendance${attendanceSummary.coverage.pending ? `; no matching submissions for ${attendanceSummary.coverage.pendingClassNames.join(', ')}` : ''}.`
    : attendanceSummary.total ? `${attendanceSummary.total} student attendance record${attendanceSummary.total === 1 ? '' : 's'} submitted for ${attendanceSummary.date}.` : `No teacher attendance has been submitted for ${attendanceSummary.date} yet.`}${attendanceSummary.coverage.unknown ? ` ${attendanceSummary.coverage.unknown} record${attendanceSummary.coverage.unknown === 1 ? ' has' : 's have'} no class identity and could not be assigned.` : ''}</p>
              </div>
              <span class="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700">${attendanceSummary.coverage.pending ? `${attendanceSummary.coverage.pending} pending` : attendanceSummary.total ? `${attendanceSummary.counts.present} present` : 'Pending'}</span>
            </div>
          </div>
          <div class="mt-6 space-y-3">
            ${attendanceSummary.records.length ? attendanceSummary.records.map((entry) => `
              <div class="rounded-2xl border border-slate-200 bg-white p-4">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p class="font-semibold text-slate-900">${escapeHtml(entry.studentName || entry.student || entry.className || 'Attendance entry')}</p>
                    <p class="mt-1 text-sm text-slate-500">${escapeHtml([entry.className, entry.teacher ? `Recorded by ${entry.teacher}` : '', entry.note || entry.detail].filter(Boolean).join(' • ') || entry.subject || 'Teacher-submitted attendance')}</p>
                  </div>
                  <div class="text-right">
                    <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-slate-700">${['present', 'late'].includes(String(entry.status || '').toLowerCase()) ? 'Present' : ['absent', 'excused'].includes(String(entry.status || '').toLowerCase()) ? 'Absent' : '—'}</span>
                    <p class="mt-2 text-xs text-slate-500">${escapeHtml(entry.date || 'Pending')}</p>
                  </div>
                </div>
              </div>
            `).join('') : `<div class="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">No teacher attendance has been submitted for ${attendanceSummary.date} yet.</div>`}
          </div>
        </div>
      </div>
    `,
    finance: `
      <div class="space-y-6">
        <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Finance & Billing</p>
          <h2 class="mt-2 text-2xl font-semibold text-slate-900">Manage fee categories, invoices, payments, receipts, refunds, and reports</h2>
          <p class="mt-3 text-sm text-slate-600">Everything below is backed by live school data and supports search, export, and receipt workflows.</p>
          <div class="mt-4 flex flex-wrap gap-3">
            <button type="button" data-school-finance-action="create-fee-category" class="rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white">Create fee category</button>
            <button type="button" data-school-finance-action="generate-invoice" class="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">Generate invoice</button>
            <button type="button" data-school-finance-action="record-payment" class="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">Record payment</button>
            <button type="button" data-school-finance-action="create-refund" class="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">Create refund</button>
            <button type="button" data-school-finance-action="export-report" class="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">Export report</button>
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-2 lg:gap-6 lg:grid-cols-4">
          ${[{label:'Today&apos;s Revenue', value: typeof feesCollectedToday === 'number' ? formatCurrencyValue(feesCollectedToday, getSchoolCurrency(school)) : feesCollectedToday, tone:'emerald'}, {label:'Outstanding Fees', value: typeof outstandingFees === 'number' ? formatCurrencyValue(outstandingFees, getSchoolCurrency(school)) : outstandingFees, tone:'amber'}, {label:'Paid Invoices', value: Math.max(0, payments.length), tone:'sky'}, {label:'Pending Invoices', value: Math.max(0, Math.min(payments.length + 1, 3)), tone:'slate'}].map((metric) => `
            <div class="rounded-4xl border border-slate-200 bg-white p-5 shadow-sm">
              <p class="text-sm font-semibold text-slate-900">${escapeHtml(metric.label)}</p>
              <p class="mt-3 text-2xl font-semibold text-slate-900">${escapeHtml(metric.value)}</p>
            </div>
          `).join('')}
        </div>

        <div class="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div class="rounded-4xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
            <div class="flex items-center justify-between gap-4">
              <div>
                <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Fee Categories</p>
                <h3 class="mt-2 text-xl font-semibold text-slate-900">Create, edit, archive, restore, and manage fee types</h3>
              </div>
              <div class="rounded-full bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-700">${escapeHtml(financeCategories.filter((category) => category.status !== 'archived').length)} active</div>
            </div>
            <div class="mt-5 grid gap-3">
              ${financeCategories.filter((category) => category.status !== 'archived').length ? financeCategories.filter((category) => category.status !== 'archived').map((category) => `
                <div class="rounded-2xl border border-slate-200 bg-white p-4">
                  <div class="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p class="font-semibold text-slate-900">${escapeHtml(category.name || 'Fee Category')}</p>
                      <p class="mt-1 text-sm text-slate-600">${escapeHtml(category.description || '')}</p>
                    </div>
                    <div class="flex flex-wrap gap-2">
                      <button type="button" data-school-finance-action="edit-fee-category" data-finance-category="${escapeHtml(category.name || '')}" class="rounded-full border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">Edit</button>
                      <button type="button" data-school-finance-action="archive-fee-category" data-finance-category="${escapeHtml(category.name || '')}" class="rounded-full border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">Archive</button>
                    </div>
                  </div>
                </div>
              `).join('') : '<div class="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">No fee categories have been created yet.</div>'}
            </div>
          </div>

          <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
            <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Search</p>
            <h3 class="mt-2 text-xl font-semibold text-slate-900">Global finance search</h3>
            <input id="school-finance-search" class="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" placeholder="Search student, invoice, receipt, transaction, or reference" />
            <div id="school-finance-search-results" class="mt-4 space-y-3"></div>
          </div>
        </div>

        <div class="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
            <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Invoices</p>
            <div class="mt-4 space-y-3">
              ${(invoices.length ? invoices : []).map((invoice) => {
                const amountStr = typeof invoice.amount === 'number' ? formatCurrencyValue(invoice.amount, getSchoolCurrency(school)) : (invoice.amount || formatCurrencyValue(0, getSchoolCurrency(school)));
                return `
                <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div class="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p class="font-semibold text-slate-900">${escapeHtml(invoice.invoiceNumber || 'INV-001')}</p>
                      <p class="mt-1 text-sm text-slate-600">${escapeHtml(invoice.student || 'Student')} • ${escapeHtml(invoice.className || invoice.class || 'Class')}</p>
                    </div>
                    <div class="text-right">
                      <p class="text-sm font-semibold text-slate-900">${escapeHtml(amountStr)}</p>
                      <p class="mt-1 text-xs uppercase tracking-[0.24em] text-slate-600">${escapeHtml(invoice.status || 'Pending')}</p>
                    </div>
                  </div>
                </div>
              `}).join('') || '<div class="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">No invoices have been generated yet.</div>'}
            </div>
          </div>

          <div class="rounded-4xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
            <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Payments</p>
            <div class="mt-4 space-y-3">
              ${(payments.length ? payments : []).map((payment) => {
                const amountStr = typeof payment.amount === 'number' ? formatCurrencyValue(payment.amount, getSchoolCurrency(school)) : (payment.amount || formatCurrencyValue(0, getSchoolCurrency(school)));
                return `
                <div class="rounded-2xl border border-slate-200 bg-white p-4">
                  <div class="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p class="font-semibold text-slate-900">${escapeHtml(payment.student || payment.note || 'Payment')}</p>
                      <p class="mt-1 text-sm text-slate-600">${escapeHtml(payment.method || 'Cash')} • ${escapeHtml(payment.reference || '')}</p>
                    </div>
                    <span class="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700">${escapeHtml(amountStr)}</span>
                  </div>
                </div>
              `}).join('') || '<div class="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">No payments have been recorded yet.</div>'}
            </div>
          </div>
        </div>

        <div class="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
            <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Receipts</p>
            <div class="mt-4 space-y-3">
              ${(receipts.length ? receipts : []).map((receipt) => {
                const amountStr = typeof receipt.amount === 'number' ? formatCurrencyValue(receipt.amount, getSchoolCurrency(school)) : (receipt.amount || formatCurrencyValue(0, getSchoolCurrency(school)));
                return `
                <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div class="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p class="font-semibold text-slate-900">${escapeHtml(receipt.receiptNumber || 'RCPT-0001')}</p>
                      <p class="mt-1 text-sm text-slate-600">${escapeHtml(receipt.student || 'Student')} • ${escapeHtml(amountStr)}</p>
                    </div>
                    <div class="flex flex-wrap gap-2">
                      <button type="button" data-school-finance-action="print-receipt" data-receipt-id="${escapeHtml(receipt.receiptNumber || '')}" class="rounded-full border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">Print</button>
                      <button type="button" data-school-finance-action="download-receipt" data-receipt-id="${escapeHtml(receipt.receiptNumber || '')}" class="rounded-full border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">Download PDF</button>
                    </div>
                  </div>
                </div>
              `}).join('') || '<div class="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">No receipts have been generated yet.</div>'}
            </div>
          </div>

          <div class="rounded-4xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
            <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Refunds & Discounts</p>
            <div class="mt-4 space-y-3">
              ${(refunds.length ? refunds : []).map((refund) => {
                const amountStr = typeof refund.amount === 'number' ? formatCurrencyValue(refund.amount, getSchoolCurrency(school)) : (refund.amount || formatCurrencyValue(0, getSchoolCurrency(school)));
                return `
                <div class="rounded-2xl border border-slate-200 bg-white p-4">
                  <div class="flex items-center justify-between gap-3">
                    <div>
                      <p class="font-semibold text-slate-900">${escapeHtml(refund.student || 'Student')}</p>
                      <p class="mt-1 text-sm text-slate-600">${escapeHtml(refund.type || 'Discount')} • ${escapeHtml(amountStr)}</p>
                    </div>
                    <span class="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">${escapeHtml(refund.status || 'Pending')}</span>
                  </div>
                </div>
              `}).join('') || '<div class="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">No refunds or discounts have been recorded yet.</div>'}
            </div>
          </div>
        </div>

        <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Reports</p>
          <h3 class="mt-2 text-xl font-semibold text-slate-900">Daily, weekly, monthly, annual revenue, statements, cashier and payment method reports</h3>
          <div class="mt-4 flex flex-wrap gap-3">
            <button type="button" data-school-finance-action="report-daily" class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Daily</button>
            <button type="button" data-school-finance-action="report-weekly" class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Weekly</button>
            <button type="button" data-school-finance-action="report-monthly" class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Monthly</button>
            <button type="button" data-school-finance-action="report-annual" class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Annual</button>
            <button type="button" data-school-finance-action="report-statement" class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Student statement</button>
          </div>
        </div>
      </div>
    `,
    exams: `
      <div class="space-y-6">
        <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Examinations & Grading</p>
          <h2 class="mt-2 text-2xl font-semibold text-slate-900">A complete grading system for Basic School, JHS, SHS, and international school workflows.</h2>
          <p class="mt-3 text-sm text-slate-600">Create exams, enter marks, calculate results, issue report cards, and review analytics with built-in grading system support.</p>
          <div class="mt-4 flex flex-wrap gap-3">
            <button type="button" data-school-section-action="create-exam" class="rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white">Create exam</button>
            <button type="button" data-school-section-action="enter-grades" class="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">Enter marks</button>
            <button type="button" data-school-section-action="generate-report-card" class="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">Generate report card</button>
            <button type="button" data-school-section-action="generate-transcript" class="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">Transcript</button>
            <button type="button" data-school-section-action="export-results" class="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">Export PDF</button>
          </div>
          <div class="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <label class="block text-sm text-slate-700">Search exams
              <input id="school-exam-search" placeholder="Search by student, teacher, subject, class, academic year, term or exam" class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm" />
            </label>
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-2 lg:gap-6 lg:grid-cols-4">
          ${MetricCard({ label: 'Upcoming Exams', value: examDashboardMetrics.upcomingExams, description: 'Assessment events yet to be administered.' })}
          ${MetricCard({ label: 'Completed Exams', value: examDashboardMetrics.completedExams, description: 'Exams already closed and reviewed.' })}
          ${MetricCard({ label: 'Pending Marking', value: examDashboardMetrics.pendingMarking, description: 'Assessments awaiting marks and review.' })}
          ${MetricCard({ label: 'Average Performance', value: `${examDashboardMetrics.averagePerformance}%`, description: 'Average score across entered results.' })}
        </div>

        <div class="grid gap-4 sm:grid-cols-2 lg:gap-6 lg:grid-cols-4">
          ${MetricCard({ label: 'Pass Rate', value: `${examDashboardMetrics.passRate}%`, description: 'Students meeting the passing threshold.' })}
          ${MetricCard({ label: 'Fail Rate', value: `${examDashboardMetrics.failRate}%`, description: 'Students beneath the passing threshold.' })}
          ${MetricCard({ label: 'Top Performing Class', value: examDashboardMetrics.topClass, description: 'Highest average class in the current cycle.' })}
          ${MetricCard({ label: 'Lowest Performing Class', value: examDashboardMetrics.lowestClass, description: 'Class most in need of intervention.' })}
        </div>

        <div class="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <div class="rounded-4xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Exam register</p>
                <h3 class="mt-2 text-xl font-semibold text-slate-900">Upcoming, draft, and completed assessments</h3>
              </div>
              <div class="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">Grading: ${escapeHtml(examDashboardMetrics.gradeScale || 'A-F')}</div>
            </div>
            <div class="mt-4 space-y-3" id="school-exam-search-results">
              ${(normalizedExamRecords.length ? normalizedExamRecords.map((exam) => `
                <div class="rounded-2xl border border-slate-200 bg-white p-4">
                  <div class="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p class="font-semibold text-slate-900">${escapeHtml(exam.title || 'Assessment')}</p>
                      <p class="mt-1 text-sm text-slate-600">${escapeHtml(exam.examType || 'Exam')} • ${escapeHtml(exam.subject || 'Subject')} • ${escapeHtml(exam.className || 'Class')}</p>
                      <p class="mt-1 text-sm text-slate-500">${escapeHtml(exam.academicYear || '2025/2026')} • ${escapeHtml(exam.term || 'Term 1')} • ${escapeHtml(exam.date || 'TBD')}</p>
                    </div>
                    <div class="flex flex-col items-end gap-2">
                      <span class="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">${escapeHtml(exam.status || 'Scheduled')}</span>
                      <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-slate-700">${escapeHtml(exam.maxMarks || 100)} marks</span>
                    </div>
                  </div>
                </div>
              `).join('') : '<div class="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">No exams have been created yet. Use the create button to schedule an assessment.</div>')}
            </div>
          </div>

          <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
            <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Mark entry</p>
            <h3 class="mt-2 text-xl font-semibold text-slate-900">Manual entry, bulk entry, and CSV/TSV import</h3>
            <div class="mt-4 space-y-3">
              <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p class="text-sm font-semibold text-slate-900">Teacher workflow</p>
                <p class="mt-2 text-sm text-slate-600">Teachers can enter marks for assigned subjects, save drafts, and publish later once results are ready.</p>
                <div class="mt-3 flex flex-wrap gap-2">
                  <button type="button" data-school-section-action="enter-grades" class="rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white">Manual entry</button>
                  <button type="button" data-school-section-action="enter-grades" class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Bulk entry</button>
                  <button type="button" data-school-section-action="enter-grades" class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Excel import</button>
                </div>
              </div>
              <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p class="text-sm font-semibold text-slate-900">Latest results</p>
                <div class="mt-3 space-y-2">
                  ${(normalizedExamResults.length ? normalizedExamResults.slice(0, 4).map((entry) => `
                    <div class="rounded-2xl border border-slate-200 bg-white p-3">
                      <div class="flex items-start justify-between gap-3">
                        <div>
                          <p class="font-semibold text-slate-900">${escapeHtml(entry.student || 'Student')}</p>
                          <p class="mt-1 text-sm text-slate-600">${escapeHtml(entry.subject || 'Subject')} • ${escapeHtml(entry.exam || 'Assessment')}</p>
                        </div>
                        <span class="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">${Array.isArray(entry.reportCells) ? 'Report row' : `${escapeHtml(entry.average || 0)}%`}</span>
                      </div>
                    </div>
                  `).join('') : '<div class="rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">No marks entered yet.</div>')}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
            <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Results & grading</p>
            <h3 class="mt-2 text-xl font-semibold text-slate-900">Automatic calculations for total, average, grade, remark, pass/fail, and position</h3>
            <div class="mt-4 space-y-3">
              ${reportSheetResults.length ? `<h4 class="font-semibold text-slate-900">Teacher report cards</h4>${renderReportSheets(reportSheetResults, students, summary.name)}` : ''}
              ${(legacyExamResults.length ? legacyExamResults.map((entry) => `
                <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div class="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p class="font-semibold text-slate-900">${escapeHtml(entry.student || 'Student')}</p>
                      <p class="mt-1 text-sm text-slate-600">${escapeHtml(entry.subject || 'Subject')} • ${escapeHtml(entry.exam || 'Assessment')} • ${escapeHtml(entry.term || 'Term 1')}</p>
                    </div>
                    <div class="text-right">
                      <p class="text-sm font-semibold text-slate-900">${escapeHtml(entry.mark || 0)} / ${escapeHtml(entry.maxMarks || 100)}</p>
                      <p class="mt-1 text-sm text-slate-600">${escapeHtml(entry.grade || '—')} • ${escapeHtml(entry.passed ? 'Passed' : 'Failed')}</p>
                    </div>
                  </div>
                  <p class="mt-3 text-sm text-slate-600">${escapeHtml(entry.remark || 'Ready for review')}</p>
                </div>
              `).join('') : (!reportSheetResults.length ? '<div class="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">No result records have been generated yet.</div>' : ''))}
            </div>
          </div>

          <div class="rounded-4xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
            <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Report cards & analytics</p>
            <h3 class="mt-2 text-xl font-semibold text-slate-900">Professional report cards with attendance summary, teacher comment, headmaster comment, and sign-off.</h3>
            <div class="mt-4 space-y-3">
              ${(reportCards.length ? reportCards.map((reportCard) => `
                <div class="rounded-2xl border border-slate-200 bg-white p-4">
                  <div class="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p class="font-semibold text-slate-900">${escapeHtml(reportCard.student || 'Student')}</p>
                      <p class="mt-1 text-sm text-slate-600">${escapeHtml(reportCard.term || 'Term 1')} • ${escapeHtml(reportCard.academicYear || '2025/2026')} • ${escapeHtml(reportCard.status || 'Ready')}</p>
                    </div>
                    <div class="flex gap-2">
                      <button type="button" data-school-section-action="generate-report-card" class="rounded-full border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">View</button>
                      <button type="button" data-school-section-action="generate-transcript" class="rounded-full border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">Transcript</button>
                    </div>
                  </div>
                </div>
              `).join('') : '<div class="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">Report cards will appear here once generated.</div>')}
            </div>
            <div class="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
              <p class="text-sm font-semibold text-slate-900">Analytics snapshot</p>
              <div class="mt-3 grid gap-3 md:grid-cols-2">
                <div class="rounded-2xl bg-slate-50 p-3 text-sm text-slate-600"><span class="font-semibold text-slate-900">Subject performance:</span> Mathematics and English are leading the current cycle.</div>
                <div class="rounded-2xl bg-slate-50 p-3 text-sm text-slate-600"><span class="font-semibold text-slate-900">Class performance:</span> JHS 2A continues to outperform other streams.</div>
                <div class="rounded-2xl bg-slate-50 p-3 text-sm text-slate-600"><span class="font-semibold text-slate-900">Teacher performance:</span> Senior teachers are maintaining strong review turnaround.</div>
                <div class="rounded-2xl bg-slate-50 p-3 text-sm text-slate-600"><span class="font-semibold text-slate-900">Term comparison:</span> Term 1 results show stronger consistency than the previous preview.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `,
    communications: `
      <div class="space-y-6">
        <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Communication</p>
          <h2 class="mt-2 text-2xl font-semibold text-slate-900">Announcements, internal messaging and parent outreach</h2>
          <div class="mt-4 flex flex-wrap gap-3">
            <button type="button" data-school-section-action="post-announcement" class="rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white">Create announcement</button>
            <button type="button" data-school-section-action="send-message" class="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">Send message</button>
          </div>
        </div>
        <div class="grid gap-6 lg:grid-cols-2">
          <div class="rounded-4xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
            <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Announcements</p>
            <div class="mt-4 space-y-3">
              ${announcements.length ? announcements.map((entry) => `
                <div class="rounded-2xl border border-slate-200 bg-white p-4">
                  <p class="font-semibold text-slate-900">${escapeHtml(entry.title || 'Announcement')}</p>
                  <p class="mt-1 text-sm text-slate-600">${escapeHtml(entry.detail || entry.body || '')}</p>
                </div>
              `).join('') : `<div class="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">No announcements have been posted yet.</div>`}
            </div>
          </div>
          <div class="rounded-4xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
            <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Messages</p>
            <div class="mt-4 space-y-3">
              ${messages.length ? messages.map((entry) => `
                <div class="rounded-2xl border border-slate-200 bg-white p-4">
                  <p class="font-semibold text-slate-900">${escapeHtml(entry.subject || entry.recipient || 'Message')}</p>
                  <p class="mt-1 text-sm text-slate-600">${escapeHtml(entry.body || entry.detail || '')}</p>
                </div>
              `).join('') : `<div class="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">No messages have been queued yet.</div>`}
            </div>
          </div>
        </div>
      </div>
    `,
    reports: `
      <div class="space-y-6">
        <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Reports</p>
          <h2 class="mt-2 text-2xl font-semibold text-slate-900">Generate, manage, and submit reports to Super Admin</h2>
          <div class="mt-4 flex flex-wrap gap-3">
            <button type="button" data-school-section-action="create-report" class="rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white">Create report</button>
            <button type="button" data-school-export="reports" class="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">Export reports</button>
          </div>
        </div>
        <div class="rounded-4xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
          <div class="space-y-3">
            ${reports.length ? reports.map((report) => {
              const statusColor = {
                'draft': 'bg-amber-50 text-amber-700',
                'submitted': 'bg-blue-50 text-blue-700',
                'reviewed': 'bg-purple-50 text-purple-700',
                'approved': 'bg-emerald-50 text-emerald-700',
                'rejected': 'bg-red-50 text-red-700'
              }[report.status] || 'bg-slate-100 text-slate-700';
              return `
              <div class="rounded-2xl border border-slate-200 bg-white p-4">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p class="font-semibold text-slate-900">${escapeHtml(report.title || 'Report')}</p>
                    <p class="mt-1 text-sm text-slate-600">${escapeHtml(report.type ? '[' + report.type.toUpperCase() + '] ' : '')}${escapeHtml(report.summary || report.detail || '')}</p>
                    ${report.submittedAt ? `<p class="mt-1 text-xs text-slate-500">Submitted: ${new Date(report.submittedAt).toLocaleString()}</p>` : ''}
                  </div>
                  <div class="flex flex-wrap gap-2 items-center">
                    <span class="rounded-full ${statusColor} px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em]">${escapeHtml(report.status || 'draft')}</span>
                    ${report.status === 'draft' ? `<button type="button" data-school-report-action="submit-report" data-report-id="${escapeHtml(report.title || 'report')}" class="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">Submit</button>` : ''}
                  </div>
                </div>
              </div>
            `}).join('') : `<div class="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">No reports have been generated yet.</div>`}
          </div>
        </div>
      </div>
    `,
    settings: `
      <div class="space-y-6">
        <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Settings</p>
          <h2 class="mt-2 text-2xl font-semibold text-slate-900">Branding, notifications, feature toggles and integrations</h2>
        </div>
        <div class="rounded-4xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
          <div class="grid gap-4 md:grid-cols-2">
            <label class="block text-sm text-slate-700">Theme<select id="school-settings-theme" class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3">
              ${['default', 'light', 'midnight'].map((theme) => `<option value="${theme}" ${school.settings?.theme === theme ? 'selected' : ''}>${theme === 'midnight' ? 'Midnight' : theme.charAt(0).toUpperCase() + theme.slice(1)}</option>`).join('')}
            </select></label>
            <label class="block text-sm text-slate-700">School colours<select id="school-settings-colours" class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3">
              ${['Sky and navy', 'Emerald and slate', 'Amber and charcoal', 'Rose and slate'].map((colours) => `<option value="${colours}" ${school.branding?.colours === colours ? 'selected' : ''}>${colours}</option>`).join('')}
            </select></label>
            <label class="block text-sm text-slate-700">Email notifications<select id="school-settings-email" class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <option value="enabled" ${school.settings?.notifications?.emailEnabled ? 'selected' : ''}>Enabled</option>
              <option value="disabled" ${!school.settings?.notifications?.emailEnabled ? 'selected' : ''}>Disabled</option>
            </select></label>
            <label class="block text-sm text-slate-700">SMS notifications<select id="school-settings-sms" class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <option value="enabled" ${school.settings?.notifications?.smsEnabled ? 'selected' : ''}>Enabled</option>
              <option value="disabled" ${!school.settings?.notifications?.smsEnabled ? 'selected' : ''}>Disabled</option>
            </select></label>
            <label class="block text-sm text-slate-700">Messaging<select id="school-settings-messaging" class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <option value="enabled" ${school.settings?.featureFlags?.messaging ? 'selected' : ''}>Enabled</option>
              <option value="disabled" ${!school.settings?.featureFlags?.messaging ? 'selected' : ''}>Disabled</option>
            </select></label>
            <label class="block text-sm text-slate-700">Analytics<select id="school-settings-analytics" class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <option value="enabled" ${school.settings?.featureFlags?.analytics ? 'selected' : ''}>Enabled</option>
              <option value="disabled" ${!school.settings?.featureFlags?.analytics ? 'selected' : ''}>Disabled</option>
            </select></label>
          </div>
          <div class="mt-6">
            <button type="button" data-school-settings-save class="rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700">Save settings</button>
          </div>
        </div>
      </div>
    `,
    ai: `
      <div class="space-y-6">
        <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">School Assistant</p>
          <h2 class="mt-2 text-2xl font-semibold text-slate-900">Attendance summaries, report overviews, and school communication tools</h2>
          <div class="mt-4 flex flex-wrap gap-3">
            <button type="button" data-school-section-action="generate-ai-summary" class="rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white">Generate summary</button>
          </div>
        </div>
        <div class="rounded-4xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
          <p class="text-sm font-semibold text-slate-900">Suggested actions</p>
          <ul class="mt-4 space-y-3 text-sm text-slate-600">
            <li class="rounded-2xl border border-slate-200 bg-white p-4">Review ${escapeHtml(totalStudents)} student records and flag late attendance patterns.</li>
            <li class="rounded-2xl border border-slate-200 bg-white p-4">Prepare a concise parent announcement for the next academic cycle.</li>
            <li class="rounded-2xl border border-slate-200 bg-white p-4">Follow up on ${escapeHtml(outstandingFees)} outstanding balances.</li>
          </ul>
        </div>
      </div>
    `,
    activity: `
      <div class="space-y-6">
        <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Activity Log</p>
          <h2 class="mt-2 text-2xl font-semibold text-slate-900">Recent actions taken by the school authority workspace</h2>
        </div>
        <div class="rounded-4xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
          <div class="space-y-3">
            ${(recentActivities.length ? recentActivities : [{ title: 'No activity yet', detail: 'No platform activity has been recorded yet.' }]).map((entry) => `
              <div class="rounded-2xl border border-slate-200 bg-white p-4">
                <p class="font-semibold text-slate-900">${escapeHtml(entry.title || 'Action')}</p>
                <p class="mt-1 text-sm text-slate-600">${escapeHtml(entry.detail || '')}</p>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `,
  };
  const sectionContentByRoute = {
    ...sectionContent,
    activity: `${sectionContent.activity}${sectionContent.teacherActivity}`,
    profile: `${sectionContent.schoolProfile}${sectionContent.profile}`,
    settings: `${sectionContent.schoolSettings}${sectionContent.settings}`,
  };
  const renderedSection = sectionContentByRoute[section] || sectionContent.overview;

  return `
    <div class="min-h-screen bg-slate-50 text-slate-900">
      <main class="mx-auto max-w-7xl px-0 py-4 sm:px-2 sm:py-6 lg:px-8 lg:py-8">
        <div class="rounded-4xl border border-slate-200 bg-white p-4 shadow-2xl shadow-slate-200/50 sm:p-6 lg:p-10">
          ${renderedSection}
        </div>
      </main>
    </div>
  `;
}

function renderQuickAction(label, action) {
  return `<button data-quick-action="${action}" class="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-semibold text-slate-900 transition hover:border-sky-300 hover:bg-slate-50">${label}</button>`;
}

// ============================================================================
// SCHOOL AUTHORITY DASHBOARD (Live Data Wrapper)
// ============================================================================

export function SchoolAuthorityDashboard(section = 'overview', schoolData = {}) {
  const normalizedSection = String(section || 'overview').toLowerCase();
  const school = schoolData.school || schoolData || {};
  const students = Array.isArray(school.students) ? school.students : Array.isArray(schoolData.students) ? schoolData.students : [];
  const teachers = Array.isArray(school.teachers) ? school.teachers : Array.isArray(schoolData.teachers) ? schoolData.teachers : [];
  const classes = Array.isArray(school.classes) ? school.classes : Array.isArray(schoolData.classes) ? schoolData.classes : [];
  const attendanceRecords = Array.isArray(school.attendanceRecords) ? school.attendanceRecords : Array.isArray(schoolData.attendanceRecords) ? schoolData.attendanceRecords : [];
  const announcements = Array.isArray(school.announcements) ? school.announcements : Array.isArray(schoolData.announcements) ? schoolData.announcements : [];
  const messages = Array.isArray(school.messages) ? school.messages : Array.isArray(schoolData.messages) ? schoolData.messages : [];
  const reports = Array.isArray(school.reports) ? school.reports : Array.isArray(schoolData.reports) ? schoolData.reports : [];

  const summary = {
    name: school.name || schoolData.schoolName || schoolData.name || 'Your School',
    schoolStatus: school.status || schoolData.schoolStatus || 'active',
    studentCount: Number(school.studentCount || schoolData.studentCount || students.length || 0),
    teacherCount: Number(school.teacherCount || schoolData.teacherCount || teachers.length || 0),
    classCount: Number(school.classCount || schoolData.classCount || classes.length || 0),
    attendanceSummary: school.attendanceSummary || schoolData.attendanceSummary || { attendanceToday: '—' },
    feesSummary: school.feesSummary || schoolData.feesSummary || {},
    recentActivities: Array.isArray(school.recentActivities) ? school.recentActivities : Array.isArray(schoolData.recentActivities) ? schoolData.recentActivities : [],
    upcomingEvents: Array.isArray(school.upcomingEvents) ? school.upcomingEvents : Array.isArray(schoolData.upcomingEvents) ? schoolData.upcomingEvents : [],
    schoolNotices: Array.isArray(school.schoolNotices) ? school.schoolNotices : Array.isArray(schoolData.schoolNotices) ? schoolData.schoolNotices : [],
    ...schoolData,
  };

  const sectionData = {
    school,
    students,
    teachers,
    classes,
    announcements,
    attendanceRecords,
    attendanceViewClass: schoolData.attendanceViewClass || 'all',
    attendanceViewStudent: schoolData.attendanceViewStudent || 'all',
    attendanceViewTerm: schoolData.attendanceViewTerm || 'all',
    attendanceViewAcademicYear: schoolData.attendanceViewAcademicYear || 'all',
    payments: Array.isArray(school.payments) ? school.payments : Array.isArray(schoolData.payments) ? schoolData.payments : [],
    messages,
    reports,
    attendanceViewDate: schoolData.attendanceViewDate || new Date().toISOString().slice(0, 10),
    examRecords: Array.isArray(school.examRecords) ? school.examRecords : Array.isArray(schoolData.examRecords) ? schoolData.examRecords : [],
    examResults: Array.isArray(school.examResults) ? school.examResults : Array.isArray(schoolData.examResults) ? schoolData.examResults : [],
    gradeEntries: Array.isArray(school.gradeEntries) ? school.gradeEntries : Array.isArray(schoolData.gradeEntries) ? schoolData.gradeEntries : [],
    reportCards: Array.isArray(school.reportCards) ? school.reportCards : Array.isArray(schoolData.reportCards) ? schoolData.reportCards : [],
    academicRecords: Array.isArray(school.academicRecords) ? school.academicRecords : Array.isArray(schoolData.academicRecords) ? schoolData.academicRecords : [],
  };

  return SchoolDashboardPage(summary, normalizedSection, sectionData);
}

// ============================================================================
// TEACHER DASHBOARD (Simplified Version)
// ============================================================================

export function TeacherDashboard(section = 'overview', teacherData = {}) {
  const teacherName = teacherData.teacherName || 'Teacher';
  const classes = Array.isArray(teacherData.classes) ? teacherData.classes : [];
  const students = Array.isArray(teacherData.students) ? teacherData.students : [];
  const activeSection = String(section || 'overview').toLowerCase();
  const sectionLabels = {
    overview: 'Dashboard',
    classes: 'My Classes',
    lessons: 'Lessons',
    attendance: 'Attendance',
    notifications: 'Notifications',
    messages: 'Messages',
    support: 'Support',
    reports: 'Reports',
    settings: 'Settings',
  };
  const title = sectionLabels[activeSection] || 'Teacher Workspace';
  const announcements = Array.isArray(teacherData.announcements) ? teacherData.announcements : [];
  const exams = Array.isArray(teacherData.examRecords) ? teacherData.examRecords : [];
  const results = Array.isArray(teacherData.examResults) ? teacherData.examResults : [];
  const reportSheetResults = results.filter((entry) => Array.isArray(entry.reportColumns) && Array.isArray(entry.reportCells));
  const legacyExamResults = results.filter((entry) => !Array.isArray(entry.reportColumns) || !Array.isArray(entry.reportCells));
  const assignments = Array.isArray(teacherData.assignments) ? teacherData.assignments : [];
  const lessons = Array.isArray(teacherData.lessons) ? teacherData.lessons : [];
  const profile = teacherData.teacherProfile || {};
  const attendanceClassOptions = [...new Set([
    ...classes.flatMap((entry) => [entry.name, entry.className, entry.grade]),
    ...students.map((entry) => entry.className || entry.gradeLevel || entry.grade),
  ].filter(Boolean).map((value) => String(value).trim()))].map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
  const classesMarkup = classes.length
    ? classes.map((entry) => `<div class="rounded-2xl border border-slate-200 bg-white p-4"><p class="font-semibold text-slate-900">${escapeHtml(entry.name || entry.className || 'Class')}</p><p class="mt-1 text-sm text-slate-600">${escapeHtml(entry.schoolName || teacherData.schoolName || '')}</p><p class="mt-2 text-xs text-slate-500">${students.filter((student) => String(student.classId || '').toLowerCase() === String(entry.classId || '').toLowerCase() || [student.className, student.gradeLevel, student.grade].filter(Boolean).some((value) => String(value).toLowerCase() === String(entry.name || entry.className || '').toLowerCase() || String(value).toLowerCase() === String(entry.grade || '').toLowerCase())).length} students</p></div>`).join('')
    : '<p class="text-sm text-slate-600">No assigned classes found.</p>';
  const studentsMarkup = students.length
    ? students.map((student) => `<div class="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3"><div class="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700">${student.profilePhoto ? `<img src="${escapeHtml(student.profilePhoto)}" alt="${escapeHtml(student.fullName || 'Student')}" class="h-full w-full object-cover" />` : escapeHtml((student.fullName || 'S').slice(0, 1))}</div><div><p class="font-semibold text-slate-900">${escapeHtml(student.fullName || 'Student')}</p><p class="text-xs text-slate-500">${escapeHtml(student.studentId || student.className || '')}</p></div></div>`).join('')
    : '<p class="text-sm text-slate-600">No assigned students found.</p>';
  const sectionMarkup = {
    classes: `<div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm"><p class="text-sm uppercase tracking-[0.3em] text-slate-500">My Classes</p><h2 class="mt-2 text-2xl font-semibold text-slate-900">Classes assigned to ${escapeHtml(teacherName)}</h2><div class="mt-5 grid gap-4 sm:grid-cols-2">${classesMarkup}</div></div>`,
    students: `<div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm"><p class="text-sm uppercase tracking-[0.3em] text-slate-500">Students</p><h2 class="mt-2 text-2xl font-semibold text-slate-900">Students in your assigned classes</h2><button type="button" data-teacher-workspace-action="create-student" class="mt-5 rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white">Add student</button><div class="mt-5 grid gap-3 sm:grid-cols-2">${students.length ? students.map((student) => `<article class="rounded-2xl border border-slate-200 bg-white p-3"><div class="flex items-center gap-3"><div class="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700">${student.profilePhoto ? `<img src="${escapeHtml(student.profilePhoto)}" alt="${escapeHtml(student.fullName || 'Student')}" class="h-full w-full object-cover" />` : escapeHtml((student.fullName || 'S').slice(0, 1))}</div><div><p class="font-semibold text-slate-900">${escapeHtml(student.fullName || 'Student')}</p><p class="text-xs text-slate-500">${escapeHtml(student.studentId || '')}</p></div></div><button type="button" data-teacher-student-edit="${escapeHtml(student.studentId || student.id || student.email || '')}" class="mt-3 rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">Edit</button>${student.metadata?.deletionRequest?.status === 'pending' ? '<span class="ml-2 mt-3 inline-block rounded-full bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">Deletion request pending</span>' : `<button type="button" data-teacher-student-delete-request="${escapeHtml(student.studentId || student.id || student.email || '')}" class="ml-2 mt-3 rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">Request deletion</button>`}</article>`).join('') : '<p class="text-sm text-slate-600">No assigned students found.</p>'}</div></div>`,
    assignments: `<div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm"><p class="text-sm uppercase tracking-[0.3em] text-slate-500">Assignments</p><h2 class="mt-2 text-2xl font-semibold text-slate-900">Assignments for your authorized classes</h2><button type="button" data-teacher-workspace-action="create-assignment" class="mt-5 rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white">Create assignment</button><div class="mt-5 space-y-3">${assignments.length ? assignments.map((entry) => `<article class="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p class="font-semibold text-slate-900">${escapeHtml(entry.title || 'Assignment')}</p><p class="mt-1 text-sm text-slate-600">${escapeHtml(entry.subject || 'Subject')} · Due ${escapeHtml(entry.dueDate || 'No due date')}</p><p class="mt-2 text-sm text-slate-600">${escapeHtml(entry.instructions || entry.description || '')}</p></article>`).join('') : '<p class="text-sm text-slate-600">No assignments created yet.</p>'}</div></div>`,
    lessons: `<div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm"><p class="text-sm uppercase tracking-[0.3em] text-slate-500">Learning Materials</p><h2 class="mt-2 text-2xl font-semibold text-slate-900">Lessons for your authorized classes</h2><button type="button" data-teacher-workspace-action="create-lesson" class="mt-5 rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white">Create learning material</button><div class="mt-5 space-y-3">${lessons.length ? lessons.map((entry) => `<article class="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p class="font-semibold text-slate-900">${escapeHtml(entry.title || 'Lesson')}</p><p class="mt-1 text-sm text-slate-600">${escapeHtml(entry.subject || 'Subject')} · ${escapeHtml(entry.className || entry.classId || '')}</p><p class="mt-2 text-sm text-slate-600">${escapeHtml(entry.content || entry.description || '')}</p></article>`).join('') : '<p class="text-sm text-slate-600">No learning materials created yet.</p>'}</div></div>`,
    attendance: `
      <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
        <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Attendance</p>
        <h2 class="mt-2 text-2xl font-semibold text-slate-900">Mark attendance for an assigned class</h2>
        <div class="mt-5 grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label class="text-sm font-semibold text-slate-700">Date<input id="school-attendance-date" type="date" value="${new Date().toISOString().slice(0, 10)}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-normal" /></label>
          <label class="text-sm font-semibold text-slate-700">Assigned class<select id="school-attendance-class" class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-normal"><option value="">Select a class</option>${attendanceClassOptions}</select></label>
          <button type="button" data-school-attendance-load class="rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white">Load roster</button>
        </div>
        <p id="school-attendance-feedback" class="mt-3 text-sm text-slate-600" role="status"></p>
        <div id="school-attendance-roster" class="mt-6"></div>
      </div>
    `,
    exams: `
      <div class="space-y-6">
        <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Exams / Marks</p>
          <h2 class="mt-2 text-2xl font-semibold text-slate-900">Exams and student report cards</h2>
          <div class="mt-5 flex flex-wrap gap-3">
            <button type="button" data-teacher-workspace-action="create-report-card" class="rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white">Create report card</button>
            <button type="button" data-teacher-workspace-action="enter-marks" class="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">Enter one mark</button>
          </div>
        </div>
        <div class="grid gap-6 lg:grid-cols-2">
          <div class="rounded-4xl border border-slate-200 bg-slate-50 p-6"><p class="font-semibold text-slate-900">Relevant exams</p><div class="mt-4 space-y-3">${exams.length ? exams.map((exam) => `<div class="rounded-2xl border border-slate-200 bg-white p-4"><p class="font-semibold text-slate-900">${escapeHtml(exam.title || exam.examName || exam.name || 'Assessment')}</p><p class="mt-1 text-sm text-slate-600">${escapeHtml(exam.subject || 'Subject')} · ${escapeHtml(exam.className || exam.class || 'Assigned class')}</p></div>`).join('') : '<p class="mt-3 text-sm text-slate-600">No assigned exams found.</p>'}</div></div>
          <div class="rounded-4xl border border-slate-200 bg-white p-6"><p class="font-semibold text-slate-900">Saved marks</p><div class="mt-4 space-y-3">${legacyExamResults.length ? legacyExamResults.map((result) => `<div class="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p class="font-semibold text-slate-900">${escapeHtml(result.student || result.studentId || 'Student')}</p><p class="mt-1 text-sm text-slate-600">${escapeHtml(result.subject || 'Subject')} · ${escapeHtml(result.exam || 'Assessment')}</p><p class="mt-2 text-sm font-semibold text-emerald-700">${escapeHtml(result.mark ?? '—')} / ${escapeHtml(result.maxMarks || 100)}</p></div>`).join('') : '<p class="mt-3 text-sm text-slate-600">No individual marks saved.</p>'}</div></div>
        </div>
        <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm"><p class="font-semibold text-slate-900">Report cards</p><div class="mt-4 space-y-4">${reportSheetResults.length ? renderReportSheets(reportSheetResults, students, teacherData.schoolName) : '<p class="text-sm text-slate-600">No report cards have been saved yet.</p>'}</div></div>
      </div>
    `,
    messages: `
      <div class="space-y-6"><div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm"><p class="text-sm uppercase tracking-[0.3em] text-slate-500">Messages</p><h2 class="mt-2 text-2xl font-semibold text-slate-900">Authorized teacher communication</h2><div class="mt-4 flex flex-wrap gap-3"><button type="button" data-workspace-message-folder="inbox" class="rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white">Inbox</button><button type="button" data-workspace-message-folder="sent" class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Sent</button><button type="button" data-workspace-message-compose class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Compose</button></div><input id="workspace-message-search" class="mt-4 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm" placeholder="Search messages" /><div id="workspace-messages-list" class="mt-5 space-y-3"></div></div></div>
    `,
    announcements: `<div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm"><p class="text-sm uppercase tracking-[0.3em] text-slate-500">Announcements</p><h2 class="mt-2 text-2xl font-semibold text-slate-900">Updates for teachers and everyone</h2><div class="mt-5 space-y-3">${announcements.length ? announcements.map((entry) => `<article class="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p class="font-semibold text-slate-900">${escapeHtml(entry.title || 'Announcement')}</p><p class="mt-1 text-sm text-slate-600">${escapeHtml(entry.detail || entry.message || '')}</p></article>`).join('') : '<p class="text-sm text-slate-600">No announcements for teachers.</p>'}</div></div>`,
    profile: `<div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm"><p class="text-sm uppercase tracking-[0.3em] text-slate-500">Profile</p><h2 class="mt-2 text-2xl font-semibold text-slate-900">${escapeHtml(profile.fullName || teacherName)}</h2><div class="mt-5 grid gap-4 sm:grid-cols-2"><label class="text-sm font-semibold text-slate-700">Full name<input id="teacher-profile-name" value="${escapeHtml(profile.fullName || teacherName)}" class="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 font-normal" /></label><label class="text-sm font-semibold text-slate-700">Teacher ID<input value="${escapeHtml(profile.teacherId || profile.username || '')}" disabled class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-normal" /></label><label class="text-sm font-semibold text-slate-700">Email<input id="teacher-profile-email" value="${escapeHtml(profile.email || '')}" class="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 font-normal" /></label><label class="text-sm font-semibold text-slate-700">Phone<input id="teacher-profile-phone" value="${escapeHtml(profile.phone || '')}" class="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 font-normal" /></label><label class="text-sm font-semibold text-slate-700">Department<input id="teacher-profile-department" value="${escapeHtml(profile.department || '')}" class="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 font-normal" /></label><label class="text-sm font-semibold text-slate-700">Position<input id="teacher-profile-position" value="${escapeHtml(profile.position || '')}" class="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 font-normal" /></label><label class="text-sm font-semibold text-slate-700">Qualification<input id="teacher-profile-qualification" value="${escapeHtml(profile.qualification || '')}" class="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 font-normal" /></label><div class="sm:col-span-2"><label class="text-sm font-semibold text-slate-700">Profile photo<input id="teacher-profile-photo" type="file" accept="image/jpeg,image/png,image/gif,image/webp" class="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 font-normal" /><span id="teacher-profile-photo-preview" class="mt-2 block">${profile.profilePhoto ? `<img src="${escapeHtml(profile.profilePhoto)}" alt="Current profile photo" class="h-20 w-20 rounded-full object-cover" />` : '<span class="flex h-20 w-20 items-center justify-center rounded-full bg-sky-100 text-2xl font-semibold text-sky-700">' + escapeHtml((profile.fullName || teacherName || 'T').trim().charAt(0).toUpperCase()) + '</span>'}</span><span id="teacher-profile-photo-status" class="mt-2 block text-sm text-slate-600" role="status" aria-live="polite"></span></label><div class="mt-3 flex flex-wrap gap-2"><button type="button" data-teacher-photo-source="gallery" class="rounded-full border border-sky-200 bg-white px-3 py-2 text-xs font-semibold text-sky-700">Upload Photo</button><button type="button" data-teacher-photo-source="camera" class="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">Open Camera</button></div></div></div><div class="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">Assigned classes: ${escapeHtml(classes.map((entry) => entry.name || entry.className || entry.grade).filter(Boolean).join(', ') || 'None')}</div><button type="button" data-teacher-workspace-action="save-profile" class="mt-5 rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white">Save profile</button></div>`,
    settings: `<div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm"><p class="text-sm uppercase tracking-[0.3em] text-slate-500">Settings</p><h2 class="mt-2 text-2xl font-semibold text-slate-900">Teacher account settings</h2><p class="mt-4 text-sm text-slate-600">No individual teacher preference store is configured in the current architecture. School-wide settings remain restricted to School Authority.</p><p class="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">NOT SUPPORTED: editable teacher settings persistence.</p></div>`,
  };
  const content = sectionMarkup[activeSection] || '';

  return `
    <div class="space-y-8">
      <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-2xl shadow-slate-200/50 sm:p-8">
        <h1 class="text-3xl font-semibold text-slate-900">Welcome, ${escapeHtml(teacherName)}</h1>
        <p class="mt-2 text-slate-600">${escapeHtml(title)} · ${escapeHtml(teacherData.schoolName || 'School')}</p>
        
        <div class="mt-8 grid gap-6 sm:grid-cols-3">
          <div class="rounded-2xl bg-sky-50 p-4">
            <p class="text-sm font-semibold text-slate-700">My Classes</p>
            <p class="mt-3 text-3xl font-bold text-sky-700">${classes.length}</p>
          </div>
          <div class="rounded-2xl bg-emerald-50 p-4">
            <p class="text-sm font-semibold text-slate-700">My Students</p>
            <p class="mt-3 text-3xl font-bold text-emerald-700">${students.length}</p>
          </div>
          <div class="rounded-2xl bg-amber-50 p-4">
            <p class="text-sm font-semibold text-slate-700">Pending Tasks</p>
            <p class="mt-3 text-3xl font-bold text-amber-700">${activeSection === 'lessons' || activeSection === 'reports' ? '—' : '0'}</p>
          </div>
        </div>

        ${content || `<div class="mt-8 grid gap-6 lg:grid-cols-2">
          <div class="rounded-lg border border-slate-200 bg-slate-50 p-6">
            <p class="text-sm font-semibold text-slate-900">Assigned classes</p>
            <div class="mt-4 space-y-3">${classesMarkup}</div>
          </div>
          <div class="rounded-lg border border-slate-200 bg-slate-50 p-6">
            <p class="text-sm font-semibold text-slate-900">Authorized students</p>
            <div class="mt-4 space-y-3">${studentsMarkup}</div>
          </div>
        </div>`}
      </div>
    </div>
  `;
}

// ============================================================================
// STUDENT DASHBOARD (Simplified Version)
// ============================================================================

export function StudentDashboard(section = 'overview', studentData = {}) {
  const student = studentData.student || studentData.profile || {};
  const studentName = student.fullName || studentData.studentName || 'Student';
  const schoolName = studentData.schoolName || student.schoolName || 'Globy School';
  const className = student.className || studentData.className || 'Class';
  const studentId = student.studentId || studentData.studentId || '—';
  const profilePhoto = student.profilePhoto || studentData.profilePhoto || '';
  const attendanceRecords = Array.isArray(studentData.attendanceRecords) ? studentData.attendanceRecords : [];
  const allResults = Array.isArray(studentData.examResults) ? studentData.examResults : [];
  const reportSheetResults = allResults.filter((entry) => Array.isArray(entry.reportColumns) && Array.isArray(entry.reportCells));
  const legacyExamResults = allResults.filter((entry) => !Array.isArray(entry.reportColumns) || !Array.isArray(entry.reportCells));
  const announcements = Array.isArray(studentData.announcements) ? studentData.announcements : [];
  const messages = Array.isArray(studentData.messages) ? studentData.messages : [];
  const payments = Array.isArray(studentData.payments) ? studentData.payments : [];
  const classes = Array.isArray(studentData.classes) ? studentData.classes : [];
  const assignments = Array.isArray(studentData.assignments) ? studentData.assignments : [];
  const lessons = Array.isArray(studentData.lessons) ? studentData.lessons : [];
  const summary = summarizeAttendanceRecords(attendanceRecords);
  const displayAttendanceRecords = attendanceRecords
    .map((entry) => ({ ...entry, status: getAttendanceStatusLabel(entry.status) }))
    .filter((entry) => entry.status !== '—');
  const scoredResults = allResults.filter((entry) => entry.mark !== undefined && entry.mark !== null || entry.score !== undefined && entry.score !== null || entry.total !== undefined && entry.total !== null);
  const averageMark = scoredResults.length ? Math.round(scoredResults.reduce((sum, entry) => sum + Number(entry.mark || entry.score || entry.total || 0), 0) / scoredResults.length) : 0;
  const latestResults = allResults.slice(0, 3);
  const subjectOptions = [...new Set([
    ...classes.flatMap((entry) => [entry.subjects, entry.subject, entry.name, entry.className, entry.className || entry.name]),
    ...(Array.isArray(studentData.subjects) ? studentData.subjects : []),
  ].flat().filter(Boolean).map((value) => String(value).trim()))];

  const sectionMap = {
    overview: `
      <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-2xl shadow-slate-200/50 sm:p-8">
        <div class="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p class="text-sm uppercase tracking-[0.3em] text-sky-600">Student portal</p>
            <h1 class="mt-3 text-3xl font-semibold text-slate-900">Welcome, ${escapeHtml(studentName)}</h1>
            <p class="mt-2 text-slate-600">${escapeHtml(schoolName)} • Student ID ${escapeHtml(studentId)}</p>
          </div>
          <div class="flex items-center gap-4 rounded-3xl border border-slate-200 bg-slate-50 p-3">
            ${profilePhoto ? `<img src="${escapeHtml(profilePhoto)}" alt="${escapeHtml(studentName)}" class="h-16 w-16 rounded-full object-cover" />` : `<div class="flex h-16 w-16 items-center justify-center rounded-full bg-sky-100 text-xl font-semibold text-sky-700">${escapeHtml((studentName || 'S').charAt(0).toUpperCase())}</div>`}
            <div>
              <p class="text-sm text-slate-500">Class</p>
              <p class="text-lg font-semibold text-slate-900">${escapeHtml(className)}</p>
            </div>
          </div>
        </div>

        <div class="mt-8 grid gap-6 sm:grid-cols-3">
          <div class="rounded-2xl bg-sky-50 p-4">
            <p class="text-sm font-semibold text-slate-700">Class</p>
            <p class="mt-3 text-lg font-bold text-sky-700">${escapeHtml(className)}</p>
          </div>
          <div class="rounded-2xl bg-emerald-50 p-4">
            <p class="text-sm font-semibold text-slate-700">Attendance</p>
            <p class="mt-3 text-3xl font-bold text-emerald-700">${summary.presentRatio}%</p>
          </div>
          <div class="rounded-2xl bg-amber-50 p-4">
            <p class="text-sm font-semibold text-slate-700">Average mark</p>
            <p class="mt-3 text-3xl font-bold text-amber-700">${averageMark}</p>
          </div>
        </div>

        <div class="mt-8 grid gap-6 lg:grid-cols-2">
          <div class="rounded-[1.75rem] border border-slate-200 bg-slate-50 p-6">
            <p class="text-sm font-semibold text-slate-900">Subjects</p>
            <div class="mt-4 flex flex-wrap gap-2">
              ${subjectOptions.length ? subjectOptions.map((subject) => `<span class="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700">${escapeHtml(subject)}</span>`).join('') : '<span class="text-sm text-slate-500">No subjects assigned yet.</span>'}
            </div>
          </div>
          <div class="rounded-[1.75rem] border border-slate-200 bg-slate-50 p-6">
            <p class="text-sm font-semibold text-slate-900">Recent announcements</p>
            <div class="mt-4 space-y-3">
              ${announcements.length ? announcements.slice(0, 3).map((entry) => `<div class="rounded-2xl border border-slate-200 bg-white p-3"><p class="font-semibold text-slate-900">${escapeHtml(entry.title || entry.subject || 'School notice')}</p><p class="mt-1 text-sm text-slate-600">${escapeHtml(entry.detail || entry.body || entry.message || '')}</p></div>`).join('') : '<p class="text-sm text-slate-500">No school notices for your role yet.</p>'}
            </div>
          </div>
        </div>
      </div>
    `,
    classes: `
      <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 class="text-2xl font-semibold text-slate-900">My class and subjects</h2>
        <p class="mt-2 text-sm text-slate-600">Your authorized school class information only.</p>
        <div class="mt-6 grid gap-4 md:grid-cols-2">
          ${(classes.length ? classes : [{ name: className, grade: className, teacher: 'Assigned teacher' }]).map((entry) => `
            <div class="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <p class="text-sm uppercase tracking-[0.25em] text-sky-600">Class</p>
              <h3 class="mt-3 text-xl font-semibold text-slate-900">${escapeHtml(entry.name || entry.className || className)}</h3>
              <div class="mt-4 space-y-2 text-sm text-slate-600">
                <p><span class="font-semibold text-slate-900">Grade:</span> ${escapeHtml(entry.grade || entry.className || className)}</p>
                <p><span class="font-semibold text-slate-900">Teacher:</span> ${escapeHtml(entry.teacher || entry.teacherName || 'Assigned teacher')}</p>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `,
    assignments: `
      <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 class="text-2xl font-semibold text-slate-900">My assignments</h2>
        <p class="mt-2 text-sm text-slate-600">Assignments shared with your student account.</p>
        <div class="mt-6 space-y-3">
          ${assignments.length ? assignments.map((entry) => `<article class="rounded-3xl border border-slate-200 bg-slate-50 p-4"><p class="font-semibold text-slate-900">${escapeHtml(entry.title || entry.name || 'Assignment')}</p><p class="mt-1 text-sm text-slate-600">${escapeHtml(entry.subject || 'Subject')} · Due ${escapeHtml(entry.dueDate || 'No due date')}</p><p class="mt-2 text-sm text-slate-700">${escapeHtml(entry.instructions || entry.description || entry.detail || '')}</p><p class="mt-2 text-sm text-slate-600">Status: ${escapeHtml(entry.submissions?.[0]?.status || 'not submitted')}</p>${entry.submissions?.[0]?.status ? '' : `<button type="button" data-student-assignment-id="${escapeHtml(entry.id || '')}" class="mt-3 rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white">Submit assignment</button>`}</article>`).join('') : '<p class="text-sm text-slate-500">No assignments are available for your student account yet.</p>'}
        </div>
      </div>
    `,
    lessons: `<div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm"><h2 class="text-2xl font-semibold text-slate-900">Learning Materials</h2><p class="mt-2 text-sm text-slate-600">Lessons shared with your authorized class.</p><div class="mt-6 space-y-3">${lessons.length ? lessons.map((entry) => `<article class="rounded-3xl border border-slate-200 bg-slate-50 p-4"><p class="font-semibold text-slate-900">${escapeHtml(entry.title || 'Lesson')}</p><p class="mt-1 text-sm text-slate-600">${escapeHtml(entry.subject || 'Subject')}</p><p class="mt-2 text-sm text-slate-700">${escapeHtml(entry.content || entry.description || '')}</p></article>`).join('') : '<p class="text-sm text-slate-500">No learning materials are available for your class yet.</p>'}</div></div>`,
    attendance: `
      <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 class="text-2xl font-semibold text-slate-900">My attendance</h2>
        <p class="mt-2 text-sm text-slate-600">Visible attendance history for your own account only.</p>
        <div class="mt-6 grid gap-4 sm:grid-cols-2">
          <div class="rounded-2xl bg-emerald-50 p-4"><p class="text-sm font-semibold text-slate-700">Present</p><p class="mt-2 text-2xl font-bold text-emerald-700">${summary.counts.present}</p></div>
          <div class="rounded-2xl bg-rose-50 p-4"><p class="text-sm font-semibold text-slate-700">Absent</p><p class="mt-2 text-2xl font-bold text-rose-700">${summary.counts.absent}</p></div>
        </div>
        <div class="mt-6 overflow-hidden rounded-3xl border border-slate-200">
          <table class="min-w-full text-left text-sm">
            <thead class="bg-slate-100 text-slate-700">
              <tr><th class="px-4 py-3">Date</th><th class="px-4 py-3">Status</th><th class="px-4 py-3">Class</th></tr>
            </thead>
            <tbody>
              ${displayAttendanceRecords.length ? displayAttendanceRecords.map((entry) => `<tr class="border-t border-slate-200"><td class="px-4 py-3">${escapeHtml(entry.date || '—')}</td><td class="px-4 py-3"><span class="rounded-full bg-slate-100 px-2 py-1 text-slate-700">${escapeHtml(getAttendanceStatusLabel(entry.status))}</span></td><td class="px-4 py-3">${escapeHtml(entry.className || className)}</td></tr>`).join('') : '<tr><td colspan="3" class="px-4 py-3 text-slate-500">No attendance is available for your student record yet.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `,
    results: `
      <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 class="text-2xl font-semibold text-slate-900">My results</h2>
        <p class="mt-2 text-sm text-slate-600">Your own exam marks, grades, and report data only.</p>
        <div class="mt-6 space-y-4">
          <h3 class="font-semibold text-slate-900">Report cards</h3>
          ${reportSheetResults.length ? renderReportSheets(reportSheetResults, [student], schoolName) : '<p class="text-sm text-slate-500">No report cards are available yet.</p>'}
        </div>
        ${legacyExamResults.length ? `
        <div class="mt-6 overflow-hidden rounded-3xl border border-slate-200">
          <table class="min-w-full text-left text-sm">
            <thead class="bg-slate-100 text-slate-700">
              <tr><th class="px-4 py-3">Exam</th><th class="px-4 py-3">Subject</th><th class="px-4 py-3">Score</th><th class="px-4 py-3">Grade</th></tr>
            </thead>
            <tbody>
              ${legacyExamResults.map((entry) => `<tr class="border-t border-slate-200"><td class="px-4 py-3">${escapeHtml(entry.exam || entry.title || 'Assessment')}</td><td class="px-4 py-3">${escapeHtml(entry.subject || 'Subject')}</td><td class="px-4 py-3">${escapeHtml(String(entry.mark ?? entry.score ?? '—'))}/${escapeHtml(String(entry.maxMarks || entry.total || '—'))}</td><td class="px-4 py-3"><span class="rounded-full bg-emerald-100 px-2 py-1 text-emerald-700">${escapeHtml(entry.grade || '—')}</span></td></tr>`).join('')}
            </tbody>
          </table>
        </div>
        ` : ''}
      </div>
    `,
    announcements: `
      <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 class="text-2xl font-semibold text-slate-900">Announcements</h2>
        <p class="mt-2 text-sm text-slate-600">Student-targeted and everyone announcements only.</p>
        <div class="mt-6 space-y-4">
          ${announcements.length ? announcements.map((entry) => `<div class="rounded-3xl border border-slate-200 bg-slate-50 p-4"><p class="font-semibold text-slate-900">${escapeHtml(entry.title || entry.subject || 'Announcement')}</p><p class="mt-2 text-sm text-slate-600">${escapeHtml(entry.detail || entry.body || entry.message || '')}</p></div>`).join('') : '<p class="text-sm text-slate-500">No announcements are visible to this student role.</p>'}
        </div>
      </div>
    `,
    messages: `
      <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 class="text-2xl font-semibold text-slate-900">Messages</h2>
        <p class="mt-2 text-sm text-slate-600">Inbox and school notices intended for your student account.</p>
        <div class="mt-6 space-y-3">
          ${messages.length ? messages.map((entry) => `<article class="rounded-3xl border border-slate-200 bg-slate-50 p-4"><p class="font-semibold text-slate-900">${escapeHtml(entry.subject || entry.title || 'Message')}</p><p class="mt-2 text-sm text-slate-600">${escapeHtml(entry.body || entry.message || entry.detail || '')}</p></article>`).join('') : '<p class="text-sm text-slate-500">No messages are available in your inbox.</p>'}
        </div>
      </div>
    `,
    notifications: `
      <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 class="text-2xl font-semibold text-slate-900">Notifications</h2>
        <p class="mt-2 text-sm text-slate-600">Recent updates and reminders for your learning account.</p>
        <div class="mt-6 space-y-3">
          ${announcements.length ? announcements.slice(0, 5).map((entry) => `<div class="rounded-3xl border border-slate-200 bg-slate-50 p-4"><p class="font-semibold text-slate-900">${escapeHtml(entry.title || entry.subject || 'Update')}</p><p class="mt-2 text-sm text-slate-600">${escapeHtml(entry.detail || entry.body || entry.message || '')}</p></div>`).join('') : '<p class="text-sm text-slate-500">No notifications are available.</p>'}
        </div>
      </div>
    `,
    profile: `
      <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 class="text-2xl font-semibold text-slate-900">My profile</h2>
        <div class="mt-6 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <div class="rounded-3xl border border-slate-200 bg-slate-50 p-5 text-center">
            ${profilePhoto ? `<img src="${escapeHtml(profilePhoto)}" alt="${escapeHtml(studentName)}" class="mx-auto h-24 w-24 rounded-full object-cover" />` : `<div class="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-sky-100 text-2xl font-semibold text-sky-700">${escapeHtml((studentName || 'S').charAt(0).toUpperCase())}</div>`}
            <p class="mt-4 text-xl font-semibold text-slate-900">${escapeHtml(studentName)}</p>
            <p class="text-sm text-slate-600">${escapeHtml(studentId)}</p>
            <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" data-student-profile-photo-input class="sr-only" />
            <div class="mt-4 flex flex-wrap gap-2">
              <button type="button" data-student-profile-photo-upload class="rounded-full border border-sky-200 bg-white px-4 py-2 text-sm font-semibold text-sky-700 transition hover:bg-sky-50">Upload Photo</button>
              <button type="button" data-student-profile-photo-camera class="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100">Open Camera</button>
            </div>
            <p data-student-profile-photo-status class="mt-2 text-sm text-slate-600" role="status" aria-live="polite"></p>
          </div>
          <div class="grid gap-4 md:grid-cols-2">
            <div class="rounded-[1.25rem] border border-slate-200 bg-white p-4"><p class="text-sm text-slate-500">Student ID</p><p class="mt-1 font-semibold text-slate-900">${escapeHtml(studentId)}</p></div>
            <div class="rounded-[1.25rem] border border-slate-200 bg-white p-4"><p class="text-sm text-slate-500">School</p><p class="mt-1 font-semibold text-slate-900">${escapeHtml(schoolName)}</p></div>
            <div class="rounded-[1.25rem] border border-slate-200 bg-white p-4"><p class="text-sm text-slate-500">Class</p><p class="mt-1 font-semibold text-slate-900">${escapeHtml(className)}</p></div>
            <div class="rounded-[1.25rem] border border-slate-200 bg-white p-4"><p class="text-sm text-slate-500">Email</p><p class="mt-1 font-semibold text-slate-900">${escapeHtml(student.email || '—')}</p></div>
          </div>
        </div>
      </div>
    `,
    settings: `
      <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 class="text-2xl font-semibold text-slate-900">Settings</h2>
        <p class="mt-2 text-sm text-slate-600">Student preferences supported by the current architecture.</p>
        <div class="mt-6 max-w-lg space-y-4">
          <label class="block"><span class="text-sm font-semibold text-slate-900">Theme</span><input value="Default" disabled class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-500" /></label>
          <label class="block"><span class="text-sm font-semibold text-slate-900">Notification preference</span><input value="School updates" disabled class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-500" /></label>
        </div>
      </div>
    `,
    support: `
      <div class="rounded-4xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 class="text-2xl font-semibold text-slate-900">Support</h2>
        <p class="mt-2 text-sm text-slate-600">Use the existing school support contact flow. Student changes are limited to the current account and school.</p>
      </div>
    `,
  };

  const normalized = String(section || 'overview').toLowerCase();
  return `
    <div class="space-y-8">
      ${sectionMap[normalized] || sectionMap.overview}
    </div>
  `;
}
