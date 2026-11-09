const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { assertIsolatedQaConfiguration, EXTERNAL_SERVICE_VARIABLES } = require('../../../config/qa-config');

describe('isolated QA platform-admin login claims', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'globy-qa-platform-'));
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
  const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
  const testPassword = 'QaOnly-Test-Pass!42';
  const schoolsFile = path.join(directory, 'schools.json');
  const auditFile = path.join(directory, 'audit-logs.json');
  const passwordResetTokensFile = path.join(directory, 'password-reset-tokens.json');
  let platformLogin;
  let result;

  beforeAll(async () => {
    EXTERNAL_SERVICE_VARIABLES.forEach((key) => { delete process.env[key]; });
    delete process.env.DATABASE_URL;
    delete process.env.USE_REAL_DATABASE;
    delete process.env.RENDER_SERVICE_ID;
    process.env.NODE_ENV = 'test';
    process.env.DATA_STORE_MODE = 'json';
    process.env.GLOBY_QA_MODE = 'true';
    process.env.GLOBY_QA_HOME = directory;
    process.env.GLOBY_SCHOOLS_FILE = schoolsFile;
    process.env.GLOBY_AUDIT_FILE = auditFile;
    process.env.GLOBY_PASSWORD_RESET_TOKENS_FILE = passwordResetTokensFile;
    fs.writeFileSync(schoolsFile, JSON.stringify({ schools: [] }), 'utf8');
    fs.writeFileSync(auditFile, JSON.stringify({ logs: [] }), 'utf8');
    assertIsolatedQaConfiguration(process.env, path.resolve(__dirname, '../../..'));
    global.__workspaceSnapshot = [{
      schoolId: 'QA-PLATFORM-TEST',
      users: [{
        username: 'qa-platform-admin@globyedu.test',
        fullName: 'QA Platform Admin',
        role: 'super_admin',
        platformAdmin: true,
        status: 'active',
        emailVerified: true,
        passwordHash: bcrypt.hashSync(testPassword, 4),
      }],
    }];
    jest.resetModules();

    const authRouter = require('../../../routes/auth');
    const route = authRouter.stack.find((layer) => layer.route?.path === '/platform-login' && layer.route.methods.post);
    platformLogin = route.route.stack[route.route.stack.length - 1].handle;
  });

  afterAll(async () => {
    delete global.__workspaceSnapshot;
    try {
      for (const key of environmentKeys) {
        const value = originalEnvironment.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('issues a tenantless platform-admin token accepted by platform role guards', async () => {
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn((payload) => {
        result = payload;
        return res;
      }),
    };
    await platformLogin({
      body: { username: 'qa-platform-admin@globyedu.test', password: testPassword },
      headers: {},
      ip: '127.0.0.1',
      get: () => 'qa-test',
    }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(result.role).toBe('super_admin');
    const claims = jwt.decode(result.token);
    expect(claims.platformAdmin).toBe(true);
    expect(claims.tenantId).toBeNull();
  });
});
