const mockState = {};

jest.mock('../../../firebase.data', () => ({
  isFirebaseDataConfigured: () => true,
  getFirestore: () => mockState.firestore,
}));

jest.mock('../../../firebase.admin', () => ({
  isFirebaseConfigured: () => true,
  getUser: jest.fn(async (uid) => ({
    uid,
    disabled: false,
    customClaims: { role: 'super_admin', roles: ['super_admin'], platformAdmin: true },
  })),
  getUserByEmail: jest.fn(async () => mockState.firebaseUser),
  setCustomUserClaims: jest.fn(async () => undefined),
}));

jest.mock('../../../config/prisma.client', () => null);
jest.mock('bcrypt', () => ({
  compare: jest.fn(async () => mockState.passwordMatches),
}));

function createFirestore() {
  return {
    collection: () => ({
      doc: (id) => ({ id, path: `mock/${id}` }),
      where: () => ({
        get: async () => {
          const docs = mockState.userDocuments.map(({ id, data }) => ({
            id,
            data: () => ({ ...data }),
          }));
          return { empty: docs.length === 0, docs };
        },
        limit: (maximumMatches) => ({
          get: async () => {
            const docs = mockState.userDocuments.slice(0, maximumMatches).map(({ id, data }) => ({
              id,
              data: () => ({ ...data }),
            }));
            return { empty: docs.length === 0, docs };
          },
        }),
      }),
    }),
    runTransaction: async (callback) => callback({
      get: async () => ({ exists: true, data: () => ({ status: 'active', activeSessionIds: [] }) }),
      create: jest.fn(),
      update: jest.fn(),
    }),
  };
}

function createValidUser(overrides = {}) {
  return {
    email: 'root@example.test',
    username: 'root@example.test',
    fullName: 'Initial Admin',
    role: 'super_admin',
    roles: ['super_admin'],
    platformAdmin: true,
    status: 'active',
    isVerified: true,
    passwordHash: 'bcrypt-hash',
    passwordNeedsReset: false,
    firebaseUid: 'firebase-root-uid',
    ...overrides,
  };
}

function resetState() {
  mockState.userDocuments = [{
    id: 'platform:root@example.test',
    data: createValidUser(),
  }];
  mockState.firebaseUser = {
    uid: 'firebase-root-uid',
    disabled: false,
    customClaims: { role: 'super_admin', roles: ['super_admin'], platformAdmin: true },
  };
  mockState.passwordMatches = true;
  mockState.firestore = createFirestore();
}

const authService = require('../auth.service');
const { verifyAccessToken } = require('../utils/token');

beforeEach(() => {
  resetState();
  jest.clearAllMocks();
});

describe('Firebase platform Super Admin login', () => {
  test('uses the existing platform login service and mints protected Super Admin claims', async () => {
    const session = await authService.loginPlatformAdmin('ROOT@example.test', 'test-password');
    const token = verifyAccessToken(session.accessToken);

    expect(session.user.roles).toEqual(['super_admin']);
    expect(token.roles).toEqual(['super_admin']);
    expect(token.platformAdmin).toBe(true);
    expect(token.tenantId).toBeNull();
  });

  test('selects the UID-matched account from duplicate email records', async () => {
    const bcrypt = require('bcrypt');
    const unauthorizedFirst = createValidUser({
      firebaseUid: 'different-firebase-uid',
      status: 'inactive',
      platformAdmin: false,
      role: 'teacher',
      roles: ['teacher'],
      passwordHash: 'wrong-record-hash',
    });
    const uidMatchedSecond = createValidUser({ passwordHash: 'correct-record-hash' });
    mockState.userDocuments = [
      { id: 'first-duplicate', data: unauthorizedFirst },
      { id: 'uid-matched-record', data: uidMatchedSecond },
    ];

    const session = await authService.loginPlatformAdmin('root@example.test', 'test-password');

    expect(session.user.id).toBe('uid-matched-record');
    expect(bcrypt.compare).toHaveBeenCalledWith('test-password', 'correct-record-hash');
  });

  test('rejects a Firestore record whose UID does not match Firebase Auth', async () => {
    const firebaseAdmin = require('../../../firebase.admin');
    const bcrypt = require('bcrypt');
    mockState.userDocuments[0].data.firebaseUid = 'different-firebase-uid';

    await expect(authService.loginPlatformAdmin('root@example.test', 'test-password'))
      .rejects.toMatchObject({
        platformAdminLoginDiagnostic: {
          stage: 'firebase_identity',
          category: 'firebase_uid_mismatch',
        },
      });

    expect(firebaseAdmin.getUserByEmail).toHaveBeenCalledWith('root@example.test');
    expect(bcrypt.compare).not.toHaveBeenCalled();
    expect(firebaseAdmin.setCustomUserClaims).not.toHaveBeenCalled();
  });

  test('rejects a missing Firestore user without attempting password verification', async () => {
    const bcrypt = require('bcrypt');
    mockState.userDocuments = [];

    await expect(authService.loginPlatformAdmin('root@example.test', 'test-password'))
      .rejects.toMatchObject({
        platformAdminLoginDiagnostic: {
          stage: 'account_policy',
          category: 'account_rejected',
          accountPolicy: {
            userFound: false,
            matchingEmailDocuments: 0,
          },
        },
      });

    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  test('rejects a UID-matched account that fails Super Admin policy checks', async () => {
    const firebaseAdmin = require('../../../firebase.admin');
    const bcrypt = require('bcrypt');
    mockState.userDocuments[0].data.platformAdmin = false;
    mockState.userDocuments[0].data.roles = ['teacher'];

    await expect(authService.loginPlatformAdmin('root@example.test', 'test-password'))
      .rejects.toMatchObject({
        platformAdminLoginDiagnostic: {
          stage: 'account_policy',
          category: 'account_rejected',
          accountPolicy: {
            userFound: true,
            platformAdmin: false,
            hasSuperAdminRole: false,
          },
        },
      });

    expect(bcrypt.compare).not.toHaveBeenCalled();
    expect(firebaseAdmin.setCustomUserClaims).not.toHaveBeenCalled();
  });

  test('rejects an invalid password after selecting the UID-matched account', async () => {
    const bcrypt = require('bcrypt');
    const firebaseAdmin = require('../../../firebase.admin');
    bcrypt.compare.mockResolvedValueOnce(false);

    await expect(authService.loginPlatformAdmin('root@example.test', 'wrong-password'))
      .rejects.toThrow('Invalid credentials');

    expect(firebaseAdmin.getUserByEmail).toHaveBeenCalledTimes(1);
    expect(firebaseAdmin.getUser).not.toHaveBeenCalled();
  });

  test('accepts a valid existing Firestore Firebase UID even when the auth claims are stale', async () => {
    const firebaseAdmin = require('../../../firebase.admin');
    firebaseAdmin.getUserByEmail.mockResolvedValueOnce({
      uid: 'firebase-root-uid',
      disabled: false,
      customClaims: { role: 'teacher', roles: ['teacher'], platformAdmin: false },
    });

    const session = await authService.loginPlatformAdmin('root@example.test', 'test-password');
    const token = verifyAccessToken(session.accessToken);

    expect(session.user.roles).toEqual(['super_admin']);
    expect(token.roles).toEqual(['super_admin']);
    expect(token.platformAdmin).toBe(true);
  });
});
