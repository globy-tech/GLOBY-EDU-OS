jest.mock('../../../config/prisma.client', () => ({
  __stub: false,
  tenant: { findUnique: jest.fn() },
  class: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  user: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  role: { upsert: jest.fn() },
  userRole: { findFirst: jest.fn(), create: jest.fn() },
}));
jest.mock('../../../firebase.core', () => ({
  isFirebaseCoreMode: jest.fn(() => false),
  getMaintenanceMode: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../../firebase.data', () => ({
  isFirebaseDataConfigured: jest.fn(() => false),
}));
const prisma = require('../../../config/prisma.client');
const schoolService = require('../school.service');
const schoolRouter = require('../school.controller');
const tenantMiddleware = require('../middleware/tenant.middleware');

const tenantId = 'db-tenant-roster';
const schoolId = 'school-roster';
let tenantRecord;

function createTeacher(id, teacherId) {
  return {
    id,
    tenantId,
    email: `${teacherId.toLowerCase()}@school.test`,
    firstName: teacherId,
    status: 'active',
    roles: [{ role: { name: 'teacher' } }],
    metadata: { teacherId },
  };
}

function createStudent(id, studentId, classId, className) {
  return {
    id,
    tenantId,
    email: `${studentId.toLowerCase()}@school.test`,
    firstName: studentId,
    status: 'active',
    roles: [{ role: { name: 'student' } }],
    metadata: {
      studentId,
      ...(classId ? { classId } : {}),
      ...(className ? { className } : {}),
    },
  };
}

function teacherActor(id) {
  return { userId: id, roles: ['teacher'], tenantId };
}

async function getTeacherSchoolThroughRoute(actor) {
  const layer = schoolRouter.stack.find((entry) => (
    entry.route?.path === '/:schoolId' && entry.route.methods.get
  ));
  if (!layer) throw new Error('School details route not found');
  const handlers = layer.route.stack;
  const req = {
    headers: { host: 'localhost' },
    params: { schoolId },
    user: actor,
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };

  await handlers[1].handle(req, res, () => handlers[2].handle(req, res));
  return res.json.mock.calls[0]?.[0];
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.__stub = false;
  tenantRecord = {
    id: tenantId,
    schoolId,
    name: 'Prisma Roster Test School',
    status: 'active',
    schoolStatus: 'active',
    subscriptionStatus: 'active',
    users: [
      createTeacher('db-teacher-a', 'T-A'),
      createTeacher('db-teacher-b', 'T-B'),
      createTeacher('db-teacher-c', 'T-C'),
      createTeacher('db-teacher-unassigned', 'T-UNASSIGNED'),
      createStudent('db-student-1', 'STU-1', 'class-a', 'Class A'),
      createStudent('db-student-2', 'STU-2', '', 'Class A'),
      createStudent('db-student-3', 'STU-3', 'class-b', 'Class B'),
    ],
    classes: [
      { id: 'class-a', tenantId, name: 'Class A', status: 'active', teacherIds: [], teacherId: null },
      { id: 'class-b', tenantId, name: 'Class B', status: 'active', teacherIds: [], teacherId: null },
    ],
  };

  prisma.tenant.findUnique.mockImplementation(async ({ where }) => (
    where.schoolId === schoolId || where.id === tenantId ? tenantRecord : null
  ));
  prisma.class.findFirst.mockImplementation(async ({ where }) => (
    tenantRecord.classes.find((entry) => entry.id === where.id && entry.tenantId === where.tenantId) || null
  ));
  prisma.class.findMany.mockImplementation(async ({ where }) => (
    tenantRecord.classes.filter((entry) => entry.tenantId === where.tenantId)
  ));
  prisma.class.update.mockImplementation(async ({ where, data }) => {
    const classRecord = tenantRecord.classes.find((entry) => entry.id === where.id);
    Object.assign(classRecord, data);
    return classRecord;
  });
  prisma.user.findFirst.mockImplementation(async ({ where }) => {
    const identifiers = where.OR || [];
    return tenantRecord.users.find((user) => user.tenantId === where.tenantId && identifiers.some((entry) => (
      (entry.id && entry.id === user.id) || (entry.email && entry.email === user.email)
    ))) || null;
  });
  prisma.user.findMany.mockImplementation(async ({ where }) => {
    const roleName = where.roles.some.role.name;
    return tenantRecord.users.filter((user) => (
      user.tenantId === where.tenantId
      && user.roles.some((entry) => entry.role.name === roleName)
    ));
  });
  prisma.user.update.mockImplementation(async ({ where, data }) => {
    const user = tenantRecord.users.find((entry) => entry.id === where.id);
    Object.assign(user, data);
    return user;
  });
  prisma.role.upsert.mockResolvedValue({ id: 'role-student', name: 'student' });
  prisma.userRole.findFirst.mockResolvedValue({ id: 'user-role-link' });
});

