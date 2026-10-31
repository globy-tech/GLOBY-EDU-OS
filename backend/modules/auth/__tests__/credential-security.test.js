jest.mock('../../audit/audit.service', () => ({
  recordAuditEvent: jest.fn().mockResolvedValue(null),
  listAuditEvents: jest.fn().mockResolvedValue([]),
}));

const express = require('express');
const jwt = require('jsonwebtoken');
const authRouter = require('../../../routes/auth');
const platformAdminService = require('../../platform-admin/platform-admin.service');
const config = require('../../../config/auth.config');
const { loadSchoolData, saveSchoolData } = require('../../school/fallback.school');

function createTestServer() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', authRouter);
  app.get('/api/v1/protected/:schoolId', require('../middleware/auth.middleware'), require('../../school/middleware/tenant.middleware'), (req, res) => {
    res.json({ status: 'ok' });
  });
  return app.listen(0);
}

describe('credential security', () => {
  let server;
  let previousSnapshot;
  let hadPreviousSnapshot;

  beforeAll(() => {
    hadPreviousSnapshot = Object.prototype.hasOwnProperty.call(global, '__workspaceSnapshot');
    previousSnapshot = global.__workspaceSnapshot;
    global.__workspaceSnapshot = JSON.parse(JSON.stringify(loadSchoolData()));
    server = createTestServer();
  });

  afterAll(async () => {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    if (hadPreviousSnapshot) global.__workspaceSnapshot = previousSnapshot;
    else delete global.__workspaceSnapshot;
  });

  test('issues signed tokens and blocks temporary-password users from protected routes', async () => {
    const port = server.address().port;
    const loginResponse = await fetch(`http://127.0.0.1:${port}/api/v1/auth/school-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schoolId: 'globy-school',
        username: 'STU001',
        password: 'GlobyStudent@123',
        loginType: 'student',
      }),
    });
    const login = await loginResponse.json();

    expect(loginResponse.status).toBe(200);
    expect(login.accessToken).not.toMatch(/^mock-jwt-/);
    expect(jwt.verify(login.accessToken, config.jwt.accessTokenSecret).passwordNeedsReset).toBe(true);

    const protectedResponse = await fetch(`http://127.0.0.1:${port}/api/v1/protected/globy-school`, {
      headers: { Authorization: `Bearer ${login.accessToken}` },
    });
    const protectedBody = await protectedResponse.json();
    expect(protectedResponse.status).toBe(403);
    expect(protectedBody.code).toBe('PASSWORD_CHANGE_REQUIRED');
  }, 20000);

  test('rate limits repeated failures without revealing account state', async () => {
    const port = server.address().port;
    let response;
    for (let attempt = 0; attempt < 9; attempt += 1) {
      response = await fetch(`http://127.0.0.1:${port}/api/v1/auth/platform-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'unknown-security-test@example.com', password: 'WrongPassword!' }),
      });
    }
    const body = await response.json();
    expect(response.status).toBe(429);
    expect(body.message).toMatch(/too many failed/i);
  }, 30000);

  test('blocks school logins when the tenant has been suspended', async () => {
    const port = server.address().port;
    const schools = loadSchoolData();
    const target = schools.find((school) => school.schoolId === 'globy-school') || schools[0];
    expect(target).toBeTruthy();

    const previousStatus = target.schoolStatus;
    const previousSubscription = target.subscriptionStatus;
    target.schoolStatus = 'suspended';
    target.subscriptionStatus = 'suspended';
    saveSchoolData(schools);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/auth/school-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schoolId: 'globy-school',
          username: 'authority@globyedu.test',
          password: 'GlobySchool@123',
          loginType: 'school_authority',
        }),
      });
      const body = await response.json();
      expect(response.status).toBe(403);
      expect(body.message).toMatch(/check your details|suspended|expired/i);
    } finally {
      target.schoolStatus = previousStatus || 'active';
      target.subscriptionStatus = previousSubscription || 'active';
      saveSchoolData(schools);
    }
  });

  test('rejects an already-issued token when the account is suspended', async () => {
    const port = server.address().port;
    const schools = loadSchoolData();
    const targetSchool = schools.find((school) => school.schoolId === 'globy-school') || schools[0];
    const authority = (targetSchool.users || []).find((user) => user.username === 'authority@globyedu.test');
    expect(authority).toBeTruthy();

    const previousStatus = authority.status;
    authority.status = 'active';
    saveSchoolData(schools);

    const loginResponse = await fetch(`http://127.0.0.1:${port}/api/v1/auth/school-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schoolId: 'globy-school',
        username: 'authority@globyedu.test',
        password: 'GlobySchool@123',
        loginType: 'school_authority',
      }),
    });
    const loginBody = await loginResponse.json();
    expect(loginResponse.status).toBe(200);

    authority.status = 'suspended';
    saveSchoolData(schools);

    try {
      const protectedResponse = await fetch(`http://127.0.0.1:${port}/api/v1/protected/globy-school`, {
        headers: { Authorization: `Bearer ${loginBody.accessToken}` },
      });
      const protectedBody = await protectedResponse.json();
      expect(protectedResponse.status).toBe(403);
      expect(protectedBody.message).toMatch(/suspended|contact your school administrator/i);
    } finally {
      authority.status = previousStatus || 'active';
      saveSchoolData(schools);
    }
  });

  test('platform-admin listings never include password hashes', async () => {
    const admins = await platformAdminService.listPlatformAdmins('ataetabenjamin');
    expect(admins.length).toBeGreaterThan(0);
    expect(admins[0].passwordHash).toBeUndefined();
    expect(admins[0].studentPasswordHash).toBeUndefined();
  });
});