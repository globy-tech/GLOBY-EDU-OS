const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

describe('attendance dashboard experience', () => {
  it('shows School Authority a read-only summary of attendance submitted by teachers for today', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'school-dashboard.js'), 'utf8');
    const summarySource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'utils', 'attendance-summary.mjs'), 'utf8');

    expect(summarySource).toContain("date === 'all' || String(entry.date || '').slice(0, 10) === date");
    expect(source).toContain("new Date().toISOString().slice(0, 10)");
    expect(source).toContain('Teacher-submitted attendance');
    expect(source).toContain('Only Present and Absent are recorded; School Authority can view and export records but cannot take attendance.');
    expect(source).toContain('Present');
    expect(source).toContain('Absent');
    expect(source).toContain('Students who came');
    expect(source).toContain('Students absent');

    const authorityAttendance = source.match(/attendance: `\s*<div class="space-y-6">([\s\S]*?)\n\s*exams:/)?.[1];
    expect(authorityAttendance).toBeTruthy();
    expect(authorityAttendance).not.toContain('data-school-attendance-load');
    expect(authorityAttendance).not.toContain('school-attendance-roster');
    expect(authorityAttendance).not.toContain('school-attendance-save');
    expect(authorityAttendance).toContain('school-attendance-view-date');
    expect(authorityAttendance).toContain('school-attendance-view-all-dates');
    expect(authorityAttendance).toContain('school-attendance-view-class');
    expect(authorityAttendance).toContain('school-attendance-view-term');
    expect(authorityAttendance).toContain('school-attendance-view-year');
    expect(authorityAttendance).toContain('attendanceSummary.coverage.pendingClassNames');
    expect(authorityAttendance).toContain('attendanceSummary.coverage.unknown');
    expect(source).toContain('Mark attendance for an assigned class');
    expect(source).toContain('data-school-attendance-load');
    expect(summarySource).toContain("normalized === 'present' || normalized === 'late'");
    expect(summarySource).toContain("normalized === 'absent' || normalized === 'excused'");
  });

  it('filters School Authority attendance by class and reports class coverage conservatively', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'school-dashboard.js'), 'utf8');
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js'), 'utf8');
    const summarySource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'utils', 'attendance-summary.mjs'), 'utf8');

    expect(summarySource).toContain('export function getAttendanceClassOptions(classes = [])');
    expect(summarySource).toContain("['archived', 'inactive', 'deleted'].includes(status)");
    expect(summarySource).toContain('attendanceRecordMatchesClass(entry, selectedClassOption)');
    expect(summarySource).toContain('pendingClassNames: pendingClasses.map((classOption) => classOption.label)');
    expect(summarySource).toContain('const uniqueAttendanceRecords = new Map()');
    expect(source).toContain('could not be assigned');
    expect(mainSource).toContain('globyedu_attendance_view_class:${schoolId}');
    expect(mainSource).toContain("document.getElementById('school-attendance-view-class')");
  });

  it('shows School Authority a dated teacher activity feed without message contents', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'school-dashboard.js'), 'utf8');
    const apiSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'api', 'school.js'), 'utf8');

    expect(source).toContain("activity: `");
    expect(source).toContain('Dated school activity log');
    expect(source).toContain("'teacher.attendance.updated': 'Attendance records updated'");
    expect(source).toContain("'teacher.marks.updated': 'Student marks updated'");
    expect(source).toContain("'teacher.message.sent': 'Message sent'");
    expect(source).toContain('Message contents and sensitive student details are not shown');
    expect(source).toContain('teacherActivityLoadError');
    expect(apiSource).toContain('/activity?limit=');
  });

  it('shows students only Present and Absent in dated attendance history', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'school-dashboard.js'), 'utf8');
    const summarySource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'utils', 'attendance-summary.mjs'), 'utf8');
    const attendanceStart = source.indexOf('<h2 class="text-2xl font-semibold text-slate-900">My attendance</h2>');
    const attendanceEnd = source.indexOf('\n    results: `', attendanceStart);
    const studentAttendance = source.slice(attendanceStart, attendanceEnd);
    expect(studentAttendance).toBeTruthy();
    expect(studentAttendance).toContain('Present');
    expect(studentAttendance).toContain('Absent');
    expect(studentAttendance).not.toContain('Late');
    expect(studentAttendance).not.toContain('Excused');
    expect(studentAttendance).toContain('getAttendanceStatusLabel(entry.status)');
    expect(summarySource).toContain("normalized === 'present' || normalized === 'late'");
    expect(summarySource).toContain("normalized === 'absent' || normalized === 'excused'");
  });

  it('keeps the dashboard overview focused on summary cards and charts', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'school-dashboard.js'), 'utf8');

    expect(source).toContain("Today's Attendance");
    expect(source).not.toContain('Academic Structure Manager');
    expect(source).not.toContain('Global Search');
  });

  it('lets teachers record only present or absent and requires a selection', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js'), 'utf8');
    const dashboardSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'school-dashboard.js'), 'utf8');
    expect(source).toContain("const statusOptions = ['present', 'absent']");
    expect(source).toContain('Choose Present or Absent for every student before saving.');
    expect(source).toContain("const statusOptions = ['present', 'absent']");
    expect(source).toContain('status: normalizeAttendanceStatus(record.status)');
    expect(source).toContain(".filter((record) => record.status)");
  });

  it('builds a class roster and hydrates only current two-status values', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'utils', 'school-dashboard-actions.js'), 'utf8');
    expect(source).toContain('buildAttendanceRoster');
    expect(source).toContain("status || 'active'");
    expect(source).toContain('attendanceRecords');
    expect(source).toContain("value === 'present' || value === 'late'");
    expect(source).toContain("value === 'absent' || value === 'excused'");
    expect(source).toContain("return '';");
  });

  it('replaces only the selected date and class while keeping historical dated attendance', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'utils', 'school-dashboard-actions.js'), 'utf8');
    expect(source).toContain('replaceAttendanceSession');
    expect(source).toContain('const keys = new Set');
    expect(source).toContain('retained');
    expect(source).toContain('String(record.date || \'\').slice(0, 10)');
    expect(source).toContain("status: normalizeAttendanceStatus(entry.status)");
  });

  it('does not count weekends or declared closures as pending class attendance', () => {
    const helperPath = path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'utils', 'attendance-summary.mjs');
    const script = String.raw`
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { summarizeAttendanceRecords } = await import(pathToFileURL(process.argv[1]));
const classes = [{ classId: 'class-a', name: 'Class A' }];
const weekend = summarizeAttendanceRecords([], '2026-11-14', classes);
assert.equal(weekend.coverage.required, false);
assert.equal(weekend.coverage.pending, 0);
const closure = summarizeAttendanceRecords([], '2026-11-12', classes, 'all', 'all', 'all', 'all', [
  { kind: 'school_calendar', schoolClosure: true, status: 'active', startDate: '2026-11-12', endDate: '2026-11-16' },
]);
assert.equal(closure.coverage.notRequiredReason, 'school_closure');
assert.equal(closure.coverage.pending, 0);
const publicHoliday = summarizeAttendanceRecords([], '2026-11-12', classes, 'all', 'all', 'all', 'all', [
  { kind: 'school_calendar', schoolClosure: false, status: 'active', startDate: '2026-11-12', endDate: '2026-11-12' },
]);
assert.equal(publicHoliday.coverage.required, true);
assert.equal(publicHoliday.coverage.pending, 1);
`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, helperPath], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      throw new Error(`Instructional-day attendance coverage check failed: ${result.stderr || result.stdout || result.error}`);
    }
  });

  it('exposes School Authority calendar management and teacher task state', () => {
    const pageSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'school-dashboard.js'), 'utf8');
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js'), 'utf8');
    const apiSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'api', 'school.js'), 'utf8');
    expect(mainSource).toContain("id: 'calendar', label: 'School Calendar'");
    expect(pageSource).toContain('data-school-calendar-form');
    expect(pageSource).toContain('Public holidays do not close attendance unless marked as a school closure.');
    expect(pageSource).toContain('attendanceTasks.dayType');
    expect(mainSource).toContain('fetchTeacherAttendanceTasks(token, schoolId, date)');
    expect(apiSource).toContain('/attendance-tasks');
  });
});