test('Prisma class assignments persist for multiple teachers and fresh roster reads', async () => {
  const authority = { roles: ['school_authority'], tenantId };
  const firstAssignment = await schoolService.updateEntity(schoolId, 'classes', 'class-a', {
    teacherIds: ['T-A', 'T-B'],
  }, authority);
  const secondAssignment = await schoolService.updateEntity(schoolId, 'classes', 'class-b', {
    teacherIds: ['T-C'],
  }, authority);

  const savedClass = tenantRecord.classes.find((entry) => entry.id === 'class-a');
  expect(firstAssignment.teacherIds).toEqual(['T-A', 'T-B']);
  expect(secondAssignment.teacherIds).toEqual(['T-C']);
  expect(savedClass.teacherIds).toEqual(['T-A', 'T-B']);
  expect(savedClass.teacherId).toBe('T-A');

  const firstTeacherView = (await getTeacherSchoolThroughRoute(teacherActor('db-teacher-a'))).school;
  const secondTeacherView = (await getTeacherSchoolThroughRoute(teacherActor('db-teacher-b'))).school;
  const otherClassTeacherView = (await getTeacherSchoolThroughRoute(teacherActor('db-teacher-c'))).school;
  const unassignedTeacherView = (await getTeacherSchoolThroughRoute(teacherActor('db-teacher-unassigned'))).school;

  expect(firstTeacherView.classes.map((entry) => entry.id)).toEqual(['class-a']);
  expect(firstTeacherView.students.map((entry) => entry.studentId)).toEqual(['STU-1', 'STU-2']);
  expect(secondTeacherView.classes.map((entry) => entry.id)).toEqual(['class-a']);
  expect(secondTeacherView.students.map((entry) => entry.studentId)).toEqual(['STU-1', 'STU-2']);
  expect(otherClassTeacherView.classes.map((entry) => entry.id)).toEqual(['class-b']);
  expect(otherClassTeacherView.students.map((entry) => entry.studentId)).toEqual(['STU-3']);
  expect(unassignedTeacherView.classes).toEqual([]);
  expect(unassignedTeacherView.students).toEqual([]);

  tenantRecord.users.push(createStudent('db-student-4', 'STU-4', 'class-a', 'Class A'));
  const afterStudentAddition = (await getTeacherSchoolThroughRoute(teacherActor('db-teacher-a'))).school;
  expect(afterStudentAddition.students.map((entry) => entry.studentId)).toContain('STU-4');

  await schoolService.updateEntity(schoolId, 'students', 'stu-1@school.test', {
    classId: 'class-b',
    className: 'Class B',
  }, authority);
  const afterClassChange = (await getTeacherSchoolThroughRoute(teacherActor('db-teacher-a'))).school;
  const classBAfterChange = (await getTeacherSchoolThroughRoute(teacherActor('db-teacher-c'))).school;
  expect(afterClassChange.students.map((entry) => entry.studentId)).not.toContain('STU-1');
  expect(classBAfterChange.students.map((entry) => entry.studentId)).toContain('STU-1');
});

test('Prisma tenant middleware rejects another school before a class roster request', async () => {
  prisma.tenant.findUnique.mockResolvedValue({ id: 'db-other-tenant', schoolId: 'school-other' });
  const req = {
    headers: { host: 'localhost' },
    params: { schoolId: 'school-other' },
    user: { userId: 'db-teacher-a', tenantId, roles: ['teacher'] },
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const next = jest.fn();

  await tenantMiddleware(req, res, next);

  expect(res.status).toHaveBeenCalledWith(403);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Tenant mismatch' }));
  expect(next).not.toHaveBeenCalled();
});
