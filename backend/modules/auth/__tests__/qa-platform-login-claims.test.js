const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

describe('isolated QA platform-admin login claims', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'globy-qa-platform-'));
  const environmentKeys = ['DATA_STORE_MODE', 'GLOBY_QA_MODE', 'GLOBY_AUDIT_FILE'];
  const originalEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  const testPassword = 'QaOnly-Test-Pass!42';
  let platformLogin;
  let result;

  beforeAll(async () => {
    process.env.DATA_STORE_MODE = 'json';
    process.env.GLOBY_QA_MODE = 'true';
    process.env.GLOBY_AUDIT_FILE = path.join(directory, 'audit-logs.json');
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
    for (const key of environmentKeys) {
      if (originalEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnvironment[key];
    }
    fs.rmSync(directory, { recursive: true, force: true });
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
