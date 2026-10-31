jest.mock('../../../firebase.admin', () => ({
  isFirebaseConfigured: () => true,
  getUserByEmail: jest.fn(),
  verifyIdToken: jest.fn(async () => ({ email: 'linked@globy.test', email_verified: true })),
}));

jest.mock('../../../config/prisma.client', () => ({
  __stub: false,
  tenant: {
    findUnique: jest.fn(async () => ({
      id: 'tenant-db-id',
      schoolId: 'globy-school',
      status: 'active',
      schoolStatus: 'active',
      subscriptionStatus: 'active',
    })),
  },
  user: {
    findUnique: jest.fn(async ({ where }) => (where.email === 'linked@globy.test' ? {
      id: 'user-1',
      email: 'linked@globy.test',
      tenantId: 'tenant-db-id',
      status: 'active',
      isVerified: true,
      passwordNeedsReset: false,
    } : null)),
    update: jest.fn(async ({ data }) => ({
      id: 'user-1',
      email: 'linked@globy.test',
      tenantId: 'tenant-db-id',
      status: 'active',
      isVerified: true,
      passwordNeedsReset: false,
      ...data,
    })),
  },
  userRole: {
    findMany: jest.fn(async () => [{ role: { name: 'school_authority' } }]),
  },
  refreshToken: {
    create: jest.fn(async () => null),
    findMany: jest.fn(async () => []),
  },
}));

jest.mock('bcrypt', () => ({ compare: jest.fn(async () => true), hash: jest.fn(async () => 'hash') }));

const authService = require('../auth.service');
const firebaseData = require('../../../firebase.data');
const firebaseCore = require('../../../firebase.core');

function mockFirebaseSchoolLogin(school, userOverrides = {}) {
  jest.spyOn(firebaseData, 'isFirebaseDataConfigured').mockReturnValue(true);
  jest.spyOn(firebaseCore, 'getTenant').mockResolvedValue(school);
  const userRecord = {
    id: 'school-user-1',
    email: 'linked@globy.test',
    schoolId: 'globy-school',
    tenantId: 'globy-school',
    role: 'school_authority',
    roles: ['school_authority'],
    status: 'active',
    isVerified: true,
    passwordHash: 'firebase-test-hash',
    passwordNeedsReset: false,
    ...userOverrides,
  };
  const userRef = { id: userRecord.id };
  const userSnapshot = { exists: true, id: userRecord.id, data: () => userRecord };
  const firestore = {
    collection: (name) => name === 'users'
      ? { doc: () => userRef, where: () => ({ get: async () => ({ docs: [{ id: userRecord.id, data: () => userRecord }] }) }) }
      : { doc: (id) => ({ id }) },
    runTransaction: async (callback) => callback({
      get: async (reference) => reference === userRef ? userSnapshot : { exists: false, data: () => null },
      create: () => {},
      update: () => {},
    }),
  };
  jest.spyOn(firebaseData, 'getFirestore').mockReturnValue({
    ...firestore,
  });
  return { userRecord };
}

