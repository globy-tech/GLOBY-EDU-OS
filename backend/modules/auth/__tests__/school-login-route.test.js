const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcrypt');
const { assertIsolatedQaConfiguration, EXTERNAL_SERVICE_VARIABLES } = require('../../../config/qa-config');

const isolatedDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'globy-school-login-'));
const isolatedPasswordResetTokensFile = path.join(isolatedDataDirectory, 'password-reset-tokens.json');
const environmentKeys = [
  ...EXTERNAL_SERVICE_VARIABLES,
  'DATABASE_URL',
  'USE_REAL_DATABASE',
  'RENDER_SERVICE_ID',
  'NODE_ENV',
  'DATA_STORE_MODE',
  'GLOBY_QA_MODE',
  'GLOBY_QA_HOME',
  'GLOBY_SCHOOLS_FILE',
  'GLOBY_AUDIT_FILE',
  'GLOBY_PASSWORD_RESET_TOKENS_FILE',
];
const previousEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
EXTERNAL_SERVICE_VARIABLES.forEach((key) => { delete process.env[key]; });
delete process.env.DATABASE_URL;
delete process.env.USE_REAL_DATABASE;
delete process.env.RENDER_SERVICE_ID;
const isolatedSchoolsFile = path.join(isolatedDataDirectory, 'schools.json');
const isolatedAuditFile = path.join(isolatedDataDirectory, 'audit-logs.json');
fs.writeFileSync(isolatedSchoolsFile, JSON.stringify({ schools: [] }), 'utf8');
fs.writeFileSync(isolatedAuditFile, JSON.stringify({ logs: [] }), 'utf8');
process.env.NODE_ENV = 'test';
process.env.DATA_STORE_MODE = 'json';
process.env.GLOBY_QA_MODE = 'false';
process.env.GLOBY_QA_HOME = isolatedDataDirectory;
process.env.GLOBY_SCHOOLS_FILE = isolatedSchoolsFile;
process.env.GLOBY_AUDIT_FILE = isolatedAuditFile;
process.env.GLOBY_PASSWORD_RESET_TOKENS_FILE = isolatedPasswordResetTokensFile;
const authRouter = require('../../../routes/auth');

describe('school login route', () => {
  let app;
  let server;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/auth', authRouter);
    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });
  });

  afterAll(async () => {
    try {
      if (server) await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    } finally {
      environmentKeys.forEach((key) => {
        const value = previousEnvironment.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      });
      fs.rmSync(isolatedDataDirectory, { recursive: true, force: true });
    }
  });

  test('accepts a valid student login for the demo school', async () => {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/auth/school-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schoolId: 'globy-school',
        username: 'STU001',
        password: 'GlobyStudent@123',
        schoolName: 'Globy School',
        studentName: 'Test Student',
        className: 'JHS 3',
        loginType: 'student',
      }),
    });

    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.status).toBe('ok');
    expect(payload.role).toBe('student');
    expect(payload.schoolId).toBe('globy-school');
    expect(payload.fullName).toBe('Test Student');
  });

  test('allows teacher login only in isolated QA mode using an in-memory fixture', async () => {
    const originalQaMode = process.env.GLOBY_QA_MODE;
    const originalSnapshot = global.__workspaceSnapshot;
    const password = 'Local-QA-only-pass!42';
    process.env.GLOBY_QA_MODE = 'true';
    assertIsolatedQaConfiguration(process.env, path.resolve(__dirname, '../../..'));
    global.__workspaceSnapshot = [{
      schoolId: 'QA-LOGIN-SCHOOL',
      name: 'QA Login School',
      schoolStatus: 'active',
      subscriptionStatus: 'active',
      users: [
        { username: 'authority@qa.example', role: 'school_authority', status: 'active', emailVerified: true },
        {
          username: 'teacher@qa.example',
          email: 'teacher@qa.example',
          teacherId: 'QA-TEACHER-1',
          fullName: 'QA Teacher',
          role: 'teacher',
          status: 'active',
          emailVerified: true,
          passwordHash: bcrypt.hashSync(password, 4),
        },
      ],
      teachers: [],
      students: [],
      classes: [],
    }];

    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/auth/school-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schoolId: 'QA-LOGIN-SCHOOL',
          username: 'QA-TEACHER-1',
          password,
          loginType: 'teacher',
        }),
      });

      const payload = await response.json();
      expect(response.status).toBe(200);
      expect(payload.status).toBe('ok');
      expect(payload.role).toBe('teacher');
      expect(payload.schoolId).toBe('QA-LOGIN-SCHOOL');
      expect(payload.accessToken).toEqual(expect.any(String));
    } finally {
      if (originalQaMode === undefined) delete process.env.GLOBY_QA_MODE;
      else process.env.GLOBY_QA_MODE = originalQaMode;
      if (originalSnapshot === undefined) delete global.__workspaceSnapshot;
      else global.__workspaceSnapshot = originalSnapshot;
    }
  });
});
