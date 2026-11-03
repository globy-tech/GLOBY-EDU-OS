const express = require('express');

describe('Firebase-backed school login route', () => {
  let app;
  let server;
  let authService;
  let firebaseCore;
  let fallbackSchool;
  const originalDataStoreMode = process.env.DATA_STORE_MODE;
  const originalQaMode = process.env.GLOBY_QA_MODE;

  beforeAll(async () => {
    process.env.DATA_STORE_MODE = 'firebase';
    process.env.GLOBY_QA_MODE = 'true';
    jest.resetModules();
    jest.doMock('../../firebase.data', () => ({ isFirebaseDataConfigured: () => true }));
    jest.doMock('../../firebase.core', () => ({
      getTenant: jest.fn(async () => ({ name: 'Globy School' })),
      isFirebaseCoreMode: jest.fn(() => true),
      listTenants: jest.fn(async () => [
        { id: 'firebase-school-a', schoolId: 'firebase-school-a', name: 'Firebase Academy' },
        { id: 'firebase-school-b', schoolId: 'firebase-school-b', name: 'North School' },
      ]),
    }));
    jest.doMock('../../modules/auth/auth.service', () => ({
      login: jest.fn(async (schoolId, username, password, options) => ({
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        user: {
          id: `${schoolId}:teacher@example.test`,
          username,
          fullName: 'Test Teacher',
          roles: [options.loginType],
          passwordNeedsReset: false,
        },
      })),
    }));
    jest.doMock('../../modules/audit/audit.service', () => ({ recordAuditEvent: jest.fn(async () => {}) }));
    fallbackSchool = {
      loadSchoolData: jest.fn(() => []),
      saveSchoolData: jest.fn(),
      createSchoolId: () => 'test-school',
      ensureDemoSchool: jest.fn(),
      findPlatformAdminByEmail: () => null,
    };
    jest.doMock('../../modules/school/fallback.school', () => fallbackSchool);
    authService = require('../../modules/auth/auth.service');
    firebaseCore = require('../../firebase.core');
    const authRouter = require('../auth');
    app = express();
    app.use(express.json());
    app.use('/api/v1/auth', authRouter);
    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });
  });

  beforeEach(() => jest.clearAllMocks());

  afterAll(async () => {
    if (server) await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    if (originalDataStoreMode === undefined) delete process.env.DATA_STORE_MODE;
    else process.env.DATA_STORE_MODE = originalDataStoreMode;
    if (originalQaMode === undefined) delete process.env.GLOBY_QA_MODE;
    else process.env.GLOBY_QA_MODE = originalQaMode;
    jest.dontMock('../../firebase.data');
    jest.dontMock('../../firebase.core');
    jest.dontMock('../../modules/auth/auth.service');
    jest.dontMock('../../modules/audit/audit.service');
    jest.dontMock('../../modules/school/fallback.school');
    jest.resetModules();
  });

  test('authenticates School Authority through the tenant-scoped password service', async () => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/auth/school-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId: 'globy-school', username: 'head@school.test', password: 'test-only-password', loginType: 'school_authority' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ status: 'ok', role: 'school_authority', schoolId: 'globy-school', schoolName: 'Globy School' });
    expect(payload.accessToken).toBe('test-access-token');
    expect(payload.refreshToken).toBeUndefined();
    expect(response.headers.get('set-cookie')).toMatch(/globyedu_refresh_token=.*HttpOnly/i);
    expect(authService.login).toHaveBeenCalledWith('globy-school', 'head@school.test', 'test-only-password', { loginType: 'school_authority' });
    expect(firebaseCore.getTenant).toHaveBeenCalledWith('globy-school');
  });

  test('rejects password-only teacher login without calling the password authentication service', async () => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/auth/school-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId: 'globy-school', username: 'teacher@school.test', password: 'test-only-password', loginType: 'teacher' }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ status: 'error', message: 'Unable to sign in. Please check your details.' });
    expect(authService.login).not.toHaveBeenCalled();
  });

  test('returns Firestore-backed schools with the existing dropdown response shape', async () => {
    firebaseCore.listTenants.mockClear();
    fallbackSchool.loadSchoolData.mockClear();

    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/auth/schools`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      status: 'ok',
      schools: [
        { schoolId: 'firebase-school-a', name: 'Firebase Academy' },
        { schoolId: 'firebase-school-b', name: 'North School' },
      ],
    });
    expect(firebaseCore.listTenants).toHaveBeenCalledTimes(1);
    expect(fallbackSchool.loadSchoolData).not.toHaveBeenCalled();
  });
});