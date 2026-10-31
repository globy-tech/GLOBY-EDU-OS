jest.mock('../../modules/auth/auth.service', () => ({
  login: jest.fn(),
  forgotPassword: jest.fn(),
  resetPassword: jest.fn(),
  changePassword: jest.fn(),
}));
jest.mock('../../firebase.data', () => ({ isFirebaseDataConfigured: () => true }));
jest.mock('../../firebase.core', () => ({
  getTenant: jest.fn(async () => ({ name: 'Recovery Test School' })),
  listTenants: jest.fn(async () => []),
}));
jest.mock('../../modules/auth/middleware/auth.middleware', () => (req, res, next) => {
  if (req.headers.authorization !== 'Bearer test-auth-token') {
    return res.status(401).json({ status: 'error', message: 'Authorization required.' });
  }
  req.user = {
    userId: 'school-a:teacher@example.test',
    tenantId: 'school-a',
    roles: ['teacher'],
    passwordNeedsReset: true,
  };
  return next();
});
jest.mock('../../modules/school/fallback.school', () => ({
  loadSchoolData: jest.fn(() => []),
  saveSchoolData: jest.fn(),
  createSchoolId: jest.fn(() => 'school-a'),
  ensureDemoSchool: jest.fn(),
  findPlatformAdminByEmail: jest.fn(() => null),
}));
jest.mock('../../modules/auth/utils/email', () => ({
  sendEmail: jest.fn(async () => ({ ok: true })),
  resetTemplate: jest.fn((token) => `https://app.example.test/#/reset-password?token=${token}`),
  welcomeTemplate: jest.fn(() => ''),
}));
jest.mock('../../modules/audit/audit.service', () => ({
  recordAuditEvent: jest.fn(async () => null),
}));

const express = require('express');
const authRouter = require('../auth');
const authService = require('../../modules/auth/auth.service');
const { sendEmail } = require('../../modules/auth/utils/email');

let server;
let baseUrl;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', authRouter);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1/auth`;
});

afterAll(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

beforeEach(() => jest.clearAllMocks());

describe('Firebase mounted password recovery routes', () => {
  test('sends the reset link through existing email delivery without returning the token', async () => {
    const rawToken = 'test-only-reset-token';
    authService.forgotPassword.mockImplementation(async (email, options) => {
      await options.deliverResetToken(rawToken);
      return true;
    });

    const response = await fetch(`${baseUrl}/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'teacher@example.test', loginType: 'teacher' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: 'ok' });
    expect(JSON.stringify(body)).not.toContain(rawToken);
    expect(authService.forgotPassword).toHaveBeenCalledWith('teacher@example.test', expect.objectContaining({ loginType: 'teacher' }));
    expect(sendEmail).toHaveBeenCalledWith(
      'teacher@example.test',
      'Reset your GlobyEdu password',
      `https://app.example.test/#/reset-password?token=${rawToken}`,
    );
  });

  test('keeps unknown-email requests generic and does not send an email', async () => {
    authService.forgotPassword.mockResolvedValue(true);

    const response = await fetch(`${baseUrl}/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'unknown@example.test' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('keeps reset initiation generic when Firestore or email delivery fails', async () => {
    authService.forgotPassword.mockRejectedValue(new Error('mail delivery unavailable'));

    const response = await fetch(`${baseUrl}/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'teacher@example.test' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  test('returns a safe client error for invalid or expired reset links', async () => {
    authService.resetPassword.mockRejectedValue(new Error('Invalid or expired token'));

    const response = await fetch(`${baseUrl}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'invalid-test-token', password: 'NewStrong!Pass2' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ status: 'error', message: 'Invalid or expired reset token.' });
  });

  test('requires an authenticated session and ignores a client-selected user ID', async () => {
    const unauthenticated = await fetch(`${baseUrl}/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword: 'Current!Pass1', newPassword: 'NewStrong!Pass2' }),
    });
    expect(unauthenticated.status).toBe(401);
    expect(authService.changePassword).not.toHaveBeenCalled();

    authService.changePassword.mockResolvedValue({
      accessToken: 'new-test-access-token',
      refreshToken: 'new-test-refresh-token',
      user: { passwordNeedsReset: false },
    });
    const response = await fetch(`${baseUrl}/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-auth-token' },
      body: JSON.stringify({
        userId: 'another-user',
        oldPassword: 'Current!Pass1',
        newPassword: 'NewStrong!Pass2',
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok', passwordNeedsReset: false });
    expect(authService.changePassword).toHaveBeenCalledWith('school-a:teacher@example.test', 'Current!Pass1', 'NewStrong!Pass2');
  });
});
