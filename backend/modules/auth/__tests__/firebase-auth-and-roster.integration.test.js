const crypto = require('crypto');

const mockState = {
  collections: new Map(),
  idTokens: new Map(),
  claims: new Map(),
};

function collectionRecords(name) {
  if (!mockState.collections.has(name)) mockState.collections.set(name, new Map());
  return mockState.collections.get(name);
}

function documentReference(collection, id) {
  const reference = { collection, id: String(id) };
  reference.get = async () => snapshot(reference, collectionRecords(collection).get(reference.id));
  reference.set = async (data, options = {}) => {
    const records = collectionRecords(collection);
    const current = records.get(reference.id);
    records.set(reference.id, options.merge === false ? structuredClone(data) : { ...(current || {}), ...structuredClone(data) });
  };
  return reference;
}

function snapshot(reference, record) {
  return {
    exists: record !== undefined,
    id: reference.id,
    data: () => (record === undefined ? undefined : structuredClone(record)),
  };
}

const mockFirestore = {
  collection(name) {
    return {
      doc(id) {
        return documentReference(name, id);
      },
      where(field, operator, value) {
        let limit = Infinity;
        const query = {
          limit(value) {
            limit = value;
            return query;
          },
          async get() {
            const docs = Array.from(collectionRecords(name).entries())
              .filter(([, record]) => operator === '==' && record[field] === value)
              .slice(0, limit)
              .map(([id, record]) => ({ id, data: () => structuredClone(record) }));
            return { docs, empty: docs.length === 0 };
          },
        };
        return query;
      },
    };
  },
  async runTransaction(callback) {
    const writes = [];
    const transaction = {
      get: async (reference) => snapshot(reference, collectionRecords(reference.collection).get(reference.id)),
      create: (reference, data) => writes.push({ type: 'create', reference, data }),
      update: (reference, data) => writes.push({ type: 'update', reference, data }),
    };
    const result = await callback(transaction);
    for (const write of writes) {
      const records = collectionRecords(write.reference.collection);
      const current = records.get(write.reference.id);
      if (write.type === 'create' && current !== undefined) throw new Error('Document already exists');
      records.set(write.reference.id, { ...(current || {}), ...structuredClone(write.data) });
    }
    return result;
  },
};

const previousAccessSecret = process.env.JWT_ACCESS_SECRET;
const previousRefreshSecret = process.env.JWT_REFRESH_SECRET;
process.env.JWT_ACCESS_SECRET = crypto.randomBytes(32).toString('hex');
process.env.JWT_REFRESH_SECRET = crypto.randomBytes(32).toString('hex');

jest.mock('../../../firebase.data', () => ({
  isFirebaseDataConfigured: () => true,
  getFirestore: () => mockFirestore,
}));
jest.mock('../../../firebase.admin', () => ({
  isFirebaseConfigured: () => true,
  verifyIdToken: jest.fn(async (token) => mockState.idTokens.get(token)),
  getUser: jest.fn(async (uid) => ({
    uid,
    email: Array.from(mockState.idTokens.values()).find((record) => record.uid === uid)?.email,
    emailVerified: true,
    disabled: false,
    customClaims: mockState.claims.get(uid) || {},
  })),
  setCustomUserClaims: jest.fn(async (uid, claims) => mockState.claims.set(uid, claims)),
}));
jest.mock('../../../config/prisma.client', () => null);
jest.mock('../../audit/audit.service', () => ({
  recordAuditEvent: jest.fn().mockResolvedValue(null),
}));

const express = require('express');
const authRouter = require('../auth.controller');
const schoolRouter = require('../../school/school.controller');
const authMiddleware = require('../middleware/auth.middleware');

const SCHOOL_ID = 'release-school-a';
const OTHER_SCHOOL_ID = 'release-school-b';
const accounts = [
  { role: 'teacher', id: 'release-teacher', uid: 'release-uid-teacher', identifier: 'teacher-a@example.test' },
  { role: 'school_authority', id: 'release-authority', uid: 'release-uid-authority', identifier: 'authority-a@example.test' },
  { role: 'student', id: 'release-student', uid: 'release-uid-student', identifier: 'student-a@example.test' },
];
let server;

