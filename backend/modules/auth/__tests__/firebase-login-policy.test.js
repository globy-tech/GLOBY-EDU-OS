jest.mock('../../../firebase.admin', () => ({
  isFirebaseConfigured: () => true,
  getUserByEmail: jest.fn(),
  getUser: jest.fn(),
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

  test('does not issue teacher sessions through password-only authentication', async () => {
    mockFirebaseSchoolLogin({
      schoolId: 'globy-school',
      schoolStatus: 'active',
      subscriptionStatus: 'active',
    }, {
      role: 'teacher',
      roles: ['teacher'],
      teacherId: 'T-ABC12345',
      isVerified: true,
      emailVerified: true,
    });

    await expect(authService.login('globy-school', 'linked@globy.test', 'test-password'))
      .rejects.toThrow('Invalid credentials');
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

  test('does not issue a Firebase session until the Auth email is verified', async () => {
    mockFirebaseSchoolLogin({
      schoolId: 'globy-school',
      schoolStatus: 'active',
      subscriptionStatus: 'active',
    }, { firebaseUid: 'firebase-user-1' });
    const firebaseAdmin = require('../../../firebase.admin');
    const saveById = jest.spyOn(firebaseCore, 'saveById');
    firebaseAdmin.verifyIdToken.mockResolvedValueOnce({
      uid: 'firebase-user-1',
      email: 'linked@globy.test',
      email_verified: false,
    });

    await expect(authService.loginWithFirebaseIdToken('firebase-token', 'globy-school', {
      identifier: 'linked@globy.test',
    }))
      .rejects.toThrow('Email must be verified before signing in.');
    expect(saveById).not.toHaveBeenCalled();
  });

  test('marks a newly verified Firebase teacher record verified before issuing a session', async () => {
    const { userRecord } = mockFirebaseSchoolLogin({
      schoolId: 'globy-school',
      schoolStatus: 'active',
      subscriptionStatus: 'active',
    }, {
      role: 'teacher',
      roles: ['teacher'],
      isVerified: false,
      emailVerified: false,
      firebaseUid: 'firebase-user-1',
    });
    const firebaseAdmin = require('../../../firebase.admin');
    const saveById = jest.spyOn(firebaseCore, 'saveById').mockImplementation(async (collection, id, updates) => {
      Object.assign(userRecord, updates);
      return { id, ...userRecord };
    });
    firebaseAdmin.verifyIdToken.mockResolvedValueOnce({
      uid: 'firebase-user-1',
      email: 'linked@globy.test',
      email_verified: true,
    });

    const result = await authService.loginWithFirebaseIdToken('firebase-token', 'globy-school');

    expect(saveById).toHaveBeenCalledWith('users', 'school-user-1', {
      isVerified: true,
      emailVerified: true,
      firebaseUid: 'firebase-user-1',
    }, true);
    expect(result.user).toMatchObject({
      role: 'teacher',
      isVerified: true,
      emailVerified: true,
    });
  });

  test('authenticates teachers only through their linked active school account', async () => {
    const { userRecord } = mockFirebaseSchoolLogin({
      schoolId: 'globy-school',
      schoolStatus: 'active',
      subscriptionStatus: 'active',
    }, {
      role: 'teacher',
      roles: ['teacher'],
      teacherId: 'T-ABC12345',
      firebaseUid: 'firebase-user-1',
      isVerified: false,
      emailVerified: false,
      passwordNeedsReset: false,
      invitationStatus: 'pending',
    });
    const teacherRecord = {
      id: 'globy-school:T-ABC12345',
      schoolId: 'globy-school',
      teacherId: 'T-ABC12345',
      firebaseUid: 'firebase-user-1',
      email: 'linked@globy.test',
      status: 'active',
    };
    const firebaseAdmin = require('../../../firebase.admin');
    firebaseAdmin.verifyIdToken.mockResolvedValueOnce({
      uid: 'firebase-user-1',
      email: 'linked@globy.test',
      email_verified: true,
    });
    firebaseAdmin.getUser.mockResolvedValue({
      uid: 'firebase-user-1',
      email: 'linked@globy.test',
      emailVerified: true,
      disabled: false,
    });
    jest.spyOn(firebaseCore, 'listBySchool').mockImplementation(async (collection) => (
      collection === 'users' ? [userRecord] : [teacherRecord]
    ));
    jest.spyOn(firebaseCore, 'saveById').mockImplementation(async (collection, id, updates) => {
      Object.assign(collection === 'users' ? userRecord : teacherRecord, updates);
      return { id, ...updates };
    });

    const result = await authService.loginWithFirebaseIdToken('firebase-token', 'globy-school', {
      identifier: 'linked@globy.test',
      loginType: 'teacher',
    });

    expect(result.user.roles).toEqual(['teacher']);
    expect(userRecord).toMatchObject({
      firebaseUid: 'firebase-user-1',
      isVerified: true,
      emailVerified: true,
      passwordNeedsReset: false,
      invitationStatus: 'activated',
    });
    expect(teacherRecord).toMatchObject({
      emailVerified: true,
      invitationStatus: 'activated',
    });
  });

  test('does not activate or issue a teacher session before password setup is complete', async () => {
    const { userRecord } = mockFirebaseSchoolLogin({
      schoolId: 'globy-school',
      schoolStatus: 'active',
      subscriptionStatus: 'active',
    }, {
      role: 'teacher',
      roles: ['teacher'],
      teacherId: 'T-ABC12345',
      firebaseUid: 'firebase-user-1',
      isVerified: true,
      emailVerified: true,
      passwordNeedsReset: true,
      invitationStatus: 'pending',
    });
    const teacherRecord = {
      id: 'globy-school:T-ABC12345',
      schoolId: 'globy-school',
      teacherId: 'T-ABC12345',
      firebaseUid: 'firebase-user-1',
      email: 'linked@globy.test',
      status: 'active',
    };
    const firebaseAdmin = require('../../../firebase.admin');
    firebaseAdmin.verifyIdToken.mockResolvedValueOnce({
      uid: 'firebase-user-1',
      email: 'linked@globy.test',
      email_verified: true,
    });
    firebaseAdmin.getUser.mockResolvedValue({
      uid: 'firebase-user-1',
      email: 'linked@globy.test',
      emailVerified: true,
      disabled: false,
    });
    const saveById = jest.spyOn(firebaseCore, 'saveById');
    jest.spyOn(firebaseCore, 'listBySchool').mockImplementation(async (collection) => (
      collection === 'users' ? [userRecord] : [teacherRecord]
    ));

    await expect(authService.loginWithFirebaseIdToken('firebase-token', 'globy-school', {
      loginType: 'teacher',
    })).rejects.toThrow(/set your account password/i);
    expect(saveById).not.toHaveBeenCalled();
    expect(userRecord.invitationStatus).toBe('pending');
  });

  test('rejects a teacher token with an incorrect school ID', async () => {
    const firebaseCore = require('../../../firebase.core');
    jest.spyOn(firebaseData, 'isFirebaseDataConfigured').mockReturnValue(true);
    jest.spyOn(firebaseCore, 'getTenant').mockResolvedValue(null);
    await expect(authService.loginWithFirebaseIdToken('firebase-token', 'wrong-school', {
      loginType: 'teacher',
    })).rejects.toThrow('Tenant not found.');
  });

  test('rejects teacher login when the Auth UID is not linked to the requested school', async () => {
    const { userRecord } = mockFirebaseSchoolLogin({
      schoolId: 'globy-school',
      schoolStatus: 'active',
      subscriptionStatus: 'active',
    }, { role: 'teacher', roles: ['teacher'], firebaseUid: 'different-uid', teacherId: 'T-ABC12345' });
    const firebaseAdmin = require('../../../firebase.admin');
    firebaseAdmin.verifyIdToken.mockResolvedValueOnce({
      uid: 'firebase-user-1',
      email: 'linked@globy.test',
      email_verified: true,
    });
    jest.spyOn(firebaseCore, 'listBySchool').mockImplementation(async (collection) => (
      collection === 'users' ? [userRecord] : []
    ));

    await expect(authService.loginWithFirebaseIdToken('firebase-token', 'globy-school', {
      identifier: 'linked@globy.test',
      loginType: 'teacher',
    })).rejects.toThrow(/account not recognized/i);
  });

  test('rejects inactive, mis-associated, and non-teacher records', async () => {
    for (const overrides of [
      { status: 'disabled', firebaseUid: 'firebase-user-1', role: 'teacher', roles: ['teacher'] },
      { tenantId: 'other-school', schoolId: 'other-school', firebaseUid: 'firebase-user-1', role: 'teacher', roles: ['teacher'] },
      { firebaseUid: 'firebase-user-1', role: 'student', roles: ['student'] },
    ]) {
      const { userRecord } = mockFirebaseSchoolLogin({
        schoolId: 'globy-school',
        schoolStatus: 'active',
        subscriptionStatus: 'active',
      }, { teacherId: 'T-ABC12345', ...overrides });
      const firebaseAdmin = require('../../../firebase.admin');
      firebaseAdmin.verifyIdToken.mockResolvedValueOnce({
        uid: 'firebase-user-1',
        email: 'linked@globy.test',
        email_verified: true,
      });
      jest.spyOn(firebaseCore, 'listBySchool').mockImplementation(async (collection) => (
        collection === 'users' ? [userRecord] : [{
          id: 'globy-school:T-ABC12345',
          schoolId: 'globy-school',
          teacherId: 'T-ABC12345',
          firebaseUid: 'firebase-user-1',
          email: 'linked@globy.test',
          status: 'active',
        }]
      ));

      const expectedFailure = overrides.roles[0] === 'teacher'
        ? /Active teacher account not found/i
        : /account not recognized/i;
      await expect(authService.loginWithFirebaseIdToken('firebase-token', 'globy-school', {
        identifier: 'linked@globy.test',
        loginType: 'teacher',
      })).rejects.toThrow(expectedFailure);
      jest.restoreAllMocks();
    }
  });

  test('rejects disabled Firebase Auth teachers', async () => {
    const { userRecord } = mockFirebaseSchoolLogin({
      schoolId: 'globy-school',
      schoolStatus: 'active',
      subscriptionStatus: 'active',
    }, {
      role: 'teacher',
      roles: ['teacher'],
      firebaseUid: 'firebase-user-1',
      teacherId: 'T-ABC12345',
      isVerified: true,
      emailVerified: true,
    });
    const firebaseAdmin = require('../../../firebase.admin');
    firebaseAdmin.verifyIdToken.mockResolvedValueOnce({
      uid: 'firebase-user-1',
      email: 'linked@globy.test',
      email_verified: true,
    });
    firebaseAdmin.getUser.mockResolvedValue({
      uid: 'firebase-user-1',
      email: 'linked@globy.test',
      emailVerified: true,
      disabled: true,
    });
    jest.spyOn(firebaseCore, 'listBySchool').mockImplementation(async (collection) => (
      collection === 'users' ? [userRecord] : [{
        id: 'globy-school:T-ABC12345',
        schoolId: 'globy-school',
        teacherId: 'T-ABC12345',
        firebaseUid: 'firebase-user-1',
        email: 'linked@globy.test',
        status: 'active',
      }]
    ));

    await expect(authService.loginWithFirebaseIdToken('firebase-token', 'globy-school', {
      identifier: 'linked@globy.test',
      loginType: 'teacher',
    })).rejects.toThrow(/disabled or its email is not verified/i);
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
