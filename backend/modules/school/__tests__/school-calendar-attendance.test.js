jest.mock('../../../firebase.data', () => ({ isFirebaseDataConfigured: () => false }));
jest.mock('../../../config/prisma.client', () => ({ __stub: true }));

const cleanupIsolatedSchoolStore = require('./isolated-school-store')();
const schoolService = require('../school.service');
const schoolRouter = require('../school.controller');
const {
  buildTeacherAttendanceTasks,
  getSchoolLocalDate,
  normalizeSchoolCalendarEvent,
} = require('../school-calendar');
const { loadSchoolData, saveSchoolData } = require('../fallback.school');
const { listAuditEvents } = require('../../audit/audit.service');

const SCHOOL_ID = 'calendar-school-a';
const OTHER_SCHOOL_ID = 'calendar-school-b';
const authority = {
  userId: 'calendar-school-a:AUTH-1',
  roles: ['school_authority'],
  tenantId: SCHOOL_ID,
  schoolId: SCHOOL_ID,
};
const teacher = {
  userId: 'calendar-school-a:T-1',
  username: 'T-1',
  roles: ['teacher'],
  tenantId: SCHOOL_ID,
  schoolId: SCHOOL_ID,
};
const OTHER_TEACHER = {
  userId: 'calendar-school-b:T-2',
  username: 'T-2',
  roles: ['teacher'],
  tenantId: OTHER_SCHOOL_ID,
  schoolId: OTHER_SCHOOL_ID,
};
const WEEKDAY = '2026-11-12';

function createSchool(schoolId, teacherId, classPrefix) {
  const firstClassId = `${classPrefix}-1`;
  const secondClassId = `${classPrefix}-2`;
  return {
    id: `tenant-${schoolId}`,
    schoolId,
    name: schoolId,
    timezone: 'Africa/Accra',
    status: 'active',
    schoolStatus: 'active',
    subscriptionStatus: 'active',
    users: [],
    teachers: [{ teacherId, username: teacherId, fullName: teacherId }],
    classes: [
      { classId: firstClassId, name: `${classPrefix} Class 1`, teacherIds: [teacherId] },
      { classId: secondClassId, name: `${classPrefix} Class 2`, teacherIds: [teacherId] },
    ],
    students: [
      { studentId: `${classPrefix}-S1`, fullName: 'Student One', classId: firstClassId, className: `${classPrefix} Class 1` },
      { studentId: `${classPrefix}-S2`, fullName: 'Student Two', classId: firstClassId, className: `${classPrefix} Class 1` },
      { studentId: `${classPrefix}-S3`, fullName: 'Student Three', classId: secondClassId, className: `${classPrefix} Class 2` },
    ],
    attendanceRecords: [],
    events: [],
  };
}

function route(method, path) {
  const layer = schoolRouter.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
  if (!layer) throw new Error(`School route not found: ${method.toUpperCase()} ${path}`);
  return layer.route;
}

beforeEach(() => {
  global.__workspaceSnapshot = [
    createSchool(SCHOOL_ID, 'T-1', 'A'),
    createSchool(OTHER_SCHOOL_ID, 'T-2', 'B'),
  ];
  jest.restoreAllMocks();
});

afterEach(() => {
  delete global.__workspaceSnapshot;
});

afterAll(() => cleanupIsolatedSchoolStore());