function seedFixture() {
  mockState.collections.clear();
  mockState.claims.clear();
  mockState.idTokens.clear();

  collectionRecords('tenants').set(SCHOOL_ID, {
    schoolId: SCHOOL_ID,
    status: 'active',
    schoolStatus: 'active',
    subscriptionStatus: 'active',
  });
  collectionRecords('tenants').set(OTHER_SCHOOL_ID, {
    schoolId: OTHER_SCHOOL_ID,
    status: 'active',
    schoolStatus: 'active',
    subscriptionStatus: 'active',
  });
  collectionRecords('classes').set(`${SCHOOL_ID}:class-a`, {
    schoolId: SCHOOL_ID,
    classId: 'class-a',
    name: 'Class A',
    teacherId: 'T-A',
  });
  collectionRecords('classes').set(`${SCHOOL_ID}:class-b`, {
    schoolId: SCHOOL_ID,
    classId: 'class-b',
    name: 'Class B',
    teacherId: 'T-B',
  });
  collectionRecords('teachers').set(`${SCHOOL_ID}:teacher-a`, {
    schoolId: SCHOOL_ID,
    teacherId: 'T-A',
    username: 'teacher-a@example.test',
    email: 'teacher-a@example.test',
    userId: 'release-teacher',
    firebaseUid: 'release-uid-teacher',
    assignedClasses: ['class-a'],
    status: 'active',
    isVerified: true,
    emailVerified: true,
    invitationStatus: 'activated',
  });
  collectionRecords('teachers').set(`${SCHOOL_ID}:teacher-b`, {
    schoolId: SCHOOL_ID,
    teacherId: 'T-B',
    username: 'teacher-b@example.test',
    userId: 'other-teacher',
    assignedClasses: ['class-b'],
    status: 'active',
  });
  for (const [classId, count] of [['class-a', 8], ['class-b', 24]]) {
    for (let index = 1; index <= count; index += 1) {
      const studentId = `${classId.toUpperCase()}-${index}`;
      collectionRecords('students').set(`${SCHOOL_ID}:${studentId}`, {
        schoolId: SCHOOL_ID,
        studentId,
        fullName: studentId,
        classId,
        className: classId === 'class-a' ? 'Class A' : 'Class B',
        status: 'active',
      });
    }
  }

  for (const account of accounts) {
    const record = {
      id: account.id,
      email: account.identifier,
      username: account.identifier,
      teacherId: account.role === 'teacher' ? 'T-A' : undefined,
      studentId: account.role === 'student' ? 'STUDENT-A' : undefined,
      schoolId: SCHOOL_ID,
      tenantId: SCHOOL_ID,
      firebaseUid: account.uid,
      role: account.role,
      roles: [account.role],
      status: 'active',
      isVerified: true,
      platformAdmin: false,
      passwordNeedsReset: false,
      invitationStatus: account.role === 'teacher' ? 'activated' : undefined,
    };
    collectionRecords('users').set(account.id, record);
    mockState.idTokens.set(`firebase-${account.role}`, {
      uid: account.uid,
      email: account.identifier,
      email_verified: true,
    });
    mockState.claims.set(account.uid, {
      role: account.role,
      roles: [account.role],
      tenantId: SCHOOL_ID,
      schoolId: SCHOOL_ID,
      platformAdmin: false,
    });
  }
}

async function login(port, account, schoolId = SCHOOL_ID) {
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/auth/firebase-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idToken: `firebase-${account.role}`,
      schoolId,
      identifier: account.identifier,
      loginType: account.role,
    }),
  });
  return { response, body: await response.json() };
}

