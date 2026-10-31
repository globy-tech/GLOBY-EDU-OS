const express = require('express');

jest.mock('../../school/school.service', () => ({ createSchool: jest.fn() }));
jest.mock('../auth.service', () => ({ login: jest.fn() }));
jest.mock('../../../firebase.admin', () => ({
  isFirebaseConfigured: jest.fn(),
  createUser: jest.fn(),
  getUserByEmail: jest.fn(),
  deleteUser: jest.fn(),
  generateEmailVerificationLink: jest.fn(),
}));
jest.mock('../../../firebase.data', () => ({ isFirebaseDataConfigured: jest.fn() }));
jest.mock('../../../firebase.core', () => ({
  listTenants: jest.fn(),
  findUserByEmail: jest.fn(),
  deletePendingTenantRegistration: jest.fn(),
}));
jest.mock('../../../config/app-url.config', () => ({ getAppUrl: jest.fn() }));
jest.mock('../utils/email', () => ({ sendEmail: jest.fn(), verificationTemplate: jest.fn(), resetTemplate: jest.fn() }));

const schoolService = require('../../school/school.service');
const authService = require('../auth.service');
const firebaseAdmin = require('../../../firebase.admin');
const firebaseData = require('../../../firebase.data');
const firebaseCore = require('../../../firebase.core');
const { getAppUrl } = require('../../../config/app-url.config');
const { sendEmail } = require('../utils/email');
const authRouter = require('../auth.controller');

function createTestServer() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', authRouter);
  return app.listen(0);
}

function createRegistrationPayload(email) {
  return {
    schoolName: `Registration Diagnostics ${Date.now()}`,
    country: 'Ghana',
    phone: '+233200000001',
    head: {
      fullName: 'Test Authority',
      email,
      phone: '+233200000002',
      password: 'ValidPassword!1',
      confirmPassword: 'ValidPassword!1',
    },
    agreements: { terms: true, privacy: true, emailVerification: true },
  };
}

