const mockState = {};

jest.mock('../../../firebase.data', () => ({
  isFirebaseDataConfigured: () => true,
  getFirestore: () => {
    if (mockState.firestoreFailure) throw mockState.firestoreFailure;
    return mockState.firestore;
  },
}));

jest.mock('../../../firebase.admin', () => ({
  isFirebaseConfigured: () => true,
  getUserByEmail: jest.fn(async () => {
    if (mockState.firebaseLookupFailure) throw mockState.firebaseLookupFailure;
    return mockState.firebaseUser;
  }),
  getUser: jest.fn(async () => {
    if (mockState.firebaseUserFailure) throw mockState.firebaseUserFailure;
    return mockState.firebaseUser;
  }),
  setCustomUserClaims: jest.fn(async () => {
    if (mockState.claimsFailure) throw mockState.claimsFailure;
  }),
}));

jest.mock('../../../config/prisma.client', () => null);
jest.mock('bcrypt', () => ({
  compare: jest.fn(async () => mockState.passwordMatches),
}));

const authService = require('../auth.service');

function createFirestore() {
  return {
    collection(name) {
      return {
        where() {
          const getSnapshot = async () => {
            if (mockState.lookupFailure) throw mockState.lookupFailure;
            const docs = mockState.user
              ? Array.from({ length: mockState.matchingEmailDocuments }, (_, index) => {
                const user = mockState.users?.[index] || mockState.user;
                return {
                  id: `synthetic-platform-admin-${index}`,
                  data: () => ({ ...user }),
                };
              })
              : [];
            return { empty: docs.length === 0, docs };
          };
          return {
            limit(maximumMatches) {
              mockState.lookupLimit = maximumMatches;
              return { get: getSnapshot };
            },
            get: getSnapshot,
          };
        },
        doc(id) {
          return { id, path: `${name}/${id}` };
        },
      };
    },
    runTransaction: async (callback) => {
      if (mockState.sessionFailure) throw mockState.sessionFailure;
      return callback({
        get: async () => ({ exists: true, data: () => ({ status: 'active', activeSessionIds: [] }) }),
        create: jest.fn(),
        update: jest.fn(),
      });
    },
  };
}

function resetState() {
  mockState.user = {
    email: 'synthetic-admin@example.test',
    role: 'super_admin',
    roles: ['super_admin'],
    platformAdmin: true,
    status: 'active',
    isVerified: true,
    passwordHash: 'synthetic-hash',
    firebaseUid: 'synthetic-firebase-uid',
    activeSessionIds: [],
  };
  mockState.firebaseUser = {
    uid: 'synthetic-firebase-uid',
    disabled: false,
    customClaims: { role: 'super_admin', roles: ['super_admin'], platformAdmin: true },
  };
  mockState.passwordMatches = true;
  mockState.matchingEmailDocuments = 1;
  mockState.lookupLimit = null;
  mockState.users = [];
  mockState.firestoreFailure = null;
  mockState.lookupFailure = null;
  mockState.firebaseLookupFailure = null;
  mockState.firebaseUserFailure = null;
  mockState.claimsFailure = null;
  mockState.sessionFailure = null;
  mockState.firestore = createFirestore();
}

async function expectLoginDiagnostic(stage, category) {
  await expect(authService.loginPlatformAdmin('synthetic-admin@example.test', 'synthetic-password'))
    .rejects.toMatchObject({
      platformAdminLoginDiagnostic: { stage, category },
    });
}

beforeEach(resetState);

