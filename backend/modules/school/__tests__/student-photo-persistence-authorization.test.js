jest.mock('../../../config/prisma.client', () => ({
  __stub: false,
  tenant: { findUnique: jest.fn() },
  user: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  role: { upsert: jest.fn() },
  userRole: { findFirst: jest.fn(), create: jest.fn() },
}));
jest.mock('../../../firebase.data', () => ({
  isFirebaseDataConfigured: jest.fn(() => false),
}));
jest.mock('../../../firebase.core', () => ({
  isFirebaseCoreMode: jest.fn(() => false),
  getSchoolAggregate: jest.fn(),
  getMaintenanceMode: jest.fn().mockResolvedValue(false),
}));

const prisma = require('../../../config/prisma.client');
const firebaseData = require('../../../firebase.data');
const firebaseCore = require('../../../firebase.core');
const schoolService = require('../school.service');
const tenantMiddleware = require('../middleware/tenant.middleware');

const tenant = { id: 'db-tenant-own', schoolId: 'school-own' };
const students = [
  {
    id: 'db-user-uuid-own',
    tenantId: tenant.id,
    email: 'own@student.test',
    status: 'active',
    firstName: 'Own',
    lastName: 'Student',
    metadata: { studentId: 'STD-OWN' },
  },
  {
    id: 'db-user-uuid-peer',
    tenantId: tenant.id,
    email: 'peer@student.test',
    status: 'active',
    firstName: 'Peer',
    lastName: 'Student',
    metadata: { studentId: 'STD-PEER' },
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  prisma.__stub = false;
  prisma.tenant.findUnique.mockResolvedValue(tenant);
  prisma.user.findFirst.mockImplementation(async ({ where }) => {
    const identifiers = where.OR || [];
    return students.find((student) => student.tenantId === where.tenantId && identifiers.some((entry) => (
      (entry.id && entry.id === student.id) || (entry.email && entry.email === student.email)
    ))) || null;
  });
  prisma.user.findMany.mockImplementation(async ({ where }) => (
    where.roles.some.role.name === 'student' ? students : []
  ));
  prisma.user.update.mockImplementation(async ({ where, data }) => ({
    ...students.find((student) => student.id === where.id),
    ...data,
  }));
  prisma.role.upsert.mockResolvedValue({ id: 'role-student', name: 'student' });
  prisma.userRole.findFirst.mockResolvedValue({ id: 'student-role-link' });
});

test.each([
  ['database UUID', 'db-user-uuid-own'],
  ['student ID', 'STD-OWN'],
  ['email', 'own@student.test'],
])('Prisma student ownership accepts the trusted %s identity and rejects a peer', async (_label, userId) => {
  const actor = { userId, roles: ['student'], tenantId: tenant.id };

  await expect(schoolService.updateEntity(
    tenant.schoolId,
    'students',
    'STD-OWN',
    { profilePhoto: 'https://images.example.test/own.png' },
    actor,
  )).resolves.toEqual(expect.objectContaining({ studentId: 'STD-OWN' }));
  await expect(schoolService.updateEntity(
    tenant.schoolId,
    'students',
    'STD-PEER',
    { profilePhoto: 'https://images.example.test/peer.png' },
    actor,
  )).rejects.toThrow('Students can only update their own profile.');

  expect(prisma.user.update).toHaveBeenCalledTimes(1);
});

test('Prisma tenant middleware rejects a student request for another school', async () => {
  prisma.tenant.findUnique.mockResolvedValue({ id: 'db-tenant-other', schoolId: 'school-other' });
  const req = {
    headers: { host: 'localhost' },
    params: { schoolId: 'school-other' },
    user: { userId: 'db-user-uuid-own', tenantId: tenant.id, roles: ['student'] },
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

test('Firebase tenant middleware rejects a student request for another school', async () => {
  firebaseData.isFirebaseDataConfigured.mockReturnValue(true);
  firebaseCore.getSchoolAggregate.mockResolvedValue({ schoolId: 'school-other', students: [] });
  const req = {
    headers: { host: 'localhost' },
    params: { schoolId: 'school-other' },
    user: { userId: 'db-user-uuid-own', tenantId: 'school-own', roles: ['student'] },
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
