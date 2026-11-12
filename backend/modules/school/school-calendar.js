const crypto = require('crypto');

const CALENDAR_EVENT_TYPES = new Set([
  'public_holiday',
  'school_holiday',
  'vacation',
  'special_closure',
  'custom',
]);

function parseCalendarDate(value, label = 'date') {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`A valid ${label} in YYYY-MM-DD format is required.`);
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`A valid ${label} in YYYY-MM-DD format is required.`);
  }
  return date;
}

function getSchoolLocalDate(now = new Date(), timeZone = 'UTC') {
  const formatter = new Intl.DateTimeFormat('en', {
    timeZone: timeZone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function normalizeSchoolCalendarEvent(input = {}, existing = null, actor = {}, now = new Date()) {
  const source = { ...(existing || {}), ...input };
  const title = String(source.title || source.name || '').trim();
  const type = String(source.type || 'custom').trim().toLowerCase();
  const startDate = parseCalendarDate(source.startDate, 'start date');
  const endDate = parseCalendarDate(source.endDate || startDate, 'end date');

  if (!title) throw new Error('A calendar event name is required.');
  if (title.length > 120 || String(source.description || '').trim().length > 500) {
    throw new Error('Calendar event names must be at most 120 characters and descriptions at most 500 characters.');
  }
  if (!CALENDAR_EVENT_TYPES.has(type)) throw new Error('Unsupported school calendar event type.');
  if (endDate < startDate) throw new Error('The calendar event end date cannot be before its start date.');

  const schoolClosure = source.schoolClosure === undefined
    ? !['public_holiday', 'custom'].includes(type)
    : source.schoolClosure === true;
  const status = String(source.status || 'active').trim().toLowerCase();
  if (!['active', 'cancelled'].includes(status)) throw new Error('Calendar event status must be active or cancelled.');

  return {
    id: String(existing?.id || `cal-${crypto.randomUUID()}`),
    kind: 'school_calendar',
    title,
    description: String(source.description || '').trim(),
    type,
    startDate,
    endDate,
    schoolClosure,
    status,
    createdBy: existing?.createdBy || actor.userId || actor.id || actor.email || null,
    createdAt: existing?.createdAt || now.toISOString(),
    updatedBy: actor.userId || actor.id || actor.email || null,
    updatedAt: now.toISOString(),
  };
}

function isWeekend(date) {
  const day = new Date(`${parseCalendarDate(date)}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

function schoolClosuresForDate(events = [], date) {
  const localDate = parseCalendarDate(date);
  return (Array.isArray(events) ? events : []).filter((event) => (
    event?.kind === 'school_calendar'
      && event.schoolClosure === true
      && event.status !== 'cancelled'
      && event.startDate <= localDate
      && event.endDate >= localDate
  ));
}

function studentMatchesClass(student, classRecord) {
  const classId = String(classRecord.classId || classRecord.id || '').trim().toLowerCase();
  const studentClassId = String(student.classId || '').trim().toLowerCase();
  if (studentClassId) return classId && studentClassId === classId;
  const aliases = [classRecord.name, classRecord.className, classRecord.grade]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());
  const studentClassName = String(student.className || student.gradeLevel || student.grade || '').trim().toLowerCase();
  return Boolean(studentClassName && aliases.includes(studentClassName));
}

function getCurrentAcademicYear(school = {}) {
  const years = Array.isArray(school.academicYears) ? school.academicYears : [];
  const explicitId = String(school.currentAcademicYearId || school.academicYearId || '').trim();
  if (explicitId) return years.find((year) => String(year.id || year.academicYearId || '').trim() === explicitId) || { id: explicitId };

  const label = String(school.currentAcademicYear || school.academicYear || '').trim().toLowerCase();
  if (label) {
    const labeledYear = years.find((year) => String(year.label || year.name || '').trim().toLowerCase() === label);
    if (labeledYear) return labeledYear;
  }

  const activeYears = years.filter((year) => ['active', 'current'].includes(String(year.status || '').trim().toLowerCase()));
  return activeYears.length === 1 ? activeYears[0] : null;
}

function buildTeacherAttendanceTasks({ school, classes = [], students = [], attendanceRecords = [], date } = {}) {
  const timeZone = school?.timezone || 'UTC';
  const localDate = parseCalendarDate(date || getSchoolLocalDate(new Date(), timeZone));
  const base = { date: localDate, timeZone, tasks: [], schoolClosures: [] };
  if (isWeekend(localDate)) return { ...base, dayType: 'weekend' };

  const schoolClosures = schoolClosuresForDate(school?.events, localDate);
  if (schoolClosures.length) return { ...base, dayType: 'school_closure', schoolClosures };

  const currentAcademicYear = getCurrentAcademicYear(school);
  if (currentAcademicYear && (
    currentAcademicYear.startDate && localDate < String(currentAcademicYear.startDate).slice(0, 10)
      || currentAcademicYear.endDate && localDate > String(currentAcademicYear.endDate).slice(0, 10)
  )) {
    return { ...base, dayType: 'outside_academic_year' };
  }

  const activeClasses = (Array.isArray(classes) ? classes : [])
    .filter((entry) => !['archived', 'inactive', 'disabled'].includes(String(entry.status || 'active').toLowerCase()));
  const uniqueClasses = [...new Map(activeClasses.map((entry) => {
    const key = String(entry.classId || entry.id || entry.name || entry.className || '').trim().toLowerCase();
    return [key, entry];
  })).values()];
  const activeStudents = (Array.isArray(students) ? students : [])
    .filter((entry) => !['archived', 'inactive', 'disabled'].includes(String(entry.status || 'active').toLowerCase()));
  const uniqueStudents = [...new Map(activeStudents.map((entry) => {
    const key = String(entry.studentId || entry.id || entry.email || '').trim().toLowerCase();
    return [key, entry];
  })).values()];
  const tasks = uniqueClasses
    .filter((entry) => {
      const classYearId = String(entry.academicYearId || '').trim();
      if (!classYearId) return true;
      const currentYearId = String(currentAcademicYear?.id || currentAcademicYear?.academicYearId || '').trim();
      const classYearLabel = String(entry.academicYear || '').trim().toLowerCase();
      const currentYearLabel = String(currentAcademicYear?.label || currentAcademicYear?.name || '').trim().toLowerCase();
      return currentYearId ? classYearId === currentYearId : Boolean(classYearLabel && classYearLabel === currentYearLabel);
    })
    .map((classRecord) => {
      const classId = String(classRecord.classId || classRecord.id || classRecord.name || classRecord.className || '').trim();
      const className = String(classRecord.name || classRecord.className || classRecord.grade || classId).trim();
      const classAliases = [classId, classRecord.name, classRecord.className, classRecord.grade]
        .filter(Boolean)
        .map((value) => String(value).trim().toLowerCase());
      const roster = uniqueStudents.filter((student) => studentMatchesClass(student, classRecord));
      const submittedIds = new Set((Array.isArray(attendanceRecords) ? attendanceRecords : [])
        .filter((record) => {
          if (String(record.date || '').slice(0, 10) !== localDate) return false;
          if (!['present', 'absent', 'late'].includes(String(record.status || '').toLowerCase())) return false;
          const recordClassId = String(record.classId || '').trim().toLowerCase();
          const recordClassName = String(record.className || '').trim().toLowerCase();
          if (recordClassId) return recordClassId === classId.toLowerCase();
          return classAliases.includes(recordClassName);
        })
        .map((record) => String(record.studentId || record.student || '').trim().toLowerCase())
        .filter(Boolean));
      const submittedCount = roster.filter((student) => (
        submittedIds.has(String(student.studentId || student.id || student.email || '').trim().toLowerCase())
      )).length;
      const completed = roster.length > 0 && submittedCount === roster.length;

      return {
        id: `attendance:${String(school?.schoolId || school?.id || '').trim()}:${classId}:${localDate}`,
        schoolId: school?.schoolId || school?.id || '',
        classId,
        className,
        date: localDate,
        expectedStudentCount: roster.length,
        submittedStudentCount: submittedCount,
        status: roster.length === 0 ? 'not_required' : completed ? 'completed' : 'pending',
      };
    });

  return { ...base, dayType: 'instructional_weekday', tasks };
}

module.exports = {
  buildTeacherAttendanceTasks,
  getSchoolLocalDate,
  getCurrentAcademicYear,
  normalizeSchoolCalendarEvent,
  parseCalendarDate,
  schoolClosuresForDate,
};