async function listStudents(port, token, schoolId = SCHOOL_ID, pageSize = 50) {
  return fetch(`http://127.0.0.1:${port}/api/v1/schools/${schoolId}/entities/students?pageSize=${pageSize}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/schools', schoolRouter);
  app.get('/api/v1/private', authMiddleware, (req, res) => res.json({ status: 'ok' }));
  server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
});

beforeEach(() => seedFixture());

afterAll(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (previousAccessSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
  else process.env.JWT_ACCESS_SECRET = previousAccessSecret;
  if (previousRefreshSecret === undefined) delete process.env.JWT_REFRESH_SECRET;
  else process.env.JWT_REFRESH_SECRET = previousRefreshSecret;
});

test('Firebase school routes enforce roster role and tenant boundaries', async () => {
  const port = server.address().port;
  const teacherLogin = await login(port, accounts[0]);
  expect(teacherLogin.response.status).toBe(200);
  const teacherRoster = await listStudents(port, teacherLogin.body.accessToken);
  const teacherRosterBody = await teacherRoster.json();
  expect(teacherRoster.status).toBe(200);
  expect(teacherRosterBody.total).toBe(8);
  expect(teacherRosterBody.items.every((student) => student.classId === 'class-a')).toBe(true);

  const authorityLogin = await login(port, accounts[1]);
  expect(authorityLogin.response.status).toBe(200);
  const authorityRoster = await listStudents(port, authorityLogin.body.accessToken);
  const authorityRosterBody = await authorityRoster.json();
  expect(authorityRoster.status).toBe(200);
  expect(authorityRosterBody.total).toBe(32);

  const studentLogin = await login(port, accounts[2]);
  expect(studentLogin.response.status).toBe(200);
  const studentRoster = await listStudents(port, studentLogin.body.accessToken);
  expect(studentRoster.status).toBe(403);

  const crossTenantRoster = await listStudents(port, teacherLogin.body.accessToken, OTHER_SCHOOL_ID);
  expect(crossTenantRoster.status).toBe(403);

  const unauthenticatedRoster = await listStudents(port, null);
  expect(unauthenticatedRoster.status).toBe(401);
});

test('teacher login with another valid School ID returns a generic authentication error', async () => {
  const { response, body } = await login(server.address().port, accounts[0], OTHER_SCHOOL_ID);

  expect(response.status).toBe(401);
  expect(body).toEqual({ status: 'error', message: 'Unable to sign in. Please check your details.' });
});

test('Firebase logout revokes the old Firestore-backed access session and a new login works', async () => {
  const port = server.address().port;
  const firstLogin = await login(port, accounts[0]);
  expect(firstLogin.response.status).toBe(200);
  const firstToken = firstLogin.body.accessToken;
  const firstCookie = firstLogin.response.headers.get('set-cookie')?.split(';')[0];
  expect(firstCookie).toMatch(/^globyedu_refresh_token=/);

  const beforeLogout = await fetch(`http://127.0.0.1:${port}/api/v1/private`, {
    headers: { Authorization: `Bearer ${firstToken}` },
  });
  expect(beforeLogout.status).toBe(200);
  const oldSessionId = collectionRecords('users').get(accounts[0].id).activeSessionIds[0];
  expect(collectionRecords('authSessions').get(oldSessionId).revoked).toBe(false);

  const logout = await fetch(`http://127.0.0.1:${port}/api/v1/auth/logout`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${firstToken}`,
      Cookie: firstCookie,
    },
  });
  expect(logout.status).toBe(200);
  expect(collectionRecords('authSessions').get(oldSessionId).revoked).toBe(true);

  const afterLogout = await fetch(`http://127.0.0.1:${port}/api/v1/private`, {
    headers: { Authorization: `Bearer ${firstToken}` },
  });
  expect(afterLogout.status).toBe(401);

  const secondLogin = await login(port, accounts[0]);
  expect(secondLogin.response.status).toBe(200);
  expect(secondLogin.body.accessToken).not.toBe(firstToken);
  const afterFreshLogin = await fetch(`http://127.0.0.1:${port}/api/v1/private`, {
    headers: { Authorization: `Bearer ${secondLogin.body.accessToken}` },
  });
  expect(afterFreshLogin.status).toBe(200);
});
