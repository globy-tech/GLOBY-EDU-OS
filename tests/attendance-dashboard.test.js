const fs = require('fs');
const path = require('path');

describe('attendance dashboard experience', () => {
  it('shows School Authority a read-only summary of attendance submitted by teachers for today', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'school-dashboard.js'), 'utf8');

    expect(source).toContain("String(entry.date || '').slice(0, 10) === date");
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
    expect(source).toContain('Mark attendance for an assigned class');
    expect(source).toContain('data-school-attendance-load');
    expect(source).toContain("normalized === 'present' || normalized === 'late'");
    expect(source).toContain("normalized === 'absent' || normalized === 'excused'");
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
    const attendanceStart = source.indexOf('<h2 class="text-2xl font-semibold text-slate-900">My attendance</h2>');
    const attendanceEnd = source.indexOf('\n    results: `', attendanceStart);
    const studentAttendance = source.slice(attendanceStart, attendanceEnd);
    expect(studentAttendance).toBeTruthy();
    expect(studentAttendance).toContain('Present');
    expect(studentAttendance).toContain('Absent');
    expect(studentAttendance).not.toContain('Late');
    expect(studentAttendance).not.toContain('Excused');
    expect(studentAttendance).toContain('getAttendanceStatusLabel(entry.status)');
    expect(source).toContain("normalized === 'present' || normalized === 'late'");
    expect(source).toContain("normalized === 'absent' || normalized === 'excused'");
  });

  it('keeps the dashboard overview focused on summary cards and charts', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'school-dashboard.js'), 'utf8');

    expect(source).toContain("Today's Attendance");
    expect(source).not.toContain('Academic Structure Manager');
    expect(source).not.toContain('Global Search');
  });

  it('lets teachers record only present or absent and requires a selection', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js'), 'utf8');
    expect(source).toContain("const statusOptions = ['present', 'absent']");
    expect(source).toContain('Choose Present or Absent for every student before saving.');
    expect(source).toContain("{ label: 'Present', value: 'present' }");
    expect(source).toContain("{ label: 'Absent', value: 'absent' }");
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
});
