jest.mock('../../../firebase.data', () => ({ isFirebaseDataConfigured: () => false }));
jest.mock('../../../config/prisma.client', () => ({ __stub: true }));
jest.mock('../../../firebase.core', () => ({
  isFirebaseCoreMode: () => false,
  getMaintenanceMode: jest.fn().mockResolvedValue(false),
}));

const useIsolatedSchoolStore = require('./isolated-school-store');
const cleanupIsolatedSchoolStore = useIsolatedSchoolStore();
const authMiddleware = require('../../auth/middleware/auth.middleware');
const schoolRouter = require('../school.controller');

const SCHOOL_ID = 'student-list-qa-school';
const OTHER_SCHOOL_ID = 'student-list-other-school';
const roster = [
  ...Array.from({ length: 8 }, (_, index) => ({
    studentId: `CLASS-A-${index + 1}`,
    fullName: `Assigned Student ${index + 1}`,
    classId: 'class-a',
    className: 'Class A',
    status: 'active',
  })),
  ...Array.from({ length: 24 }, (_, index) => ({
    studentId: `CLASS-B-${index + 1}`,
    fullName: `Other Student ${index + 1}`,
    classId: 'class-b',
    className: 'Class B',
    status: 'active',
  })),
];

function createSchool(schoolId) {
  return {
    id: schoolId,
    schoolId,
    name: 'Isolated Student List Test School',
    status: 'active',
    schoolStatus: 'active',
    subscriptionStatus: 'active',
    users: [],
    teachers: schoolId === SCHOOL_ID
      ? [{ teacherId: 'TEACHER-A', username: 'TEACHER-A', assignedClasses: ['class-a'] }]
      : [],
    students: schoolId === SCHOOL_ID ? roster : [],
    classes: schoolId === SCHOOL_ID
      ? [
        { classId: 'class-a', name: 'Class A', teacherId: 'TEACHER-A' },
        { classId: 'class-b', name: 'Class B', teacherId: 'TEACHER-B' },
      ]
      : [],
  };
}

function studentListHandlers() {
  const layer = schoolRouter.stack.find((entry) => (
    entry.route?.path === '/:schoolId/entities/:entityType' && entry.route.methods.get
  ));
  if (!layer) throw new Error('Student entity-list route not found');
  return layer.route.stack;
}

function createResponse() {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function createRequest(role, requestedSchoolId = SCHOOL_ID, tenantId = SCHOOL_ID) {
  const username = role === 'teacher' ? 'TEACHER-A' : role;
  return {
    params: { schoolId: requestedSchoolId, entityType: 'students' },
    query: {},
    body: {},
    headers: { host: 'localhost' },
    user: {
      userId: `${tenantId}:${username}`,
      username,
      tenantId,
      schoolId: tenantId,
      roles: [role],
      platformAdmin: false,
    },
  };
}

async function dispatchAfterAuthentication(req, res) {
  const handlers = studentListHandlers();
  return handlers[1].handle(req, res, () => (
    handlers[2].handle(req, res, () => handlers[3].handle(req, res))
  ));
}

beforeEach(() => {
  global.__workspaceSnapshot = [createSchool(SCHOOL_ID), createSchool(OTHER_SCHOOL_ID)];
});

afterEach(() => {
  delete global.__workspaceSnapshot;
  jest.restoreAllMocks();
});

afterAll(() => {
  cleanupIsolatedSchoolStore();
});

describe('student entity-list authorization', () => {
  test('the actual entity-list route returns only a teacher’s assigned-class students', async () => {
    const handlers = studentListHandlers();
    expect(handlers[0].handle).toBe(authMiddleware);
    expect(typeof handlers[2].handle).toBe('function');

    const res = createResponse();
    await dispatchAfterAuthentication(createRequest('teacher'), res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      status: 'ok',
      entityType: 'students',
      total: 8,
      items: expect.arrayContaining(Array.from({ length: 8 }, (_, index) => (
        expect.objectContaining({ studentId: `CLASS-A-${index + 1}`, classId: 'class-a' })
      ))),
    }));
    const responseItems = res.json.mock.calls[0][0].items;
    expect(responseItems).toHaveLength(8);
    expect(responseItems.some((student) => student.classId === 'class-b')).toBe(false);
  });

  test('School Authority retains the full roster in its own tenant', async () => {
    const res = createResponse();
    const req = createRequest('school_authority');
    req.query.pageSize = 50;
    await dispatchAfterAuthentication(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      status: 'ok',
      total: 32,
      items: expect.arrayContaining([expect.objectContaining({ studentId: 'CLASS-B-24' })]),
    }));
  });

  test('a Student cannot list the full roster', async () => {
    const res = createResponse();
    await dispatchAfterAuthentication(createRequest('student'), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
  });

  test('rejects a request for another tenant before listing students', async () => {
    const res = createResponse();
    await dispatchAfterAuthentication(createRequest('teacher', OTHER_SCHOOL_ID), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Tenant mismatch' }));
  });

  test('the route authentication middleware rejects an unauthenticated request', async () => {
    const res = createResponse();
    const next = jest.fn();
    await studentListHandlers()[0].handle({ headers: {} }, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
