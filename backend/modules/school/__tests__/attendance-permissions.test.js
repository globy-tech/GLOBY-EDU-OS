jest.mock('../../../firebase.data', () => ({ isFirebaseDataConfigured: () => false }));
jest.mock('../../../config/prisma.client', () => ({ __stub: true }));

const useIsolatedSchoolStore = require('./isolated-school-store');
const cleanupIsolatedSchoolStore = useIsolatedSchoolStore();
const schoolService = require('../school.service');
const schoolRouter = require('../school.controller');
const tenantMiddleware = require('../middleware/tenant.middleware');

const SCHOOL_ID = 'attendance-school-a';
const OTHER_SCHOOL_ID = 'attendance-school-b';

function createSchool() {
  return {
    id: 'attendance-tenant-a',
    schoolId: SCHOOL_ID,
    name: 'Attendance Test School',
    status: 'active',
    schoolStatus: 'active',
    subscriptionStatus: 'trial',
    users: [],
    teachers: [{ teacherId: 'T-A', username: 'T-A', fullName: 'Teacher A', assignedClasses: ['class-a'] }],
    students: [{ studentId: 'STU-A', username: 'STU-A', fullName: 'Student A', classId: 'class-a', className: 'Class A' }],
    classes: [{ classId: 'class-a', name: 'Class A', teacherId: 'T-A' }],
    attendanceRecords: [{ studentId: 'STU-A', className: 'Class A', date: '2026-10-19', status: 'absent' }],
  };
}