describe('public registration controller diagnostics', () => {
  let server;

  beforeAll(() => {
    server = createTestServer();
  });

  afterAll(() => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));

  beforeEach(() => {
    jest.clearAllMocks();
    firebaseData.isFirebaseDataConfigured.mockReturnValue(false);
    firebaseAdmin.isFirebaseConfigured.mockReturnValue(false);
    firebaseAdmin.createUser.mockResolvedValue({ uid: 'firebase-user-test' });
    firebaseAdmin.getUserByEmail.mockRejectedValue(Object.assign(new Error('User not found'), { code: 'auth/user-not-found' }));
    firebaseAdmin.deleteUser.mockResolvedValue();
    firebaseAdmin.generateEmailVerificationLink.mockResolvedValue('https://auth.example.test/verify');
    firebaseCore.listTenants.mockResolvedValue([]);
    firebaseCore.findUserByEmail.mockResolvedValue(null);
    firebaseCore.deletePendingTenantRegistration.mockResolvedValue(true);
    getAppUrl.mockReturnValue('https://app.example.test');
    sendEmail.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function postRegistration(payload) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { response, body: await response.json() };
  }

  test('new registrations receive a 14-day trial from the trial start date', async () => {
    const email = `trial-duration-${Date.now()}@example.test`;
    schoolService.createSchool.mockResolvedValue({
      schoolId: 'GLB-2026-TRIAL',
      trialEndsAt: new Date(),
      headAccount: { username: email, password: 'ValidPassword!1' },
    });
    authService.login.mockResolvedValue({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      user: { id: 'trial-user', email, roles: ['school_head'] },
    });

    const result = await postRegistration(createRegistrationPayload(email));
    const schoolPayload = schoolService.createSchool.mock.calls[0][0];

    expect(result.response.status).toBe(200);
    expect(schoolPayload.subscriptionPlan).toBe('14-Day Trial');
    expect(schoolPayload.trialStatus).toBe('14-Day Trial');
    expect(new Date(schoolPayload.trialEndsAt).getTime() - new Date(schoolPayload.trialStartedAt).getTime()).toBe(14 * 24 * 60 * 60 * 1000);
  });

  test('missing APP_URL prevents Firebase registration before creating the school', async () => {
    const email = `app-url-${Date.now()}@example.test`;
    firebaseData.isFirebaseDataConfigured.mockReturnValue(true);
    firebaseAdmin.isFirebaseConfigured.mockReturnValue(true);
    getAppUrl.mockImplementation(() => {
      throw new Error('APP_URL is required in production.');
    });
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await postRegistration(createRegistrationPayload(email));

    expect(result.response.status).toBe(503);
    expect(result.body.code).toBe('REGISTRATION_VERIFICATION_SETUP_FAILED');
    expect(schoolService.createSchool).not.toHaveBeenCalled();
    expect(firebaseAdmin.createUser).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('[auth.register] School signup failed', {
      phase: 'firebase.configuration',
      errorName: 'Error',
    });
  });

  test('Firebase signup returns pending verification without issuing a session', async () => {
    const email = `verified-${Date.now()}@example.test`;
    firebaseData.isFirebaseDataConfigured.mockReturnValue(true);
    firebaseAdmin.isFirebaseConfigured.mockReturnValue(true);
    schoolService.createSchool.mockResolvedValue({
      schoolId: 'GLB-2026-VERIFICATION',
      trialEndsAt: new Date('2026-10-08T00:00:00.000Z'),
      headAccount: { username: email, password: 'ValidPassword!1' },
    });

    const result = await postRegistration(createRegistrationPayload(email));

    expect(result.response.status).toBe(202);
    expect(result.body).toMatchObject({
      status: 'pending_verification',
      requiresEmailVerification: true,
      schoolId: 'GLB-2026-VERIFICATION',
      tenantId: 'GLB-2026-VERIFICATION',
      verificationEmail: email,
    });
    expect(result.body.accessToken).toBeUndefined();
    expect(result.body.user).toBeUndefined();
    expect(firebaseAdmin.createUser).toHaveBeenCalledWith({
      email,
      password: 'ValidPassword!1',
      displayName: 'Test Authority',
    });
    expect(sendEmail).toHaveBeenCalled();
    expect(authService.login).not.toHaveBeenCalled();
  });

  test('Firebase Auth creation failure cannot report registration success', async () => {
    const email = `auth-failed-${Date.now()}@example.test`;
    firebaseData.isFirebaseDataConfigured.mockReturnValue(true);
    firebaseAdmin.isFirebaseConfigured.mockReturnValue(true);
    firebaseAdmin.createUser.mockRejectedValue(Object.assign(new Error('private auth detail'), { code: 'auth/internal-error' }));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await postRegistration(createRegistrationPayload(email));

    expect(result.response.status).toBe(503);
    expect(result.body).toMatchObject({ status: 'error', code: 'REGISTRATION_VERIFICATION_SETUP_FAILED' });
    expect(schoolService.createSchool).not.toHaveBeenCalled();
    expect(firebaseAdmin.deleteUser).not.toHaveBeenCalled();
    expect(result.body.accessToken).toBeUndefined();
    expect(authService.login).not.toHaveBeenCalled();
  });

  test('verification email delivery failure cannot report registration success', async () => {
    const email = `mail-failed-${Date.now()}@example.test`;
    firebaseData.isFirebaseDataConfigured.mockReturnValue(true);
    firebaseAdmin.isFirebaseConfigured.mockReturnValue(true);
    schoolService.createSchool.mockResolvedValue({ schoolId: 'GLB-2026-MAIL-PARTIAL' });
    sendEmail.mockResolvedValue({ ok: false, reason: 'EMAIL_PROVIDER_NOT_CONFIGURED' });
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await postRegistration(createRegistrationPayload(email));

    expect(result.response.status).toBe(503);
    expect(result.body).toMatchObject({
      code: 'EMAIL_PROVIDER_NOT_CONFIGURED',
      retryable: true,
    });
    expect(result.body.message).toContain('configured email provider');
    expect(result.body).not.toHaveProperty('providerDetail');
    expect(firebaseCore.deletePendingTenantRegistration).toHaveBeenCalledWith('GLB-2026-MAIL-PARTIAL', email);
    expect(firebaseAdmin.deleteUser).toHaveBeenCalledWith('firebase-user-test');
    expect(result.body.accessToken).toBeUndefined();
    expect(authService.login).not.toHaveBeenCalled();
  });

  test('verification failure rolls back so the same email can retry without a duplicate tenant', async () => {
    const email = `retry-${Date.now()}@example.test`;
    firebaseData.isFirebaseDataConfigured.mockReturnValue(true);
    firebaseAdmin.isFirebaseConfigured.mockReturnValue(true);
    schoolService.createSchool
      .mockResolvedValueOnce({ schoolId: 'GLB-2026-RETRY-1' })
      .mockResolvedValueOnce({ schoolId: 'GLB-2026-RETRY-2' });
    sendEmail.mockResolvedValueOnce({ ok: false, reason: 'EMAIL_UNAVAILABLE' })
      .mockResolvedValueOnce({ ok: true });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const payload = createRegistrationPayload(email);

    const failed = await postRegistration(payload);
    const retried = await postRegistration(payload);

    expect(failed.response.status).toBe(503);
    expect(retried.response.status).toBe(202);
    expect(retried.body.schoolId).toBe('GLB-2026-RETRY-2');
    expect(firebaseCore.deletePendingTenantRegistration).toHaveBeenCalledWith('GLB-2026-RETRY-1', email);
    expect(firebaseAdmin.deleteUser).toHaveBeenCalledTimes(1);
    expect(schoolService.createSchool).toHaveBeenCalledTimes(2);
  });

  test('existing Firebase Auth identities are rejected before school or Auth creation', async () => {
    const email = `auth-existing-${Date.now()}@example.test`;
    firebaseData.isFirebaseDataConfigured.mockReturnValue(true);
    firebaseAdmin.isFirebaseConfigured.mockReturnValue(true);
    firebaseAdmin.getUserByEmail.mockResolvedValue({ uid: 'existing-user' });

    const result = await postRegistration(createRegistrationPayload(email));

    expect(result.response.status).toBe(409);
    expect(schoolService.createSchool).not.toHaveBeenCalled();
    expect(firebaseAdmin.createUser).not.toHaveBeenCalled();
  });

  test('fallback signup reports success only after creating a real session', async () => {
    const email = `fallback-${Date.now()}@example.test`;
    schoolService.createSchool.mockResolvedValue({
      schoolId: 'GLB-2026-FALLBACK',
      trialEndsAt: new Date('2026-10-08T00:00:00.000Z'),
      headAccount: { username: email, password: 'ValidPassword!1' },
    });
    authService.login.mockResolvedValue({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      user: { id: 'fallback-user', email, roles: ['school_head'] },
    });

    const result = await postRegistration(createRegistrationPayload(email));

    expect(result.response.status).toBe(200);
    expect(result.body).toMatchObject({ status: 'ok', schoolId: 'GLB-2026-FALLBACK', tenantId: 'GLB-2026-FALLBACK' });
    expect(result.body.accessToken).toBe('test-access-token');
    expect(result.body.user.role).toBe('school_head');
  });

  test('keeps the public error generic while logging only safe failure metadata', async () => {
    const email = `firestore-${Date.now()}@example.test`;
    const failure = Object.assign(new Error('private diagnostic detail must not be logged'), {
      code: 'permission-denied',
      registrationOperation: 'tenant.write',
    });
    schoolService.createSchool.mockRejectedValue(failure);
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await postRegistration(createRegistrationPayload(email));

    expect(result.response.status).toBe(500);
    expect(result.body).toEqual({ status: 'error', message: 'We could not create your school account right now. Please try again.' });
    expect(error).toHaveBeenCalledWith('[auth.register] School signup failed', {
      phase: 'school.create',
      operation: 'tenant.write',
      errorName: 'Error',
      errorCode: 'permission-denied',
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain('private diagnostic detail');
  });

  test('returns a conflict instead of a generic server error for an existing school registration', async () => {
    schoolService.createSchool.mockRejectedValue(Object.assign(
      new Error('Existing registration'),
      { code: 'SCHOOL_REGISTRATION_EXISTS', registrationOperation: 'owner.lookup' },
    ));

    const result = await postRegistration(createRegistrationPayload(`existing-${Date.now()}@example.test`));

    expect(result.response.status).toBe(409);
    expect(result.body).toEqual({
      status: 'error',
      message: 'A school registration for this authority email already exists. Please contact support before retrying.',
    });
  });
});