describe('Firebase login account-linking policy', () => {
  afterEach(() => jest.restoreAllMocks());

  test('rejects an unlinked Firebase account without creating a user', async () => {
    const firebaseAdmin = require('../../../firebase.admin');
    firebaseAdmin.verifyIdToken.mockResolvedValueOnce({ email: 'unknown@globy.test', email_verified: true });

    await expect(authService.loginWithFirebaseIdToken('firebase-token', 'globy-school'))
      .rejects.toThrow(/account not recognized/i);
  });

  test('rejects a linked non-super-admin account for platform login', async () => {
    await expect(authService.loginWithFirebaseIdToken('firebase-token', 'globy-school', { platformAdminMode: true }))
      .rejects.toThrow(/dedicated platform administrator login/i);
  });

  test('returns explicit tenant and school identifiers for linked accounts', async () => {
    const result = await authService.loginWithFirebaseIdToken('firebase-token', 'globy-school');

    expect(require('../../../firebase.admin').verifyIdToken).toHaveBeenCalledWith('firebase-token', true);
    expect(result.tenantId).toBe('tenant-db-id');
    expect(result.schoolId).toBe('globy-school');
    expect(result.user.roles).toEqual(['school_authority']);
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
  });

  test('does not create a session while Firebase password synchronization is pending', async () => {
    mockFirebaseSchoolLogin({
      schoolId: 'globy-school',
      schoolStatus: 'active',
      subscriptionStatus: 'active',
    }, { passwordSyncPending: true });

    await expect(authService.loginWithFirebaseIdToken('firebase-token', 'globy-school'))
      .rejects.toThrow('Password update is still being synchronized.');
  });

  test('allows an active subscription when an old trial end date remains on the tenant', async () => {
    mockFirebaseSchoolLogin({
      schoolId: 'globy-school',
      schoolStatus: 'active',
      subscriptionStatus: 'active',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      trialEndsAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    await expect(authService.login('globy-school', 'linked@globy.test', 'test-password'))
      .resolves.toMatchObject({ user: { schoolId: 'globy-school' } });
  });

  test('keeps renewal authentication available after paid expiry while tenant routes enforce access', async () => {
    mockFirebaseSchoolLogin({
      schoolId: 'globy-school',
      schoolStatus: 'active',
      status: 'active',
      subscriptionStatus: 'active',
      expiresAt: new Date(Date.now() - 60 * 60 * 1000),
      subscriptions: [{ status: 'active', expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }],
    });
    const firebaseAdmin = require('../../../firebase.admin');

    await expect(authService.login('globy-school', 'linked@globy.test', 'test-password'))
      .resolves.toMatchObject({ user: { schoolId: 'globy-school' } });

    firebaseAdmin.verifyIdToken.mockResolvedValueOnce({ email: 'linked@globy.test', email_verified: true });
    await expect(authService.loginWithFirebaseIdToken('firebase-token', 'globy-school'))
      .resolves.toMatchObject({ user: { schoolId: 'globy-school' } });
  });

  test('allows renewal login for a persisted expired paid subscription', async () => {
    mockFirebaseSchoolLogin({
      schoolId: 'globy-school',
      schoolStatus: 'active',
      subscriptionStatus: 'expired',
      subscriptionPlan: 'Starter',
      expiresAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    await expect(authService.login('globy-school', 'linked@globy.test', 'test-password'))
      .resolves.toMatchObject({ user: { schoolId: 'globy-school' } });
  });

  test('continues to deny a trial subscription after its trial end date', async () => {
    mockFirebaseSchoolLogin({
      schoolId: 'globy-school',
      schoolStatus: 'active',
      subscriptionStatus: 'trial',
      trialEndsAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    await expect(authService.login('globy-school', 'linked@globy.test', 'test-password'))
      .rejects.toThrow('School account is not active');
  });

  test('continues to deny a legacy expired trial subscription', async () => {
    mockFirebaseSchoolLogin({
      schoolId: 'globy-school',
      status: 'trial',
      subscriptionPlan: '5-Day Trial',
      trialEndsAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    await expect(authService.login('globy-school', 'linked@globy.test', 'test-password'))
      .rejects.toThrow('School account is not active');
  });

  test('requires Firebase email verification and syncs Firestore before issuing a school-head session', async () => {
    const firebaseAdmin = require('../../../firebase.admin');
    const { userRecord } = mockFirebaseSchoolLogin({
      schoolId: 'globy-school',
      schoolStatus: 'active',
      subscriptionStatus: 'active',
    }, {
      role: 'school_head',
      roles: undefined,
      isVerified: false,
      emailVerified: false,
    });
    const saveById = jest.spyOn(firebaseCore, 'saveById').mockImplementation(async (collection, id, updates) => {
      Object.assign(userRecord, updates);
      return { id, ...userRecord };
    });

    firebaseAdmin.getUserByEmail.mockResolvedValueOnce({ uid: 'firebase-user-1', emailVerified: false });
    await expect(authService.login('globy-school', 'linked@globy.test', 'test-password', { loginType: 'school_authority' }))
      .rejects.toThrow('Email must be verified before signing in.');
    expect(saveById).not.toHaveBeenCalled();

    firebaseAdmin.getUserByEmail.mockResolvedValueOnce({ uid: 'firebase-user-1', emailVerified: true });
    const result = await authService.login('globy-school', 'linked@globy.test', 'test-password', { loginType: 'school_authority' });

    expect(saveById).toHaveBeenCalledWith('users', 'school-user-1', {
      isVerified: true,
      emailVerified: true,
      firebaseUid: 'firebase-user-1',
    }, true);
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.user).toMatchObject({
      id: 'school-user-1',
      role: 'school_head',
      schoolId: 'globy-school',
      tenantId: 'globy-school',
      isVerified: true,
      emailVerified: true,
    });
  });
});