function routeHandler() {
  const layer = schoolRouter.stack.find((entry) => entry.route?.path === '/:schoolId' && entry.route.methods.put);
  if (!layer) throw new Error('Generic school update route not found');
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function summaryRoute() {
  const layer = schoolRouter.stack.find((entry) => entry.route?.path === '/:schoolId/summary' && entry.route.methods.get);
  if (!layer) throw new Error('School summary route not found');
  return layer.route;
}

function response() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function request(role, body, schoolId = SCHOOL_ID) {
  return {
    params: { schoolId },
    body,
    user: {
      userId: `${schoolId}:${role === 'teacher' ? 'T-A' : role}`,
      tenantId: schoolId,
      schoolId,
      roles: [role],
      platformAdmin: false,
    },
    headers: {},
    ip: '127.0.0.1',
    get: () => 'attendance-test-agent',
  };
}

beforeEach(() => {
  global.__workspaceSnapshot = [createSchool(), {
    id: 'attendance-tenant-b',
    schoolId: OTHER_SCHOOL_ID,
    status: 'active',
    schoolStatus: 'active',
    subscriptionStatus: 'trial',
  }];
});

afterEach(() => {
  delete global.__workspaceSnapshot;
  jest.restoreAllMocks();
});

afterAll(() => {
  cleanupIsolatedSchoolStore();
});

describe('attendance role permissions', () => {
  test.each(['student', 'teacher'])('%s cannot read the school-wide dashboard summary', async (role) => {
    const handlers = summaryRoute().stack;
    const req = request(role, {});
    const res = response();
    const next = jest.fn();

    await handlers[1].handle(req, res, () => handlers[2].handle(req, res, next));

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('school authorities can pass the dashboard summary role check', async () => {
    const handlers = summaryRoute().stack;
    const req = request('school_authority', {});
    const res = response();
    const next = jest.fn();

    await handlers[1].handle(req, res, () => handlers[2].handle(req, res, next));

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test.each(['school_authority', 'school_head'])('%s cannot write attendance through generic updates', async (role) => {
    const updateSchool = jest.spyOn(schoolService, 'updateSchool');
    const res = response();

    await routeHandler()(request(role, {
      attendanceRecords: [{ studentId: 'STU-A', className: 'Class A', status: 'present' }],
    }), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Attendance can only be recorded by authorized teachers.',
    }));
    expect(updateSchool).not.toHaveBeenCalled();
  });

  test.each([
    ['schoolStatus', 'suspended'],
    ['users', []],
    ['teachers', []],
    ['students', []],
    ['classes', []],
    ['invoices', []],
    ['refunds', []],
  ])('school authorities cannot update protected %s through the generic route', async (field, value) => {
    const updateSchool = jest.spyOn(schoolService, 'updateSchool');
    const res = response();

    await routeHandler()(request('school_authority', { [field]: value }), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(updateSchool).not.toHaveBeenCalled();
  });

  test('school authorities can update allowed school profile fields', async () => {
    const school = createSchool();
    jest.spyOn(schoolService, 'getSchoolBySchoolId').mockResolvedValue(school);
    const updateSchool = jest.spyOn(schoolService, 'updateSchool').mockResolvedValue({
      ...school,
      name: 'Updated Attendance Test School',
    });
    const res = response();

    await routeHandler()(request('school_authority', { name: 'Updated Attendance Test School' }), res);

    expect(updateSchool).toHaveBeenCalledWith(school.id, { name: 'Updated Attendance Test School' });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'ok' }));
  });

  test('authorized teachers can persist attendance for their assigned student and class', async () => {
    const school = createSchool();
    jest.spyOn(schoolService, 'getSchoolBySchoolId').mockResolvedValue(school);
    const updateSchool = jest.spyOn(schoolService, 'updateSchool').mockImplementation(async (id, updates) => ({ ...school, ...updates }));
    const res = response();

    await routeHandler()(request('teacher', {
      attendanceRecords: [{ studentId: 'STU-A', className: 'Class A', date: '2026-10-20', status: 'present' }],
    }), res);

    expect(updateSchool).toHaveBeenCalledWith('attendance-tenant-a', expect.objectContaining({
      attendanceRecords: expect.arrayContaining([
        expect.objectContaining({ studentId: 'STU-A', className: 'Class A', date: '2026-10-20', status: 'present' }),
      ]),
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'ok' }));
  });

  test('ignores invalid student/class attendance rows without changing existing records', () => {
    const school = createSchool();
    const teacher = { userId: `${SCHOOL_ID}:T-A`, username: 'T-A', tenantId: SCHOOL_ID, roles: ['teacher'] };

    const updated = schoolService.updateTeacherWorkspace(school, teacher, {
      attendanceRecords: [
        { studentId: 'STU-OTHER', className: 'Class A', date: '2026-10-20', status: 'present' },
        { studentId: 'STU-A', className: 'Class B', date: '2026-10-20', status: 'present' },
      ],
    });

    expect(updated.attendanceRecords).toEqual([
      { studentId: 'STU-A', className: 'Class A', date: '2026-10-19', status: 'absent' },
    ]);
  });

  test('requires attendance and exam results to match the assigned student class and subject', () => {
    const school = createSchool();
    school.classes.push({ classId: 'class-b', name: 'Class B', teacherId: 'T-A' });
    school.teachers[0].assignedClasses = ['class-a', 'class-b'];
    school.teachers[0].assignedSubjects = ['Math'];
    school.students.push({
      studentId: 'STU-B',
      username: 'STU-B',
      fullName: 'Student B',
      classId: 'class-b',
      className: 'Class B',
    });
    const teacher = { userId: `${SCHOOL_ID}:T-A`, username: 'T-A', tenantId: SCHOOL_ID, roles: ['teacher'] };

    const updated = schoolService.updateTeacherWorkspace(school, teacher, {
      attendanceRecords: [
        { studentId: 'STU-A', className: 'Class B', date: '2026-10-20', status: 'present' },
        { studentId: 'STU-A', className: 'Class A', date: '2026-10-20', status: 'present' },
      ],
      examResults: [
        { studentId: 'STU-A', className: 'Class A', subject: 'Math', exam: 'Midterm', score: 80 },
        { studentId: 'STU-A', className: 'Class A', subject: 'Science', exam: 'Midterm', score: 90 },
      ],
    });

    expect(updated.attendanceRecords).toContainEqual(expect.objectContaining({
      studentId: 'STU-A',
      className: 'Class A',
      date: '2026-10-20',
    }));
    expect(updated.attendanceRecords).not.toContainEqual(expect.objectContaining({
      studentId: 'STU-A',
      className: 'Class B',
      date: '2026-10-20',
    }));
    expect(updated.examResults).toEqual([
      expect.objectContaining({ studentId: 'STU-A', className: 'Class A', subject: 'Math' }),
    ]);
  });

  test('does not persist attendance rows outside the teacher assignment', async () => {
    const school = createSchool();
    jest.spyOn(schoolService, 'getSchoolBySchoolId').mockResolvedValue(school);
    const updateSchool = jest.spyOn(schoolService, 'updateSchool').mockImplementation(async (id, updates) => ({ ...school, ...updates }));
    const res = response();

    await routeHandler()(request('teacher', {
      attendanceRecords: [
        { studentId: 'STU-OTHER', className: 'Class A', date: '2026-10-20', status: 'present' },
        { studentId: 'STU-A', className: 'Class B', date: '2026-10-20', status: 'present' },
      ],
    }), res);

    expect(updateSchool).toHaveBeenCalledWith('attendance-tenant-a', expect.objectContaining({
      attendanceRecords: [{ studentId: 'STU-A', className: 'Class A', date: '2026-10-19', status: 'absent' }],
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'ok' }));
  });

  test.each(['school_authority', 'school_head', 'teacher'])('%s cannot target another school', async (role) => {
    const req = request(role, {}, OTHER_SCHOOL_ID);
    req.user.tenantId = SCHOOL_ID;
    req.user.schoolId = SCHOOL_ID;
    req.headers = { host: 'localhost' };
    const res = response();
    const next = jest.fn();

    await tenantMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Tenant mismatch' }));
    expect(next).not.toHaveBeenCalled();
  });
});

describe('student account deletion workflow', () => {
  const teacher = {
    userId: `${SCHOOL_ID}:T-A`,
    username: 'T-A',
    tenantId: SCHOOL_ID,
    schoolId: SCHOOL_ID,
    roles: ['teacher'],
  };
  const authority = {
    userId: `${SCHOOL_ID}:AUTH-A`,
    username: 'AUTH-A',
    tenantId: SCHOOL_ID,
    schoolId: SCHOOL_ID,
    roles: ['school_authority'],
  };

  test('assigned teachers can request deletion but cannot permanently delete students', async () => {
    await expect(schoolService.deleteEntity(SCHOOL_ID, 'students', 'STU-A', teacher, {
      confirmation: 'STU-A',
    })).rejects.toThrow('Only School Authority can manage account deletion.');

    const result = await schoolService.requestStudentDeletion(SCHOOL_ID, 'STU-A', 'Duplicate record', teacher);

    expect(result.deletionRequest).toEqual(expect.objectContaining({
      status: 'pending',
      reason: 'Duplicate record',
    }));
    expect(global.__workspaceSnapshot[0].students[0].metadata.deletionRequest.status).toBe('pending');
  });

  test('teachers cannot request deletion outside their tenant or assigned class', async () => {
    await expect(schoolService.requestStudentDeletion(OTHER_SCHOOL_ID, 'STU-A', '', teacher))
      .rejects.toThrow('Tenant mismatch');

    global.__workspaceSnapshot[0].students[0].classId = 'class-b';
    global.__workspaceSnapshot[0].students[0].className = 'Unassigned Class';
    await expect(schoolService.requestStudentDeletion(SCHOOL_ID, 'STU-A', '', teacher))
      .rejects.toThrow('Teacher is not authorized for this student');
  });

  test('authority can reject a request or approve it only with student-ID confirmation', async () => {
    await schoolService.requestStudentDeletion(SCHOOL_ID, 'STU-A', '', teacher);
    await expect(schoolService.resolveStudentDeletionRequest(
      SCHOOL_ID,
      'STU-A',
      'approved',
      'wrong-id',
      authority,
    )).rejects.toThrow('Type the student ID to confirm permanent deletion.');

    const result = await schoolService.resolveStudentDeletionRequest(
      SCHOOL_ID,
      'STU-A',
      'rejected',
      '',
      authority,
    );
    expect(result.status).toBe('rejected');
    expect(global.__workspaceSnapshot[0].students[0].metadata.deletionRequest.status).toBe('rejected');
  });

  test('approval permanently removes the student record and associated local account', async () => {
    const school = global.__workspaceSnapshot[0];
    school.users.push({ username: 'STU-A', studentId: 'STU-A', role: 'student', status: 'active' });
    await schoolService.requestStudentDeletion(SCHOOL_ID, 'STU-A', '', teacher);

    const result = await schoolService.resolveStudentDeletionRequest(
      SCHOOL_ID,
      'STU-A',
      'approved',
      'STU-A',
      authority,
    );

    expect(result.status).toBe('approved');
    expect(school.students).toHaveLength(0);
    expect(school.users).toHaveLength(0);
  });

  test('authority archive and restore status is synchronized to the student login record', async () => {
    const school = global.__workspaceSnapshot[0];
    school.users.push({ username: 'STU-A', studentId: 'STU-A', role: 'student', status: 'active' });

    await schoolService.updateEntity(SCHOOL_ID, 'students', 'STU-A', { status: 'archived' }, authority);
    expect(school.students[0].status).toBe('archived');
    expect(school.users[0].status).toBe('archived');

    await schoolService.updateEntity(SCHOOL_ID, 'students', 'STU-A', { status: 'active' }, authority);
    expect(school.students[0].status).toBe('active');
    expect(school.users[0].status).toBe('active');
  });
});