describe('Firebase platform Super Admin login diagnostics', () => {
  test('labels Firestore lookup failures without retaining the underlying error', async () => {
    mockState.firestoreFailure = new Error('sensitive firestore error');

    await expectLoginDiagnostic('firestore_lookup', 'firestore_lookup_failed');
  });

  test('labels password mismatches', async () => {
    mockState.passwordMatches = false;

    await expectLoginDiagnostic('password_check', 'password_mismatch');
  });

  test('labels account policy rejections', async () => {
    mockState.user.isVerified = false;

    let error;
    try {
      await authService.loginPlatformAdmin('synthetic-admin@example.test', 'synthetic-password');
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      platformAdminLoginDiagnostic: {
        stage: 'account_policy',
        category: 'account_rejected',
        accountPolicy: {
          userFound: true,
          matchingEmailDocuments: 1,
          statusActive: true,
          isVerified: false,
          platformAdmin: true,
          hasSuperAdminRole: true,
          tenantIdEmpty: true,
          schoolIdEmpty: true,
        },
      },
    });
    expect(mockState.lookupLimit).toBeNull();
  });

  test('records safe policy booleans and caps matching email documents at two', async () => {
    mockState.user.isVerified = false;
    mockState.user.roles = ['teacher'];
    mockState.user.schoolId = 'synthetic-school';
    mockState.matchingEmailDocuments = 4;
    mockState.users = [
      { ...mockState.user, firebaseUid: 'synthetic-firebase-uid' },
      ...Array.from({ length: 3 }, (_, index) => ({
        ...mockState.user,
        firebaseUid: `different-synthetic-uid-${index}`,
      })),
    ];

    let error;
    try {
      await authService.loginPlatformAdmin('synthetic-admin@example.test', 'synthetic-password');
    } catch (caught) {
      error = caught;
    }

    expect(error.platformAdminLoginDiagnostic).toEqual({
      stage: 'account_policy',
      category: 'account_rejected',
      accountPolicy: {
        userFound: true,
        matchingEmailDocuments: 2,
        statusActive: true,
        isVerified: false,
        platformAdmin: true,
        hasSuperAdminRole: false,
        tenantIdEmpty: true,
        schoolIdEmpty: false,
      },
    });
    expect(mockState.lookupLimit).toBeNull();
    expect(JSON.stringify(error.platformAdminLoginDiagnostic)).not.toContain('synthetic-admin@example.test');
    expect(JSON.stringify(error.platformAdminLoginDiagnostic)).not.toContain('synthetic-firebase-uid');
    expect(JSON.stringify(error.platformAdminLoginDiagnostic)).not.toContain('synthetic-hash');
  });

  test('records a missing user and zero matching email documents', async () => {
    mockState.user = null;
    mockState.matchingEmailDocuments = 0;

    let error;
    try {
      await authService.loginPlatformAdmin('synthetic-admin@example.test', 'synthetic-password');
    } catch (caught) {
      error = caught;
    }

    expect(error.platformAdminLoginDiagnostic.accountPolicy).toEqual({
      userFound: false,
      matchingEmailDocuments: 0,
      statusActive: false,
      isVerified: false,
      platformAdmin: false,
      hasSuperAdminRole: false,
      tenantIdEmpty: true,
      schoolIdEmpty: true,
    });
    expect(mockState.lookupLimit).toBeNull();
  });

  test('labels a missing Firebase account', async () => {
    mockState.firebaseLookupFailure = Object.assign(new Error('sensitive Firebase error'), {
      code: 'auth/user-not-found',
    });

    await expectLoginDiagnostic('firebase_identity', 'firebase_user_missing');
  });

  test('labels a disabled Firebase account', async () => {
    mockState.firebaseUser.disabled = true;

    await expectLoginDiagnostic('claims', 'firebase_account_disabled');
  });

  test('labels a Firebase UID mismatch', async () => {
    mockState.firebaseUser.uid = 'different-synthetic-uid';

    await expectLoginDiagnostic('firebase_identity', 'firebase_uid_mismatch');
  });

  test('labels invalid custom claims', async () => {
    mockState.firebaseUser.customClaims = { role: 'teacher', roles: ['teacher'], platformAdmin: false };

    await expectLoginDiagnostic('claims', 'custom_claims_invalid');
  });

  test('labels a pending password synchronization', async () => {
    mockState.user.passwordSyncPending = true;

    await expectLoginDiagnostic('session', 'password_sync_pending');
  });

  test('labels session persistence failures', async () => {
    mockState.sessionFailure = new Error('sensitive session error');

    await expectLoginDiagnostic('session', 'session_creation_failed');
  });
});