describe('school calendar and attendance tasks', () => {
  test('validates local calendar dates, date ranges, and timezone boundaries', () => {
    expect(getSchoolLocalDate(new Date('2026-11-12T02:00:00.000Z'), 'America/Los_Angeles')).toBe('2026-11-11');
    expect(getSchoolLocalDate(new Date('2026-11-12T02:00:00.000Z'), 'Africa/Accra')).toBe('2026-11-12');
    expect(() => getSchoolLocalDate(new Date(), 'not/a-timezone')).toThrow(RangeError);
    expect(() => normalizeSchoolCalendarEvent({ title: 'Bad date', startDate: '2026-02-30' })).toThrow(/valid start date/);
    expect(() => normalizeSchoolCalendarEvent({ title: 'Backwards', startDate: '2026-11-13', endDate: WEEKDAY })).toThrow(/cannot be before/);
  });

  test('School Authority can persist a multi-day closure and duplicate entries are rejected', async () => {
    const closure = await schoolService.createSchoolCalendarEvent(SCHOOL_ID, {
      title: 'Mid-term break',
      type: 'vacation',
      startDate: '2026-11-12',
      endDate: '2026-11-16',
      schoolClosure: true,
    }, authority);

    expect(closure).toMatchObject({
      kind: 'school_calendar',
      status: 'active',
      schoolClosure: true,
      startDate: '2026-11-12',
      endDate: '2026-11-16',
    });
    expect(loadSchoolData().find((school) => school.schoolId === SCHOOL_ID).events).toContainEqual(closure);
    await expect(schoolService.createSchoolCalendarEvent(SCHOOL_ID, {
      title: 'Mid-term break',
      type: 'vacation',
      startDate: '2026-11-12',
      endDate: '2026-11-16',
      schoolClosure: true,
    }, authority)).rejects.toMatchObject({ statusCode: 409 });
    await expect(schoolService.createSchoolCalendarEvent(SCHOOL_ID, {
      title: 'Wrong dates',
      startDate: '2026-02-30',
    }, authority)).rejects.toThrow(/valid start date/);
  });

  test('teachers cannot manage calendar entries and school tenant calendars remain isolated', async () => {
    await expect(schoolService.createSchoolCalendarEvent(SCHOOL_ID, {
      title: 'Unauthorized',
      startDate: WEEKDAY,
    }, teacher)).rejects.toMatchObject({ statusCode: 403 });
    await expect(schoolService.createSchoolCalendarEvent(SCHOOL_ID, {
      title: 'Cross-tenant',
      startDate: WEEKDAY,
    }, OTHER_TEACHER)).rejects.toMatchObject({ statusCode: 403 });

    await schoolService.createSchoolCalendarEvent(SCHOOL_ID, {
      title: 'School A closure',
      type: 'special_closure',
      startDate: WEEKDAY,
      endDate: WEEKDAY,
    }, authority);
    const otherSchoolTasks = await schoolService.getTeacherAttendanceTasks(OTHER_SCHOOL_ID, OTHER_TEACHER, WEEKDAY);
    expect(otherSchoolTasks.dayType).toBe('instructional_weekday');
    expect(otherSchoolTasks.tasks).toHaveLength(2);
  });

  test('a teacher receives no attendance tasks for classes assigned to another teacher', async () => {
    const school = loadSchoolData().find((entry) => entry.schoolId === SCHOOL_ID);
    school.teachers.push({ teacherId: 'T-OTHER', username: 'T-OTHER', fullName: 'Other Teacher' });
    school.classes.push({ classId: 'A-OTHER', name: 'A Other Class', teacherIds: ['T-OTHER'] });
    school.students.push({
      studentId: 'A-OTHER-S1',
      classId: 'A-OTHER',
      className: 'A Other Class',
      fullName: 'Other Class Student',
    });

    const tasks = await schoolService.getTeacherAttendanceTasks(SCHOOL_ID, teacher, WEEKDAY);
    expect(tasks.tasks.map((task) => task.classId)).toEqual(['A-1', 'A-2']);
  });

  test('public holidays do not close the school unless explicitly configured as closures', () => {
    const publicHoliday = normalizeSchoolCalendarEvent({
      title: 'Public holiday',
      type: 'public_holiday',
      startDate: WEEKDAY,
    }, null, authority);
    const school = createSchool(SCHOOL_ID, 'T-1', 'A');
    school.events = [publicHoliday];
    const tasks = buildTeacherAttendanceTasks({
      school,
      classes: school.classes,
      students: school.students,
      date: WEEKDAY,
    });
    expect(tasks.dayType).toBe('instructional_weekday');
    expect(tasks.tasks).toHaveLength(2);
  });

  test('weekends and both ends of a declared closure range do not generate attendance tasks', async () => {
    const school = createSchool(SCHOOL_ID, 'T-1', 'A');
    school.events = [normalizeSchoolCalendarEvent({
      title: 'Vacation',
      type: 'vacation',
      startDate: '2026-11-13',
      endDate: '2026-11-16',
      schoolClosure: true,
    }, null, authority)];
    expect(buildTeacherAttendanceTasks({
      school,
      classes: school.classes,
      students: school.students,
      date: '2026-11-14',
    })).toMatchObject({ dayType: 'weekend', tasks: [] });
    expect(buildTeacherAttendanceTasks({
      school,
      classes: school.classes,
      students: school.students,
      date: '2026-11-13',
    })).toMatchObject({ dayType: 'school_closure', tasks: [] });
    expect(buildTeacherAttendanceTasks({
      school,
      classes: school.classes,
      students: school.students,
      date: '2026-11-16',
    })).toMatchObject({ dayType: 'school_closure', tasks: [] });

    const persistedClosure = await schoolService.createSchoolCalendarEvent(SCHOOL_ID, {
      title: 'One day closure',
      type: 'special_closure',
      startDate: WEEKDAY,
    }, authority);
    expect(persistedClosure.schoolClosure).toBe(true);
    const tasks = await schoolService.getTeacherAttendanceTasks(SCHOOL_ID, teacher, WEEKDAY);
    expect(tasks).toMatchObject({ dayType: 'school_closure', tasks: [] });
  });

  test('academic-year bounds suppress tasks outside the configured school year', () => {
    const school = createSchool(SCHOOL_ID, 'T-1', 'A');
    school.academicYear = '2026/2027';
    school.academicYears = [{
      id: 'year-current',
      label: '2026/2027',
      status: 'active',
      startDate: '2026-09-01',
      endDate: '2027-07-01',
    }];
    school.classes[0].academicYearId = 'year-current';
    school.classes[1].academicYearId = 'year-old';
    expect(buildTeacherAttendanceTasks({
      school,
      classes: school.classes,
      students: school.students,
      date: '2027-07-02',
    })).toMatchObject({ dayType: 'outside_academic_year', tasks: [] });
    expect(buildTeacherAttendanceTasks({
      school,
      classes: school.classes,
      students: school.students,
      date: WEEKDAY,
    }).tasks.map((task) => task.classId)).toEqual(['A-1']);
  });

  test('assigned classes get stable separate tasks that complete only after the full persisted roster is marked', async () => {
    const first = await schoolService.getTeacherAttendanceTasks(SCHOOL_ID, teacher, WEEKDAY);
    const repeated = await schoolService.getTeacherAttendanceTasks(SCHOOL_ID, teacher, WEEKDAY);
    expect(first.tasks).toHaveLength(2);
    expect(first.tasks.map((task) => task.id)).toEqual(repeated.tasks.map((task) => task.id));
    expect(first.tasks.map((task) => task.status)).toEqual(['pending', 'pending']);

    const school = await schoolService.getSchoolBySchoolId(SCHOOL_ID);
    const partial = schoolService.updateTeacherWorkspace(school, teacher, {
      attendanceRecords: [{
        date: WEEKDAY,
        classId: 'A-1',
        className: 'A Class 1',
        studentId: 'A-S1',
        status: 'present',
      }],
    });
    await schoolService.updateSchool(school.id, { attendanceRecords: partial.attendanceRecords });
    const stillOpen = await schoolService.getTeacherAttendanceTasks(SCHOOL_ID, teacher, WEEKDAY);
    expect(stillOpen.tasks.find((task) => task.classId === 'A-1')).toMatchObject({
      expectedStudentCount: 2,
      submittedStudentCount: 1,
      status: 'pending',
    });

    const latestSchool = await schoolService.getSchoolBySchoolId(SCHOOL_ID);
    const complete = schoolService.updateTeacherWorkspace(latestSchool, teacher, {
      attendanceRecords: [
        { date: WEEKDAY, classId: 'A-1', className: 'A Class 1', studentId: 'A-S1', status: 'present' },
        { date: WEEKDAY, classId: 'A-1', className: 'A Class 1', studentId: 'A-S2', status: 'absent' },
      ],
    });
    await schoolService.updateSchool(latestSchool.id, { attendanceRecords: complete.attendanceRecords });
    const persistedSchools = loadSchoolData();
    delete global.__workspaceSnapshot;
    saveSchoolData(persistedSchools);
    const afterRefresh = await schoolService.getTeacherAttendanceTasks(SCHOOL_ID, teacher, WEEKDAY);
    expect(afterRefresh.tasks.find((task) => task.classId === 'A-1')).toMatchObject({
      expectedStudentCount: 2,
      submittedStudentCount: 2,
      status: 'completed',
    });
  });

  test('calendar updates retain history and cancellation re-enables attendance tasks', async () => {
    const event = await schoolService.createSchoolCalendarEvent(SCHOOL_ID, {
      title: 'Staff development',
      type: 'special_closure',
      startDate: WEEKDAY,
      endDate: WEEKDAY,
    }, authority);
    const updated = await schoolService.updateSchoolCalendarEvent(SCHOOL_ID, event.id, {
      title: 'Staff development day',
      status: 'cancelled',
    }, authority);
    expect(updated).toMatchObject({
      id: event.id,
      title: 'Staff development day',
      createdBy: authority.userId,
      status: 'cancelled',
    });
    expect(updated.updatedAt).toBeTruthy();
    expect((await schoolService.getTeacherAttendanceTasks(SCHOOL_ID, teacher, WEEKDAY)).dayType).toBe('instructional_weekday');
  });

  test('failed attendance persistence leaves the generated class task pending', async () => {
    const school = loadSchoolData().find((entry) => entry.schoolId === SCHOOL_ID);
    jest.spyOn(schoolService, 'getSchoolBySchoolId').mockResolvedValue(structuredClone(school));
    jest.spyOn(schoolService, 'updateSchool').mockRejectedValue(new Error('Attendance persistence failed.'));
    const updateRoute = route('put', '/:schoolId');
    const handler = updateRoute.stack[updateRoute.stack.length - 1].handle;
    const response = { status: jest.fn(), json: jest.fn() };
    response.status.mockReturnValue(response);

    await handler({
      params: { schoolId: SCHOOL_ID },
      user: teacher,
      body: {
        attendanceRecords: [
          { date: WEEKDAY, classId: 'A-1', className: 'A Class 1', studentId: 'A-S1', status: 'present' },
          { date: WEEKDAY, classId: 'A-1', className: 'A Class 1', studentId: 'A-S2', status: 'absent' },
        ],
      },
    }, response);

    expect(response.status).toHaveBeenCalledWith(500);
    expect((await schoolService.getTeacherAttendanceTasks(SCHOOL_ID, teacher, WEEKDAY)).tasks[0].status).toBe('pending');
  });

  test('calendar routes restrict writes to School Authority and task reads to teachers', () => {
    const createRoute = route('post', '/:schoolId/calendar');
    const taskRoute = route('get', '/:schoolId/attendance-tasks');
    expect(taskRoute.stack).toHaveLength(4);
    const createGuard = createRoute.stack[2].handle;
    const taskGuard = taskRoute.stack[2].handle;
    const deniedResponse = { status: jest.fn(), json: jest.fn() };
    deniedResponse.status.mockReturnValue(deniedResponse);
    const deniedNext = jest.fn();
    createGuard({ user: teacher }, deniedResponse, deniedNext);
    expect(deniedResponse.status).toHaveBeenCalledWith(403);
    expect(deniedNext).not.toHaveBeenCalled();
    const allowedNext = jest.fn();
    taskGuard({ user: teacher }, deniedResponse, allowedNext);
    expect(allowedNext).toHaveBeenCalledTimes(1);
  });

  test('calendar event creation records a tenant-scoped audit event', async () => {
    const createRoute = route('post', '/:schoolId/calendar');
    const handler = createRoute.stack[createRoute.stack.length - 1].handle;
    const response = { status: jest.fn(), json: jest.fn() };
    response.status.mockReturnValue(response);

    await handler({
      params: { schoolId: SCHOOL_ID },
      user: authority,
      body: { title: 'Audit test closure', type: 'special_closure', startDate: WEEKDAY },
    }, response);

    expect(response.status).toHaveBeenCalledWith(201);
    const auditEvents = await listAuditEvents({ tenantId: SCHOOL_ID, action: 'school.calendar.event_created' });
    expect(auditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tenantId: SCHOOL_ID,
        actorId: authority.userId,
        action: 'school.calendar.event_created',
        resourceType: 'school-calendar-event',
      }),
    ]));
  });

  test('generic school updates cannot bypass calendar validation', async () => {
    const updateRoute = route('put', '/:schoolId');
    const handler = updateRoute.stack[updateRoute.stack.length - 1].handle;
    const response = { status: jest.fn(), json: jest.fn() };
    response.status.mockReturnValue(response);

    await handler({
      params: { schoolId: SCHOOL_ID },
      user: authority,
      body: { events: [{ kind: 'school_calendar', title: 'Unvalidated closure' }] },
    }, response);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'School calendar entries must use the validated calendar endpoints.',
    }));
  });
});
