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
          return {
            limit() {
              return {
                get: async () => {
                  if (mockState.lookupFailure) throw mockState.lookupFailure;
                  return mockState.user
                    ? { empty: false, docs: [{ id: 'synthetic-platform-admin', data: () => ({ ...mockState.user }) }] }
                    : { empty: true, docs: [] };
                },
              };
            },
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

    await expectLoginDiagnostic('account_policy', 'account_rejected');
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
