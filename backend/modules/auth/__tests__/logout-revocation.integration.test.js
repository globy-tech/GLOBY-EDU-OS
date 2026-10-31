const crypto = require('crypto');

const previousAccessSecret = process.env.JWT_ACCESS_SECRET;
const previousQaMode = process.env.GLOBY_QA_MODE;
process.env.JWT_ACCESS_SECRET = crypto.randomBytes(32).toString('hex');
process.env.GLOBY_QA_MODE = 'true';

jest.mock('../../../firebase.data', () => ({ isFirebaseDataConfigured: () => false }));
jest.mock('../../../firebase.core', () => ({
  isFirebaseCoreMode: () => false,
  getMaintenanceMode: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../../config/prisma.client', () => ({ __stub: true }));
jest.mock('../../audit/audit.service', () => ({
  recordAuditEvent: jest.fn().mockResolvedValue(null),
}));

const bcrypt = require('bcrypt');
const express = require('express');
const authRouter = require('../../../routes/auth');
const authMiddleware = require('../middleware/auth.middleware');
const tenantMiddleware = require('../../school/middleware/tenant.middleware');

const SCHOOL_ID = 'logout-qa-school';
const LOGIN_USERNAME = 'authority@logout-qa.test';
let loginPassword;
let server;
let previousSnapshot;
let hadPreviousSnapshot;

function createSchool(passwordHash) {
  return {
    id: SCHOOL_ID,
    schoolId: SCHOOL_ID,
    name: 'Isolated Logout Test School',
    status: 'active',
    schoolStatus: 'active',
    subscriptionStatus: 'active',
    users: [{
      username: LOGIN_USERNAME,
      email: LOGIN_USERNAME,
      fullName: 'QA Authority',
      role: 'school_authority',
      status: 'active',
      emailVerified: true,
      platformAdmin: false,
      passwordHash,
    }],
    teachers: [],
    students: [],
    classes: [],
  };
}

async function login(port) {
  return fetch(`http://127.0.0.1:${port}/api/v1/auth/school-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schoolId: SCHOOL_ID,
      username: LOGIN_USERNAME,
      password: loginPassword,
      loginType: 'school_authority',
    }),
  });
}

async function accessProtectedRoute(port, token) {
  return fetch(`http://127.0.0.1:${port}/api/v1/protected/${SCHOOL_ID}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

beforeAll(async () => {
  hadPreviousSnapshot = Object.prototype.hasOwnProperty.call(global, '__workspaceSnapshot');
  previousSnapshot = global.__workspaceSnapshot;
  loginPassword = crypto.randomBytes(24).toString('base64url');
  global.__workspaceSnapshot = [createSchool(await bcrypt.hash(loginPassword, 4))];

  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', authRouter);
  app.get('/api/v1/protected/:schoolId', authMiddleware, tenantMiddleware, (req, res) => {
    res.json({ status: 'ok' });
  });
  server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
});

afterAll(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (hadPreviousSnapshot) global.__workspaceSnapshot = previousSnapshot;
  else delete global.__workspaceSnapshot;
  if (previousAccessSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
  else process.env.JWT_ACCESS_SECRET = previousAccessSecret;
  if (previousQaMode === undefined) delete process.env.GLOBY_QA_MODE;
  else process.env.GLOBY_QA_MODE = previousQaMode;
});

test('normal login works before logout, revoked access is rejected, and a fresh login works', async () => {
  const port = server.address().port;
  const fixedTime = Date.now();
  const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(fixedTime);
  try {
    const firstLoginResponse = await login(port);
    expect(firstLoginResponse.status).toBe(200);
    const firstLogin = await firstLoginResponse.json();

    const beforeLogout = await accessProtectedRoute(port, firstLogin.accessToken);
    expect(beforeLogout.status).toBe(200);

    const logoutResponse = await fetch(`http://127.0.0.1:${port}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${firstLogin.accessToken}` },
    });
    expect(logoutResponse.status).toBe(200);

    const afterLogout = await accessProtectedRoute(port, firstLogin.accessToken);
    expect(afterLogout.status).toBe(401);

    const freshLoginResponse = await login(port);
    expect(freshLoginResponse.status).toBe(200);
    const freshLogin = await freshLoginResponse.json();
    expect(freshLogin.accessToken === firstLogin.accessToken).toBe(false);
    const afterFreshLogin = await accessProtectedRoute(port, freshLogin.accessToken);
    expect(afterFreshLogin.status).toBe(200);
  } finally {
    nowSpy.mockRestore();
  }
});
